import { describe, expect, test } from 'bun:test';

import type { WorkflowState, WorkflowTimelineEntry } from '@lostgradient/weft';

import ChildrenTabHarness from './children-tab.test-harness.svelte';

function workflowState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    id: 'wf_1',
    type: 'fulfillment-parent',
    status: 'completed',
    input: {},
    versionTuple: { workflowVersion: '1' },
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe('ChildrenTab', () => {
  test('shows the empty state when the timeline has no child-workflow entries', async () => {
    const { render, waitFor } = await import('@testing-library/svelte');
    const client = { getTimeline: async (): Promise<WorkflowTimelineEntry[]> => [] };

    const { getByText } = render(ChildrenTabHarness, {
      props: { client, workflow: workflowState() },
    });

    await waitFor(() => {
      expect(getByText('No child workflows')).not.toBeNull();
    });
  });

  test('renders child-workflow timeline entries with type and status, no id link', async () => {
    const { render, waitFor } = await import('@testing-library/svelte');
    const client = {
      getTimeline: async (): Promise<WorkflowTimelineEntry[]> => [
        {
          step: 1,
          operationType: 'child-workflow',
          operationLabel: 'validate-shipment',
          inputSummary: '{}',
          timestamp: 1_000,
          status: 'completed',
          duration: 42,
        },
      ],
    };

    const { getByText } = render(ChildrenTabHarness, {
      props: { client, workflow: workflowState() },
    });

    await waitFor(() => {
      expect(getByText('validate-shipment')).not.toBeNull();
    });
    expect(getByText(/Child workflow ids aren't exposed/)).not.toBeNull();
  });
});
