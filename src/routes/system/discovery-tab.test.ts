/**
 * Component tests for `<DiscoveryTab>` (plan §9.7 T7.3). Covers the
 * OpenAPI/OpenRPC/AsyncAPI rendered views, the raw-JSON toggle, and a
 * per-document fault. All three documents fetch on mount regardless of the
 * active view, so every test routes all three (a minimal stub for the ones
 * it isn't asserting on).
 */
import { afterEach, describe, expect, test } from 'bun:test';

import { createQueryClient } from '../../lib/query.ts';
import DiscoveryTab from './discovery-tab.svelte';
import SystemRouteTestHarness from './system-route-test-harness.test-harness.svelte';
import { realClient, ScriptedFetch } from './system-test-support.test-support.ts';

let scripted: ScriptedFetch | undefined;

afterEach(() => {
  scripted?.restore();
  scripted = undefined;
});

function routeBaselineDocuments(fetch: ScriptedFetch): void {
  fetch.routeUrl('/openapi.json', { openapi: '3.1.0', paths: {} });
  fetch.routeUrl('/openrpc.json', { openrpc: '1.3.2', methods: [] });
  fetch.routeUrl('/asyncapi.json', { asyncapi: '3.0.0', channels: {} });
}

async function renderDiscoveryTab() {
  const { render } = await import('@testing-library/svelte');
  return render(SystemRouteTestHarness, {
    props: { client: realClient(), queryClient: createQueryClient(), component: DiscoveryTab },
  });
}

describe('DiscoveryTab', () => {
  test('renders the OpenAPI operation table by default', async () => {
    scripted = new ScriptedFetch();
    routeBaselineDocuments(scripted);
    scripted.routeUrl('/openapi.json', {
      paths: {
        '/api/v1/workflows': {
          get: { operationId: 'weft.workflows.list', summary: 'List workflows' },
        },
      },
    });

    const { findByText } = await renderDiscoveryTab();
    expect(await findByText('/api/v1/workflows')).not.toBeNull();
    expect(await findByText('List workflows')).not.toBeNull();
  });

  test('toggling Raw JSON shows the raw document', async () => {
    scripted = new ScriptedFetch();
    routeBaselineDocuments(scripted);
    scripted.routeUrl('/openapi.json', { openapi: '3.1.0', paths: {} });

    const { findByLabelText, findByText } = await renderDiscoveryTab();
    const { fireEvent } = await import('@testing-library/svelte');

    await fireEvent.click(await findByLabelText('Raw JSON'));

    // A single token, not the full `"openapi": "3.1.0"` line — `CodeBlock`'s
    // Shiki highlighting is an async, client-only enhancement that
    // re-renders a code line as one `<span>` per token some time after
    // first paint (its own module doc); asserting on a multi-token string
    // races that swap and intermittently fails once Shiki wins (root-caused
    // via `health-tab.test.ts`'s identical failure — see that test's
    // comment for the full story). `3.1.0` alone stays one token in both
    // the plain and highlighted states.
    expect(await findByText('3.1.0', { exact: false })).not.toBeNull();
  });

  test('switching to OpenRPC shows the method table with MCP availability', async () => {
    scripted = new ScriptedFetch();
    routeBaselineDocuments(scripted);
    scripted.routeUrl('/openrpc.json', {
      methods: [
        {
          name: 'weft.workflows.list',
          summary: 'List workflows',
          'x-weft-mcp': { toolName: 'list_workflows' },
        },
      ],
    });

    const { findByRole, findByText } = await renderDiscoveryTab();
    const { fireEvent } = await import('@testing-library/svelte');

    await fireEvent.click(await findByRole('radio', { name: 'OpenRPC' }));

    expect(await findByText('weft.workflows.list')).not.toBeNull();
    expect(await findByText('list_workflows')).not.toBeNull();
  });

  test('switching to AsyncAPI shows the channel table', async () => {
    scripted = new ScriptedFetch();
    routeBaselineDocuments(scripted);
    scripted.routeUrl('/asyncapi.json', {
      channels: { 'weft/events/sse': { address: '/api/v1/events/sse', title: 'Fleet events' } },
    });

    const { findByRole, findByText } = await renderDiscoveryTab();
    const { fireEvent } = await import('@testing-library/svelte');

    await fireEvent.click(await findByRole('radio', { name: 'AsyncAPI' }));

    expect(await findByText('weft/events/sse')).not.toBeNull();
    expect(await findByText('Fleet events')).not.toBeNull();
  });

  test('a document fetch failure shows the fault banner', async () => {
    scripted = new ScriptedFetch();
    routeBaselineDocuments(scripted);
    scripted.routeUrlStatus('/openapi.json', 500, 'Internal Server Error');

    const { findByText } = await renderDiscoveryTab();
    expect(await findByText('Something went wrong')).not.toBeNull();
  });
});
