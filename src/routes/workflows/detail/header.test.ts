import { describe, expect, test } from 'bun:test';

import type { WorkflowFinalizerStatus, WorkflowState } from '@lostgradient/weft';

import Header from './header.svelte';
import type { WorkflowContextualAction } from './workflow-status.ts';

function workflow(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    id: '4a9f8c31e7b2d05a6f912c10',
    type: 'order-fulfillment',
    status: 'running',
    input: {},
    versionTuple: { workflowVersion: '2.4.1' },
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

const noop = () => {};
const noopAsync = async () => undefined;

describe('WorkflowDetailHeader', () => {
  test('renders the workflow type, version, and status badge', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getByText } = render(Header, {
      props: {
        workflow: workflow(),
        now: 2_000,
        pendingAction: null,
        onAction: noop,
        activeTab: 'overview',
        onNavigateToTab: noop,
        finalizerStatus: null,
        onRunQuery: noopAsync,
      },
    });

    expect(getByText('order-fulfillment')).not.toBeNull();
    expect(getByText('v2.4.1')).not.toBeNull();
    expect(getByText('Running')).not.toBeNull();
  });

  test('running workflows offer cancel, suspend, and force timeout', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getByRole } = render(Header, {
      props: {
        workflow: workflow({ status: 'running' }),
        now: 2_000,
        pendingAction: null,
        onAction: noop,
        activeTab: 'overview',
        onNavigateToTab: noop,
        finalizerStatus: null,
        onRunQuery: noopAsync,
      },
    });

    expect(getByRole('button', { name: 'Cancel' })).not.toBeNull();
    expect(getByRole('button', { name: 'Suspend' })).not.toBeNull();
    expect(getByRole('button', { name: 'Force timeout' })).not.toBeNull();
  });

  test('terminal workflows offer no contextual actions', async () => {
    const { render } = await import('@testing-library/svelte');
    const { queryByRole } = render(Header, {
      props: {
        workflow: workflow({ status: 'completed' }),
        now: 2_000,
        pendingAction: null,
        onAction: noop,
        activeTab: 'overview',
        onNavigateToTab: noop,
        finalizerStatus: null,
        onRunQuery: noopAsync,
      },
    });

    expect(queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  test('cancel opens a confirm dialog rather than calling onAction directly', async () => {
    const { render, fireEvent } = await import('@testing-library/svelte');
    let called = false;
    const { getByRole } = render(Header, {
      props: {
        workflow: workflow({ status: 'running' }),
        now: 2_000,
        pendingAction: null,
        onAction: () => {
          called = true;
        },
        activeTab: 'overview',
        onNavigateToTab: noop,
        finalizerStatus: null,
        onRunQuery: noopAsync,
      },
    });

    await fireEvent.click(getByRole('button', { name: 'Cancel' }));
    expect(called).toBe(false);
    expect(getByRole('dialog')).not.toBeNull();
  });

  test('suspend calls onAction directly with no confirm dialog', async () => {
    const { render, fireEvent } = await import('@testing-library/svelte');
    const received: { action: string | null } = { action: null };
    const { getByRole, queryByRole } = render(Header, {
      props: {
        workflow: workflow({ status: 'running' }),
        now: 2_000,
        pendingAction: null,
        onAction: (action: WorkflowContextualAction) => {
          received.action = action;
        },
        activeTab: 'overview',
        onNavigateToTab: noop,
        finalizerStatus: null,
        onRunQuery: noopAsync,
      },
    });

    await fireEvent.click(getByRole('button', { name: 'Suspend' }));
    expect(received.action).toBe('suspend');
    expect(queryByRole('dialog')).toBeNull();
  });

  test('Send signal navigates to the signals tab', async () => {
    const { render, fireEvent } = await import('@testing-library/svelte');
    const navigated: { tab: string | null } = { tab: null };
    const { getByRole } = render(Header, {
      props: {
        workflow: workflow(),
        now: 2_000,
        pendingAction: null,
        onAction: noop,
        activeTab: 'overview',
        onNavigateToTab: (tab: string) => {
          navigated.tab = tab;
        },
        finalizerStatus: null,
        onRunQuery: noopAsync,
      },
    });

    await fireEvent.click(getByRole('button', { name: 'Send signal' }));
    expect(navigated.tab).toBe('signals');
  });

  test('tags render as badges', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getByText } = render(Header, {
      props: {
        workflow: workflow({ tags: ['prod', 'tier-1'] }),
        now: 2_000,
        pendingAction: null,
        onAction: noop,
        activeTab: 'overview',
        onNavigateToTab: noop,
        finalizerStatus: null,
        onRunQuery: noopAsync,
      },
    });

    expect(getByText('prod')).not.toBeNull();
    expect(getByText('tier-1')).not.toBeNull();
  });

  test('a cancelled workflow with an in-flight finalizer renders "Finalizing" instead of "Cancelled" (weft#732 item 4)', async () => {
    const { render } = await import('@testing-library/svelte');
    const finalizerStatus: WorkflowFinalizerStatus = {
      status: 'running',
      attempts: 1,
      startedAt: 1,
    };
    const { getByText, queryByText } = render(Header, {
      props: {
        workflow: workflow({ status: 'cancelled' }),
        now: 2_000,
        pendingAction: null,
        onAction: noop,
        activeTab: 'overview',
        onNavigateToTab: noop,
        finalizerStatus,
        onRunQuery: noopAsync,
      },
    });

    expect(getByText('Finalizing')).not.toBeNull();
    expect(queryByText('Cancelled')).toBeNull();
  });

  test('a cancelled workflow with a failed finalizer renders "Cancelled — cleanup failed"', async () => {
    const { render } = await import('@testing-library/svelte');
    const finalizerStatus: WorkflowFinalizerStatus = {
      status: 'failed',
      attempts: 3,
      failedAt: 1,
      error: 'destroySandbox threw',
    };
    const { getByText } = render(Header, {
      props: {
        workflow: workflow({ status: 'cancelled' }),
        now: 2_000,
        pendingAction: null,
        onAction: noop,
        activeTab: 'overview',
        onNavigateToTab: noop,
        finalizerStatus,
        onRunQuery: noopAsync,
      },
    });

    expect(getByText('Cancelled — cleanup failed')).not.toBeNull();
  });

  test('a cancelled workflow with no finalizer work recorded renders the plain "Cancelled" badge', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getByText } = render(Header, {
      props: {
        workflow: workflow({ status: 'cancelled' }),
        now: 2_000,
        pendingAction: null,
        onAction: noop,
        activeTab: 'overview',
        onNavigateToTab: noop,
        finalizerStatus: null,
        onRunQuery: noopAsync,
      },
    });

    expect(getByText('Cancelled')).not.toBeNull();
  });

  test('deadline countdown renders for a running workflow with an execution deadline', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getByText } = render(Header, {
      props: {
        workflow: workflow({ status: 'running', executionDeadline: 62_000 }),
        now: 2_000,
        pendingAction: null,
        onAction: noop,
        activeTab: 'overview',
        onNavigateToTab: noop,
        finalizerStatus: null,
        onRunQuery: noopAsync,
      },
    });

    expect(getByText(/deadline 1m/)).not.toBeNull();
  });
});
