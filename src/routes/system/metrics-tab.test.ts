/**
 * Component tests for `<MetricsTab>` (plan §9.7 T7.2). Covers the
 * Dashboard/Raw toggle, stat rendering from a polled snapshot, and the raw
 * Prometheus text view including its fault path.
 */
import { afterEach, describe, expect, test } from 'bun:test';

import { createQueryClient } from '../../lib/query.ts';
import MetricsTab from './metrics-tab.svelte';
import SystemRouteTestHarness from './system-route-test-harness.test-harness.svelte';
import { realClient, ScriptedFetch } from './system-test-support.test-support.ts';

let scripted: ScriptedFetch | undefined;

afterEach(() => {
  scripted?.restore();
  scripted = undefined;
});

async function renderMetricsTab() {
  const { render } = await import('@testing-library/svelte');
  return render(SystemRouteTestHarness, {
    props: { client: realClient(), queryClient: createQueryClient(), component: MetricsTab },
  });
}

describe('MetricsTab', () => {
  test('dashboard view renders stats from the first poll', async () => {
    scripted = new ScriptedFetch();
    scripted.routeJsonRpcMethod('weft.system.metrics', {
      'weft.workflow.active': { type: 'gauge', value: 7 },
      'weft.workflow.completed': { type: 'counter', value: 42 },
      'weft.workflow.failed': { type: 'counter', value: 1 },
    });

    const { findAllByText, findByText } = await renderMetricsTab();

    const activeWorkflowsMatches = await findAllByText('Active workflows');
    expect(activeWorkflowsMatches.length).toBeGreaterThan(0);
    expect(await findByText('7')).not.toBeNull();
    expect(await findByText('42')).not.toBeNull();
  });

  test('switching to Raw fetches and renders the Prometheus text', async () => {
    scripted = new ScriptedFetch();
    scripted.routeJsonRpcMethod('weft.system.metrics', {});
    scripted.routeUrlText('/v1/metrics', 'weft_workflow_active 7\n');

    const { findByRole, findByText } = await renderMetricsTab();
    const { fireEvent } = await import('@testing-library/svelte');

    await fireEvent.click(await findByRole('radio', { name: 'Raw' }));

    expect(await findByText('weft_workflow_active 7')).not.toBeNull();
  });

  test('Raw view shows the fault banner on a failed fetch', async () => {
    scripted = new ScriptedFetch();
    scripted.routeJsonRpcMethod('weft.system.metrics', {});
    scripted.routeUrlStatus('/v1/metrics', 500, 'Internal Server Error');

    const { findByRole, findByText } = await renderMetricsTab();
    const { fireEvent } = await import('@testing-library/svelte');

    await fireEvent.click(await findByRole('radio', { name: 'Raw' }));

    expect(await findByText('Something went wrong')).not.toBeNull();
  });
});
