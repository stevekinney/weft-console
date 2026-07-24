import { describe, expect, test } from 'bun:test';

import type { PaginatedResult, WorkflowState, WorkflowSummary } from '@lostgradient/weft';

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

function summary(overrides: Partial<WorkflowSummary> = {}): WorkflowSummary {
  return {
    id: 'wf_child_1',
    type: 'validate-shipment',
    status: 'completed',
    version: '1',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function page(items: WorkflowSummary[], total = items.length): PaginatedResult<WorkflowSummary> {
  return { items, total, offset: 0, limit: 50 };
}

describe('ChildrenTab', () => {
  test('shows the empty state when list({ parentWorkflowId }) returns no children', async () => {
    const { render, waitFor } = await import('@testing-library/svelte');
    const client = { list: async () => page([]) };

    const { getByText } = render(ChildrenTabHarness, {
      props: { client, workflow: workflowState() },
    });

    await waitFor(() => {
      expect(getByText('No child workflows')).not.toBeNull();
    });
  });

  test('renders real child ids as clickable rows, including a detached (non-awaited) child', async () => {
    const { render, waitFor } = await import('@testing-library/svelte');
    const client = {
      list: async (filter?: { parentWorkflowId?: string }) => {
        expect(filter?.parentWorkflowId).toBe('wf_1');
        return page([
          summary({ id: 'wf_child_1', type: 'validate-shipment', status: 'completed' }),
          summary({ id: 'wf_child_2', type: 'monitor-delivery', status: 'running' }),
        ]);
      },
    };

    const { getByText, getByRole } = render(ChildrenTabHarness, {
      props: { client, workflow: workflowState() },
    });

    await waitFor(() => {
      expect(getByText('validate-shipment')).not.toBeNull();
      expect(getByText('monitor-delivery')).not.toBeNull();
    });

    const link = getByRole('link', { name: /validate-shipment/ });
    expect(link.getAttribute('href')).toContain('wf_child_1');
  });

  test('shows a "+N more" note when the parent has more children than the page limit', async () => {
    const { render, waitFor } = await import('@testing-library/svelte');
    const client = {
      list: async () => page([summary({ id: 'wf_child_1' })], 3),
    };

    const { getByText } = render(ChildrenTabHarness, {
      props: { client, workflow: workflowState() },
    });

    await waitFor(() => {
      expect(getByText(/Showing 1 of 3/)).not.toBeNull();
    });
  });
});
