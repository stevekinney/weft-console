/**
 * Component tests for `<OperationsTab>` (plan §9.7 T7.4). Covers the
 * searchable catalog table, search filtering, and the scope-domain matrix
 * toggle.
 */
import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, test } from 'bun:test';

import { createQueryClient } from '../../lib/query.ts';
import OperationsTab from './operations-tab.svelte';
import SystemRouteTestHarness from './system-route-test-harness.test-harness.svelte';
import { realClient, ScriptedFetch } from './system-test-support.test-support.ts';

let scripted: ScriptedFetch | undefined;

afterEach(() => {
  scripted?.restore();
  scripted = undefined;
});

function routeDocuments(fetch: ScriptedFetch): void {
  fetch.routeUrl('/openapi.json', {
    paths: {
      '/api/v1/workflows': {
        get: { operationId: 'weft.workflows.list', summary: 'List workflows', tags: ['Workflows'] },
      },
      '/api/v1/storage/get': {
        post: { operationId: 'weft.storage.get', summary: 'Get a stored value', tags: ['Storage'] },
      },
    },
  });
  fetch.routeUrl('/openrpc.json', {
    methods: [
      { name: 'weft.workflows.list', summary: 'List workflows', tags: [{ name: 'Workflows' }] },
      { name: 'weft.storage.get', summary: 'Get a stored value', tags: [{ name: 'Storage' }] },
    ],
  });
}

async function renderOperationsTab() {
  return render(SystemRouteTestHarness, {
    props: { client: realClient(), queryClient: createQueryClient(), component: OperationsTab },
  });
}

describe('OperationsTab', () => {
  test('renders the catalog table with every combined operation', async () => {
    scripted = new ScriptedFetch();
    routeDocuments(scripted);
    const { findByText } = await renderOperationsTab();
    expect(await findByText('weft.workflows.list')).not.toBeNull();
    expect(await findByText('weft.storage.get')).not.toBeNull();
  });

  test('names the "scope" column\'s absence honestly rather than omitting it silently', async () => {
    scripted = new ScriptedFetch();
    routeDocuments(scripted);
    const { findByText } = await renderOperationsTab();
    expect(
      await findByText("Required scope isn't advertised by the discovery documents yet", {
        exact: false,
      }),
    ).not.toBeNull();
  });

  test('searching filters the table', async () => {
    scripted = new ScriptedFetch();
    routeDocuments(scripted);
    const { findByPlaceholderText, findByText, queryByText } = await renderOperationsTab();

    const search = await findByPlaceholderText('Search operations…');
    await fireEvent.input(search, { target: { value: 'storage' } });

    expect(await findByText('weft.storage.get')).not.toBeNull();
    expect(queryByText('weft.workflows.list')).toBeNull();
  });

  test('switching to the scope matrix shows the domain-affinity note and matrix', async () => {
    scripted = new ScriptedFetch();
    routeDocuments(scripted);
    const { findByRole, findByText } = await renderOperationsTab();

    await fireEvent.click(await findByRole('radio', { name: 'Scope matrix' }));

    expect(
      await findByText('Domain affinity derived from scope and tag naming', { exact: false }),
    ).not.toBeNull();
    expect(await findByText('workflows:read')).not.toBeNull();
  });
});
