/**
 * Component tests for `<AlertsTab>` (plan §9.7 T7.6). Covers the
 * authoritative Active alerts section (`weft.alerts.list`, weft#843), its
 * empty state, and rendering ingested fleet frames as session activity rows.
 */
import { render } from '@testing-library/svelte';
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
  return render(SystemRouteTestHarness, {
    props: { client: realClient(), queryClient: createQueryClient(), component: AlertsTab },
  });
}

describe('AlertsTab — active alerts (weft.alerts.list)', () => {
  test('shows "No active alerts" and an empty activity log when nothing is firing', async () => {
    scripted = new ScriptedFetch();
    scripted.routeJsonRpcMethod('weft.alerts.list', { items: [] });
    scripted.routeSseStream('/v1/events/sse', []);

    const { findByText, findByRole } = await renderAlertsTab();
    expect(await findByText('No active alerts')).not.toBeNull();
    expect(await findByText('No alert activity since page load')).not.toBeNull();
    // The session-scoped caveat stays on the activity section only, and
    // names the authoritative list as such.
    expect(await findByText('Collected since page load', { exact: false })).not.toBeNull();
    expect(
      await findByText('the active list above is authoritative', { exact: false }),
    ).not.toBeNull();

    // The empty state must name a concrete next step (plan §10.4 pattern 7)
    // that lands directly on the Diagnostics sub-view, not just `/workers`'
    // default (fleet) tab — `?tab=diagnostics` is what
    // `src/routes/workers/index.svelte` actually reads.
    const diagnosticsLink = await findByRole('link', { name: 'Open Diagnostics' });
    expect(diagnosticsLink.getAttribute('href')).toBe('/workers?tab=diagnostics');
  });

  test('renders currently firing alerts from the operation, reload-safe', async () => {
    scripted = new ScriptedFetch();
    scripted.routeJsonRpcMethod('weft.alerts.list', {
      items: [
        {
          metric: 'workflow.failure_rate',
          threshold: 0.1,
          currentValue: 0.25,
          window: '5m',
          firedAt: 1000,
        },
        {
          metric: 'storage.size',
          threshold: 1_048_576,
          currentValue: 2_097_152,
          window: null,
          firedAt: null,
        },
      ],
    });
    scripted.routeSseStream('/v1/events/sse', []);

    const { findByText, findAllByText } = await renderAlertsTab();
    expect(await findByText('Workflow failure rate')).not.toBeNull();
    expect(await findByText('25.0% · threshold 10.0% · window 5m')).not.toBeNull();
    expect(await findByText('Storage size')).not.toBeNull();
    expect(await findByText('2.0 MB · threshold 1.0 MB')).not.toBeNull();
    // One Firing badge per active alert — never color alone.
    expect(await findAllByText('Firing')).toHaveLength(2);
  });

  test('an unknown future metric kind falls back to its raw id and unformatted numbers', async () => {
    scripted = new ScriptedFetch();
    scripted.routeJsonRpcMethod('weft.alerts.list', {
      items: [
        { metric: 'queue.depth', threshold: 5, currentValue: 7, window: null, firedAt: null },
      ],
    });
    scripted.routeSseStream('/v1/events/sse', []);

    const { findByText } = await renderAlertsTab();
    expect(await findByText('queue.depth')).not.toBeNull();
    expect(await findByText('7 · threshold 5')).not.toBeNull();
  });

  test('a failing weft.alerts.list renders the shared fault banner with a Retry action', async () => {
    scripted = new ScriptedFetch();
    // 403, not 500: `shouldRetryQuery` retries transient internal faults
    // (with backoff — the error state would not settle inside this test),
    // while a classified unauthorized fault never retries.
    scripted.routeUrlStatus('/jsonrpc', 403);
    scripted.routeSseStream('/v1/events/sse', []);

    const { findByText, findByRole } = await renderAlertsTab();
    expect(await findByText('Not authorized')).not.toBeNull();
    expect(await findByRole('button', { name: 'Retry' })).not.toBeNull();
  });
});

describe('AlertsTab — session activity log', () => {
  test('renders an ingested alert:fired frame as a Firing row', async () => {
    scripted = new ScriptedFetch();
    scripted.routeJsonRpcMethod('weft.alerts.list', { items: [] });
    scripted.routeSseStream('/v1/events/sse', [
      sseFrame({
        kind: 'alert:fired',
        sequence: 1,
        cursor: 'c1',
        emittedAtMs: 1000,
        payload: { name: 'dlq-backlog', message: 'Dead-letter queue backlog exceeds threshold.' },
      }),
    ]);

    const { findByText } = await renderAlertsTab();
    expect(await findByText('Alert fired · dlq-backlog')).not.toBeNull();
    expect(await findByText('Firing')).not.toBeNull();
  });

  test('renders an operational warning as a Warning row', async () => {
    scripted = new ScriptedFetch();
    scripted.routeJsonRpcMethod('weft.alerts.list', { items: [] });
    scripted.routeSseStream('/v1/events/sse', [
      sseFrame({
        kind: 'storage:size-reported',
        sequence: 1,
        cursor: 'c1',
        emittedAtMs: 1000,
        payload: { message: 'Storage crossed 80% of budget.' },
      }),
    ]);

    const { findByText } = await renderAlertsTab();
    expect(await findByText('Storage size warning')).not.toBeNull();
    expect(await findByText('Warning')).not.toBeNull();
  });
});
