import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, test } from 'bun:test';

import type { PaginatedResult, WorkflowState, WorkflowSummary } from '@lostgradient/weft';

import OverviewTabHarness from './overview-tab.test-harness.svelte';

function workflow(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    id: 'wf_1',
    type: 'order-fulfillment',
    status: 'running',
    input: { orderId: 'ord-1' },
    versionTuple: { workflowVersion: '1' },
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function emptyPage(): PaginatedResult<WorkflowSummary> {
  return { items: [], total: 0, offset: 0, limit: 5 };
}

function baseClient() {
  return {
    addTags: async () => {},
    removeTags: async () => {},
    get: async (): Promise<WorkflowState | null> => null,
    list: async (): Promise<PaginatedResult<WorkflowSummary>> => emptyPage(),
    operations: {
      'weft.workflows.scheduleprovenance.get': async () => null,
    },
  };
}

describe('OverviewTab', () => {
  test('running workflow shows the pending-result message, not a result panel', async () => {
    const { getByText, queryByText } = render(OverviewTabHarness, {
      props: { client: baseClient(), workflow: workflow({ status: 'running' }) },
    });

    expect(getByText(/Result pending — workflow still running/)).not.toBeNull();
    expect(queryByText('Result')).toBeNull();
  });

  test('completed workflow shows a Result panel', async () => {
    const { getByText } = render(OverviewTabHarness, {
      props: {
        client: baseClient(),
        workflow: workflow({ status: 'completed', result: { ok: true } }),
      },
    });

    expect(getByText('Result')).not.toBeNull();
  });

  test('failed workflow shows the failure-category badge and plain-language explanation', async () => {
    const { getByText } = render(OverviewTabHarness, {
      props: {
        client: baseClient(),
        workflow: workflow({
          status: 'failed',
          failureCategory: 'timeout',
          error: 'the activity took too long',
        }),
      },
    });

    expect(getByText('timeout')).not.toBeNull();
    expect(getByText(/exceeded its configured deadline/)).not.toBeNull();
    expect(getByText('the activity took too long')).not.toBeNull();
  });

  test('cancelled workflow shows a neutral no-result message', async () => {
    const { getByText } = render(OverviewTabHarness, {
      props: { client: baseClient(), workflow: workflow({ status: 'cancelled' }) },
    });

    expect(getByText(/no result value/)).not.toBeNull();
  });

  test('renders existing tags', async () => {
    const { getByText } = render(OverviewTabHarness, {
      props: { client: baseClient(), workflow: workflow({ tags: ['prod', 'tier-1'] }) },
    });

    expect(getByText('prod')).not.toBeNull();
    expect(getByText('tier-1')).not.toBeNull();
  });

  test('adding a tag calls client.addTags with the trimmed value', async () => {
    const added: { tag: string | null } = { tag: null };
    const client = {
      ...baseClient(),
      addTags: async (_id: string, tag: string) => {
        added.tag = tag;
      },
    };

    const { getByLabelText, getByRole } = render(OverviewTabHarness, {
      props: { client, workflow: workflow() },
    });

    const input = getByLabelText('Add tag');
    await fireEvent.input(input, { target: { value: '  urgent  ' } });
    await fireEvent.click(getByRole('button', { name: 'Add tag' }));

    expect(added.tag).toBe('urgent');
  });
});
