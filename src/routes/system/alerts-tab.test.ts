/**
 * Component tests for `<AlertsTab>` (plan §9.7 T7.6). Covers the empty
 * state and rendering ingested fleet frames as alert rows.
 */
import { afterEach, describe, expect, test } from 'bun:test';

import { createQueryClient } from '../../lib/query.ts';
import AlertsTab from './alerts-tab.svelte';
import SystemRouteTestHarness from './system-route-test-harness.test-harness.svelte';
import { realClient, ScriptedFetch } from './system-test-support.test-support.ts';

let scripted: ScriptedFetch | undefined;

afterEach(() => {
  scripted?.restore();
  scripted = undefined;
});

function sseFrame(fields: Record<string, unknown>): string {
  return `data: ${JSON.stringify(fields)}\n\n`;
}

async function renderAlertsTab() {
  const { render } = await import('@testing-library/svelte');
  return render(SystemRouteTestHarness, {
    props: { client: realClient(), queryClient: createQueryClient(), component: AlertsTab },
  });
}

describe('AlertsTab', () => {
  test('shows the empty state and a "since page load" note when nothing has fired', async () => {
    scripted = new ScriptedFetch();
    scripted.routeSseStream('/v1/events/sse', []);

    const { findByText, findByRole } = await renderAlertsTab();
    expect(await findByText('No alerts since page load')).not.toBeNull();
    expect(await findByText('Collected since page load', { exact: false })).not.toBeNull();

    // The empty state must name a concrete next step (plan §10.4 pattern 7)
    // that lands directly on the Diagnostics sub-view, not just `/workers`'
    // default (fleet) tab — `?tab=diagnostics` is what
    // `src/routes/workers/index.svelte` actually reads.
    const diagnosticsLink = await findByRole('link', { name: 'Open Diagnostics' });
    expect(diagnosticsLink.getAttribute('href')).toBe('/workers?tab=diagnostics');
  });

  test('renders an ingested alert:fired frame as a Firing row', async () => {
    scripted = new ScriptedFetch();
    scripted.routeSseStream('/v1/events/sse', [
      sseFrame({ kind: 'alert:fired', sequence: 1, cursor: 'c1', emittedAtMs: 1000, payload: { name: 'dlq-backlog', message: 'Dead-letter queue backlog exceeds threshold.' } }),
    ]);

    const { findByText } = await renderAlertsTab();
    expect(await findByText('Alert fired · dlq-backlog')).not.toBeNull();
    expect(await findByText('Firing')).not.toBeNull();
  });

  test('renders an operational warning as a Warning row', async () => {
    scripted = new ScriptedFetch();
    scripted.routeSseStream('/v1/events/sse', [
      sseFrame({ kind: 'storage:size-reported', sequence: 1, cursor: 'c1', emittedAtMs: 1000, payload: { message: 'Storage crossed 80% of budget.' } }),
    ]);

    const { findByText } = await renderAlertsTab();
    expect(await findByText('Storage size warning')).not.toBeNull();
    expect(await findByText('Warning')).not.toBeNull();
  });
});
