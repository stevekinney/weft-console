import { describe, expect, test } from 'bun:test';

import type { WorkflowState, WorkflowTimelineEntry } from '@lostgradient/weft';

import LineagePanelHarness from './lineage-panel.test-harness.svelte';

function workflow(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    id: 'wf_current',
    type: 'order-fulfillment',
    status: 'running',
    input: {},
    versionTuple: { workflowVersion: '1' },
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe('LineagePanel', () => {
  test('renders no forked-from row and the honest footnote when the run was started normally', async () => {
    const { render, waitFor } = await import('@testing-library/svelte');
    const client = {
      get: async () => null,
      getTimeline: async (): Promise<WorkflowTimelineEntry[]> => [],
    };

    const { getByText, queryByText } = render(LineagePanelHarness, {
      props: { client, workflow: workflow() },
    });

    await waitFor(() => {
      expect(getByText('No child workflows.')).not.toBeNull();
    });
    expect(queryByText('Forked from')).toBeNull();
    expect(getByText(/Schedule provenance and continuation chains/)).not.toBeNull();
  });

  test('renders the forked-from row using the source workflow type as the link label', async () => {
    const { render, waitFor } = await import('@testing-library/svelte');
    const client = {
      get: async (id: string): Promise<WorkflowState | null> =>
        id === 'wf_source' ? workflow({ id: 'wf_source', type: 'reconcile-ledger' }) : null,
      getTimeline: async (): Promise<WorkflowTimelineEntry[]> => [],
    };

    const { getByText } = render(LineagePanelHarness, {
      props: {
        client,
        workflow: workflow({ forkedFrom: { workflowId: 'wf_source', step: 12 } }),
      },
    });

    await waitFor(() => {
      expect(getByText('reconcile-ledger')).not.toBeNull();
    });
    expect(getByText('at step 12')).not.toBeNull();
  });

  test('falls back to a truncated-id label when the forked-from source is no longer visible', async () => {
    const { render, waitFor } = await import('@testing-library/svelte');
    const client = {
      get: async (): Promise<WorkflowState | null> => null,
      getTimeline: async (): Promise<WorkflowTimelineEntry[]> => [],
    };

    const { getByText } = render(LineagePanelHarness, {
      props: {
        client,
        workflow: workflow({
          forkedFrom: { workflowId: 'wf_purged_00000000000000000000', step: 3 },
        }),
      },
    });

    await waitFor(() => {
      expect(getByText(/run$/)).not.toBeNull();
    });
  });

  test('renders child workflows from the timeline without a workflow-id link', async () => {
    const { render, waitFor } = await import('@testing-library/svelte');
    const client = {
      get: async (): Promise<WorkflowState | null> => null,
      getTimeline: async (): Promise<WorkflowTimelineEntry[]> => [
        {
          step: 2,
          operationType: 'child-workflow',
          operationLabel: 'validate-shipment',
          inputSummary: '{}',
          timestamp: 1_000,
          status: 'completed',
        },
      ],
    };

    const { getByText } = render(LineagePanelHarness, {
      props: { client, workflow: workflow() },
    });

    await waitFor(() => {
      expect(getByText('validate-shipment')).not.toBeNull();
    });
    expect(getByText(/Child workflow ids aren't exposed/)).not.toBeNull();
  });
});
