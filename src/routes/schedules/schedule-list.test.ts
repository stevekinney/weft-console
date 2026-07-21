/**
 * Component tests for `<ScheduleList>` against a REAL in-process weft server
 * (`live-source-test-server.test-support.ts` — plan §11: "No mock server, no
 * fixture drift"). `fixtures/workflows.ts` already registers
 * `inventory-sync-sweep` (from `fixtures/schedules.ts`), so schedules are
 * created directly against that real workflow type per test.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import type { DetachedWindowAPI } from 'happy-dom';

import { HttpClient } from '@lostgradient/weft/client';

import { startLiveSourceTestServer } from '../../lib/live-source/live-source-test-server.test-support.ts';
import { router } from '../../lib/router.svelte.ts';
import ScheduleListHarness from './schedule-list-test-harness.test-harness.svelte';

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

describe('ScheduleList', () => {
  beforeEach(() => {
    resetLocation();
  });

  test('shows the onboarding empty state when no schedules exist', async () => {
    const { render } = await import('@testing-library/svelte');
    const server = await startLiveSourceTestServer();
    const client = new HttpClient({ baseUrl: server.baseUrl });

    try {
      const { getByText } = render(ScheduleListHarness, {
        props: { client },
      });

      const waitFor = await waitForCondition();
      await waitFor(() => expect(getByText('No schedules')).not.toBeNull());
      expect(getByText('Create one to run workflows on a cadence.')).not.toBeNull();
    } finally {
      server.stop();
    }
  });

  test('renders a schedule row with its status badge and human-readable cadence', async () => {
    const { render, within } = await import('@testing-library/svelte');
    const server = await startLiveSourceTestServer();
    await server.engine.schedule({
      workflow: 'inventory-sync-sweep',
      id: 'nightly-rollup',
      cron: '0 2 * * *',
      input: { warehouseId: 'wh-main' },
    });
    const client = new HttpClient({ baseUrl: server.baseUrl });

    try {
      const { getByText, getByRole } = render(ScheduleListHarness, {
        props: { client },
      });

      const waitFor = await waitForCondition();
      await waitFor(() => expect(getByText('nightly-rollup')).not.toBeNull());
      const { getByText: getByTextInTable } = within(getByRole('table'));
      expect(getByTextInTable('Active')).not.toBeNull();
      expect(getByText('Every day at 02:00')).not.toBeNull();
      expect(getByTextInTable('inventory-sync-sweep')).not.toBeNull();
    } finally {
      server.stop();
    }
  });

  test('a paused schedule shows the Paused badge', async () => {
    const { render, within } = await import('@testing-library/svelte');
    const server = await startLiveSourceTestServer();
    const handle = await server.engine.schedule({
      workflow: 'inventory-sync-sweep',
      id: 'weekly-digest',
      cron: '0 9 * * 1',
      input: { warehouseId: 'wh-main' },
    });
    await handle.pause();
    const client = new HttpClient({ baseUrl: server.baseUrl });

    try {
      const { getByText, getByRole } = render(ScheduleListHarness, {
        props: { client },
      });

      const waitFor = await waitForCondition();
      await waitFor(() => expect(getByText('weekly-digest')).not.toBeNull());
      const { getByText: getByTextInTable } = within(getByRole('table'));
      expect(getByTextInTable('Paused')).not.toBeNull();
    } finally {
      server.stop();
    }
  });

  test('clicking a row navigates to the schedule detail URL', async () => {
    const { render, fireEvent } = await import('@testing-library/svelte');
    const server = await startLiveSourceTestServer();
    await server.engine.schedule({
      workflow: 'inventory-sync-sweep',
      id: 'nightly-rollup',
      cron: '0 2 * * *',
      input: { warehouseId: 'wh-main' },
    });
    const client = new HttpClient({ baseUrl: server.baseUrl });

    try {
      const { getByText } = render(ScheduleListHarness, {
        props: { client },
      });

      const waitFor = await waitForCondition();
      const idCell = await waitFor(() => {
        const cell = getByText('nightly-rollup');
        expect(cell).not.toBeNull();
        return cell;
      });
      await fireEvent.click(idCell);

      expect(window.location.search).toContain('id=nightly-rollup');
    } finally {
      server.stop();
    }
  });

  test('the Create schedule button is disabled with a reason when schedules:write is missing', async () => {
    const { render } = await import('@testing-library/svelte');
    const server = await startLiveSourceTestServer();
    const client = new HttpClient({ baseUrl: server.baseUrl });

    try {
      const { getByRole, getByText } = render(ScheduleListHarness, {
        props: { client, scopes: ['schedules:read'] },
      });

      const waitFor = await waitForCondition();
      await waitFor(() => {
        expect(
          (getByRole('button', { name: 'Create schedule' }) as HTMLButtonElement).disabled,
        ).toBe(true);
      });
      expect(getByText('Requires schedules:write')).not.toBeNull();
    } finally {
      server.stop();
    }
  });

  test('the Create schedule button is enabled with schedules:write granted', async () => {
    const { render } = await import('@testing-library/svelte');
    const server = await startLiveSourceTestServer();
    const client = new HttpClient({ baseUrl: server.baseUrl });

    try {
      const { getByRole, queryByText } = render(ScheduleListHarness, {
        props: { client },
      });

      const waitFor = await waitForCondition();
      await waitFor(() => {
        expect(
          (getByRole('button', { name: 'Create schedule' }) as HTMLButtonElement).disabled,
        ).toBe(false);
      });
      expect(queryByText('Requires schedules:write')).toBeNull();
    } finally {
      server.stop();
    }
  });

  test('pausing an active schedule updates its badge to Paused', async () => {
    const { render, fireEvent, within } = await import('@testing-library/svelte');
    const server = await startLiveSourceTestServer();
    await server.engine.schedule({
      workflow: 'inventory-sync-sweep',
      id: 'nightly-rollup',
      cron: '0 2 * * *',
      input: { warehouseId: 'wh-main' },
    });
    const client = new HttpClient({ baseUrl: server.baseUrl });

    try {
      const { getByText, getByRole } = render(ScheduleListHarness, {
        props: { client },
      });

      const waitFor = await waitForCondition();
      await waitFor(() => {
        expect(within(getByRole('table')).getByText('Active')).not.toBeNull();
      });

      await fireEvent.click(getByRole('button', { name: 'Actions for nightly-rollup' }));
      await fireEvent.click(await waitFor(() => getByRole('menuitem', { name: /Pause/ })));

      await waitFor(() => {
        expect(within(getByRole('table')).getByText('Paused')).not.toBeNull();
      });
      expect(getByText('nightly-rollup')).not.toBeNull();
    } finally {
      server.stop();
    }
  });

  test('a fault (unreachable server) renders the fault banner with a retry action', async () => {
    const { render } = await import('@testing-library/svelte');
    const client = new HttpClient({ baseUrl: 'http://127.0.0.1:1' });

    const { getByRole } = render(ScheduleListHarness, {
      props: { client },
    });

    const waitFor = await waitForCondition();
    await waitFor(() => expect(getByRole('button', { name: 'Retry' })).not.toBeNull(), {
      timeout: 3000,
    });
  });

  test('a ?status= URL query param (dashboard-card deep link) pre-filters the status Select', async () => {
    resetLocation('/schedules?status=paused');
    const { render } = await import('@testing-library/svelte');
    const server = await startLiveSourceTestServer();
    const handle = await server.engine.schedule({
      workflow: 'inventory-sync-sweep',
      id: 'weekly-digest',
      cron: '0 9 * * 1',
      input: { warehouseId: 'wh-main' },
    });
    await handle.pause();
    await server.engine.schedule({
      workflow: 'inventory-sync-sweep',
      id: 'nightly-rollup',
      cron: '0 2 * * *',
      input: { warehouseId: 'wh-main' },
    });
    const client = new HttpClient({ baseUrl: server.baseUrl });

    try {
      const { getByRole, getByText, queryByText } = render(ScheduleListHarness, {
        props: { client },
      });

      const waitFor = await waitForCondition();
      await waitFor(() => expect(getByText('weekly-digest')).not.toBeNull());
      expect(queryByText('nightly-rollup')).toBeNull();
      expect((getByRole('combobox', { name: 'Status' }) as HTMLSelectElement).value).toBe(
        'paused',
      );
    } finally {
      server.stop();
    }
  });

  test('changing the status Select updates the URL (replacing, not pushing, history)', async () => {
    resetLocation('/schedules');
    const { render, fireEvent } = await import('@testing-library/svelte');
    const server = await startLiveSourceTestServer();
    const client = new HttpClient({ baseUrl: server.baseUrl });

    try {
      const { getByRole } = render(ScheduleListHarness, { props: { client } });
      const waitFor = await waitForCondition();
      const statusSelect = await waitFor(() => getByRole('combobox', { name: 'Status' }));

      await fireEvent.change(statusSelect, { target: { value: 'active' } });

      expect(window.location.search).toBe('?status=active');
    } finally {
      server.stop();
    }
  });
});
