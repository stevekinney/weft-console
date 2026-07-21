/**
 * Component tests for `<ScheduleDetail>` against a REAL in-process weft
 * server (`live-source-test-server.test-support.ts`).
 */
import { describe, expect, test } from 'bun:test';

import { HttpClient } from '@lostgradient/weft/client';

import { startLiveSourceTestServer } from '../../lib/live-source/live-source-test-server.test-support.ts';
import ScheduleDetailHarness from './schedule-detail-test-harness.test-harness.svelte';

async function waitForCondition(): Promise<typeof import('@testing-library/svelte').waitFor> {
  const { waitFor } = await import('@testing-library/svelte');
  return waitFor;
}

describe('ScheduleDetail', () => {
  test('renders the not-found state for an unknown id', async () => {
    const { render } = await import('@testing-library/svelte');
    const server = await startLiveSourceTestServer();
    const client = new HttpClient({ baseUrl: server.baseUrl });

    try {
      const { getByText } = render(ScheduleDetailHarness, {
        props: { client, id: 'does-not-exist' },
      });

      const waitFor = await waitForCondition();
      await waitFor(() => expect(getByText('Schedule not found')).not.toBeNull());
    } finally {
      server.stop();
    }
  });

  test('renders the specification, next fires, and overlap consequence for an active schedule', async () => {
    const { render } = await import('@testing-library/svelte');
    const server = await startLiveSourceTestServer();
    await server.engine.schedule({
      workflow: 'inventory-sync-sweep',
      id: 'nightly-rollup',
      cron: '0 2 * * *',
      input: { warehouseId: 'wh-main' },
      overlapPolicy: 'queue',
    });
    const client = new HttpClient({ baseUrl: server.baseUrl });

    try {
      const { getByText } = render(ScheduleDetailHarness, {
        props: { client, id: 'nightly-rollup' },
      });

      const waitFor = await waitForCondition();
      await waitFor(() => expect(getByText('0 2 * * *')).not.toBeNull());
      expect(getByText('inventory-sync-sweep · Every day at 02:00')).not.toBeNull();
      expect(getByText('Overlap policy: Queue')).not.toBeNull();
      expect(getByText(/Queue can grow unbounded during outages/)).not.toBeNull();
    } finally {
      server.stop();
    }
  });

  test('a schedule with no current or queued runs shows the empty runs note', async () => {
    const { render } = await import('@testing-library/svelte');
    const server = await startLiveSourceTestServer();
    await server.engine.schedule({
      workflow: 'inventory-sync-sweep',
      id: 'nightly-rollup',
      cron: '0 2 * * *',
      input: { warehouseId: 'wh-main' },
    });
    const client = new HttpClient({ baseUrl: server.baseUrl });

    try {
      const { getByText } = render(ScheduleDetailHarness, {
        props: { client, id: 'nightly-rollup' },
      });

      const waitFor = await waitForCondition();
      await waitFor(() => expect(getByText('No active or queued runs.')).not.toBeNull());
      expect(getByText(/No fires observed yet this session\./)).not.toBeNull();
    } finally {
      server.stop();
    }
  });

  test('a paused schedule shows "Not scheduled" instead of a next-fires list', async () => {
    const { render } = await import('@testing-library/svelte');
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
      const { getByText } = render(ScheduleDetailHarness, {
        props: { client, id: 'weekly-digest' },
      });

      const waitFor = await waitForCondition();
      await waitFor(() => expect(getByText('Not scheduled — schedule is paused.')).not.toBeNull());
    } finally {
      server.stop();
    }
  });

  test('pause/resume toggles based on the current status, gated on schedules:write', async () => {
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
      const { getByRole } = render(ScheduleDetailHarness, {
        props: { client, id: 'nightly-rollup' },
      });

      const waitFor = await waitForCondition();
      const pauseButton = await waitFor(() => getByRole('button', { name: /Pause/ }));
      await fireEvent.click(pauseButton);

      await waitFor(() => expect(getByRole('button', { name: /Resume/ })).not.toBeNull());
    } finally {
      server.stop();
    }
  });

  test('pause/cancel actions are disabled when schedules:write is missing', async () => {
    const { render } = await import('@testing-library/svelte');
    const server = await startLiveSourceTestServer();
    await server.engine.schedule({
      workflow: 'inventory-sync-sweep',
      id: 'nightly-rollup',
      cron: '0 2 * * *',
      input: { warehouseId: 'wh-main' },
    });
    const client = new HttpClient({ baseUrl: server.baseUrl });

    try {
      const { getByRole } = render(ScheduleDetailHarness, {
        props: { client, id: 'nightly-rollup', scopes: ['schedules:read'] },
      });

      const waitFor = await waitForCondition();
      await waitFor(() => {
        expect((getByRole('button', { name: /Pause/ }) as HTMLButtonElement).disabled).toBe(true);
      });
      expect((getByRole('button', { name: /Cancel/ }) as HTMLButtonElement).disabled).toBe(true);
    } finally {
      server.stop();
    }
  });

  test('cancelling requires confirming the Tier-2 dialog', async () => {
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
      const { getByRole, getByText } = render(ScheduleDetailHarness, {
        props: { client, id: 'nightly-rollup' },
      });

      const waitFor = await waitForCondition();
      await waitFor(() => expect(getByRole('button', { name: /Cancel/ })).not.toBeNull());
      await fireEvent.click(getByRole('button', { name: /Cancel/ }));

      const dialog = await waitFor(() => getByRole('dialog'));
      await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel schedule' }));

      await waitFor(() => expect(getByText('Cancelled')).not.toBeNull());
    } finally {
      server.stop();
    }
  });

  test('a fault (unreachable server) renders the fault banner with a retry action', async () => {
    const { render } = await import('@testing-library/svelte');
    const client = new HttpClient({ baseUrl: 'http://127.0.0.1:1' });

    const { getByRole } = render(ScheduleDetailHarness, {
      props: { client, id: 'nightly-rollup' },
    });

    const waitFor = await waitForCondition();
    await waitFor(() => expect(getByRole('button', { name: 'Retry' })).not.toBeNull(), {
      timeout: 3000,
    });
  });
});
