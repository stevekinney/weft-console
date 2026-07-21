import { describe, expect, test } from 'bun:test';

import type { WorkflowState } from '@lostgradient/weft';

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
        onRunQuery: noopAsync,
      },
    });

    expect(getByText('prod')).not.toBeNull();
    expect(getByText('tier-1')).not.toBeNull();
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
        onRunQuery: noopAsync,
      },
    });

    expect(getByText(/deadline 1m/)).not.toBeNull();
  });
});
