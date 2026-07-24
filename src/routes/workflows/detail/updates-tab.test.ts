import { describe, expect, test } from 'bun:test';

import type { CoordinatedUpdateResult, WorkflowState } from '@lostgradient/weft';

import { typeIntoPayloadEditor } from '../../../lib/payload-editor/payload-editor.test-support.ts';
import UpdatesTab from './updates-tab.svelte';

function workflow(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    id: 'wf_1',
    type: 'order-fulfillment',
    status: 'running',
    input: {},
    versionTuple: { workflowVersion: '1' },
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe('UpdatesTab', () => {
  test('shows "nothing sent yet" before any update is submitted', async () => {
    const { render } = await import('@testing-library/svelte');
    const client = {
      submitCoordinatedUpdate: async (): Promise<CoordinatedUpdateResult> => ({ updateId: 'u1' }),
    };
    const { getByText } = render(UpdatesTab, { props: { client, workflow: workflow() } });

    expect(getByText('Nothing sent yet.')).not.toBeNull();
  });

  test('sends an update and shows the real settled result', async () => {
    const { render, fireEvent, waitFor } = await import('@testing-library/svelte');
    const received: { call: { id: string; name: string; payload: unknown } | null } = {
      call: null,
    };
    const client = {
      submitCoordinatedUpdate: async (
        id: string,
        name: string,
        payload?: unknown,
      ): Promise<CoordinatedUpdateResult> => {
        received.call = { id, name, payload };
        return { updateId: 'u1', result: { discounted: true } };
      },
    };

    const { getByLabelText, getByRole, getByText } = render(UpdatesTab, {
      props: { client, workflow: workflow() },
    });

    await fireEvent.input(getByLabelText('Update name'), { target: { value: 'applyDiscount' } });
    await typeIntoPayloadEditor(getByLabelText('Payload'), '{"code":"SAVE10"}');
    await fireEvent.click(getByRole('button', { name: 'Send update' }));

    await waitFor(() => {
      expect(getByText('applyDiscount')).not.toBeNull();
    });
    expect(received.call).toEqual({
      id: 'wf_1',
      name: 'applyDiscount',
      payload: { code: 'SAVE10' },
    });
    await waitFor(() => {
      expect(getByText(/"discounted":true/)).not.toBeNull();
    });
  });

  test('shows the handler error when the update resolves with one', async () => {
    const { render, fireEvent, waitFor } = await import('@testing-library/svelte');
    const client = {
      submitCoordinatedUpdate: async (): Promise<CoordinatedUpdateResult> => ({
        updateId: 'u1',
        error: 'insufficient balance',
      }),
    };

    const { getByLabelText, getByRole, getByText } = render(UpdatesTab, {
      props: { client, workflow: workflow() },
    });

    await fireEvent.input(getByLabelText('Update name'), { target: { value: 'applyDiscount' } });
    await fireEvent.click(getByRole('button', { name: 'Send update' }));

    await waitFor(() => {
      expect(getByText('insufficient balance')).not.toBeNull();
    });
  });

  test('rejects invalid JSON payloads without calling the client', async () => {
    const { render, fireEvent } = await import('@testing-library/svelte');
    let called = false;
    const client = {
      submitCoordinatedUpdate: async (): Promise<CoordinatedUpdateResult> => {
        called = true;
        return { updateId: 'u1' };
      },
    };

    const { getByLabelText, getByRole, getByText } = render(UpdatesTab, {
      props: { client, workflow: workflow() },
    });

    await fireEvent.input(getByLabelText('Update name'), { target: { value: 'applyDiscount' } });
    await typeIntoPayloadEditor(getByLabelText('Payload'), '{not json');
    await fireEvent.click(getByRole('button', { name: 'Send update' }));

    expect(called).toBe(false);
    expect(getByText(/Payload must be valid JSON/)).not.toBeNull();
  });
});
