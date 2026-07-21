/**
 * Component tests for the Schedules domain router (`index.svelte`) — URL
 * query state switches between list/detail/create/edit, per that file's own
 * doc (no `/schedules/:id` entry in the frozen `routes.ts`).
 */
import { describe, expect, test } from 'bun:test';
import type { DetachedWindowAPI } from 'happy-dom';

import { HttpClient } from '@lostgradient/weft/client';

import { startLiveSourceTestServer } from '../../lib/live-source/live-source-test-server.test-support.ts';
import { router } from '../../lib/router.svelte.ts';
import IndexHarness from './index-test-harness.test-harness.svelte';

function happyDomAPI(): DetachedWindowAPI {
  return (window as unknown as { happyDOM: DetachedWindowAPI }).happyDOM;
}

function resetLocation(path = '/schedules'): void {
  happyDomAPI().setURL('http://localhost/');
  router.navigate(path, { replace: true });
}

async function waitForCondition(): Promise<typeof import('@testing-library/svelte').waitFor> {
  const { waitFor } = await import('@testing-library/svelte');
  return waitFor;
}

describe('Schedules index router', () => {
  test('/schedules renders the list', async () => {
    resetLocation('/schedules');
    const { render } = await import('@testing-library/svelte');
    const server = await startLiveSourceTestServer();
    const client = new HttpClient({ baseUrl: server.baseUrl });

    try {
      const { getByRole } = render(IndexHarness, { props: { client } });
      const waitFor = await waitForCondition();
      await waitFor(() => expect(getByRole('heading', { name: 'Schedules' })).not.toBeNull());
    } finally {
      server.stop();
    }
  });

  test('/schedules?id=<id> renders the detail page, not the list', async () => {
    const server = await startLiveSourceTestServer();
    await server.engine.schedule({
      workflow: 'inventory-sync-sweep',
      id: 'nightly-rollup',
      cron: '0 2 * * *',
      input: { warehouseId: 'wh-main' },
    });
    resetLocation('/schedules?id=nightly-rollup');
    const { render } = await import('@testing-library/svelte');
    const client = new HttpClient({ baseUrl: server.baseUrl });

    try {
      const { getByText, queryByRole } = render(IndexHarness, { props: { client } });
      const waitFor = await waitForCondition();
      await waitFor(() => expect(getByText('nightly-rollup')).not.toBeNull());
      expect(queryByRole('heading', { name: 'Schedules' })).toBeNull();
    } finally {
      server.stop();
    }
  });

  test('/schedules?create=1 renders the list with the create drawer open', async () => {
    resetLocation('/schedules?create=1');
    const { render } = await import('@testing-library/svelte');
    const server = await startLiveSourceTestServer();
    const client = new HttpClient({ baseUrl: server.baseUrl });

    try {
      const { getByRole } = render(IndexHarness, { props: { client } });
      const waitFor = await waitForCondition();
      await waitFor(() => expect(getByRole('heading', { name: 'Schedules' })).not.toBeNull());
      expect(getByRole('dialog')).not.toBeNull();
    } finally {
      server.stop();
    }
  });

  test('/schedules?id=<id>&edit=1 renders the detail page with the edit drawer open', async () => {
    const server = await startLiveSourceTestServer();
    await server.engine.schedule({
      workflow: 'inventory-sync-sweep',
      id: 'nightly-rollup',
      cron: '0 2 * * *',
      input: { warehouseId: 'wh-main' },
    });
    resetLocation('/schedules?id=nightly-rollup&edit=1');
    const { render } = await import('@testing-library/svelte');
    const client = new HttpClient({ baseUrl: server.baseUrl });

    try {
      const { getByText, getByRole } = render(IndexHarness, { props: { client } });
      const waitFor = await waitForCondition();
      await waitFor(() => expect(getByText('nightly-rollup')).not.toBeNull());
      expect(getByRole('dialog')).not.toBeNull();
      expect(getByRole('heading', { name: 'Edit schedule' })).not.toBeNull();
    } finally {
      server.stop();
    }
  });

  test('closing the create drawer navigates back to the plain list URL', async () => {
    resetLocation('/schedules?create=1');
    const { render, fireEvent } = await import('@testing-library/svelte');
    const server = await startLiveSourceTestServer();
    const client = new HttpClient({ baseUrl: server.baseUrl });

    try {
      const { getByRole } = render(IndexHarness, { props: { client } });
      const waitFor = await waitForCondition();
      await waitFor(() => expect(getByRole('dialog')).not.toBeNull());

      await fireEvent.click(getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(window.location.search).toBe(''));
    } finally {
      server.stop();
    }
  });
});
