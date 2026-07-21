import { describe, expect, test } from 'bun:test';

import type { WorkflowEvent, WorkflowState, WorkflowTimelineEntry } from '@lostgradient/weft';
import type { WorkflowEventTail } from '@lostgradient/weft/client';

import { selectTimelineStep, timelineSelectionFor } from './timeline/timeline-selection-store.svelte.ts';
import EventsTabHarness from './events-tab.test-harness.svelte';

/** A fake tail that connects immediately and yields nothing — enough to exercise the wiring without needing the full reconnect-timing surface (already covered by `src/lib/live-source/workflow-tail-source.test.ts`). */
class EmptyTail implements WorkflowEventTail {
  whenConnected(): Promise<void> {
    return Promise.resolve();
  }
  close(): void {}
  async *#iterate(): AsyncGenerator<WorkflowEvent, void, void> {}
  [Symbol.asyncIterator](): AsyncIterator<WorkflowEvent> {
    return this.#iterate();
  }
}

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

function client(events: WorkflowEvent[] = []) {
  return {
    getEvents: async (): Promise<WorkflowEvent[]> => events,
    getTimeline: async (): Promise<WorkflowTimelineEntry[]> => [],
    tail: () => new EmptyTail(),
  };
}

describe('EventsTab', () => {
  test('renders checkpoint events honestly as "Checkpoint · step N"', async () => {
    const { render, waitFor } = await import('@testing-library/svelte');
    const events: WorkflowEvent[] = [
      { type: 'workflow:checkpoint', timestamp: 1_000, data: { step: 1 } },
      { type: 'workflow:checkpoint', timestamp: 2_000, data: { step: 2 } },
    ];

    const { getByText } = render(EventsTabHarness, {
      props: { client: client(events), workflow: workflow() },
    });

    await waitFor(() => {
      expect(getByText('Checkpoint · step 1')).not.toBeNull();
    });
    expect(getByText('Checkpoint · step 2')).not.toBeNull();
    expect(getByText('2 events')).not.toBeNull();
  });

  test('shows an empty count with no events', async () => {
    const { render, waitFor } = await import('@testing-library/svelte');
    const { getByText } = render(EventsTabHarness, {
      props: { client: client([]), workflow: workflow() },
    });

    await waitFor(() => {
      expect(getByText('0 events')).not.toBeNull();
    });
  });

  test('Live defaults on for a running workflow and can be paused', async () => {
    const { render, fireEvent, waitFor } = await import('@testing-library/svelte');
    const { getByRole } = render(EventsTabHarness, {
      props: { client: client([]), workflow: workflow({ status: 'running' }) },
    });

    await waitFor(() => {
      expect(getByRole('button', { name: 'Live' })).not.toBeNull();
    });
    await fireEvent.click(getByRole('button', { name: 'Live' }));
    expect(getByRole('button', { name: 'Paused' })).not.toBeNull();
  });

  test('Live defaults off for a terminal workflow', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getByRole } = render(EventsTabHarness, {
      props: { client: client([]), workflow: workflow({ status: 'completed' }) },
    });

    expect(getByRole('button', { name: 'Paused' })).not.toBeNull();
  });

  test('a Timeline-tab step selection filters the events tab to matching rows, and Clear restores them', async () => {
    const { render, fireEvent, waitFor } = await import('@testing-library/svelte');
    const events: WorkflowEvent[] = [
      { type: 'workflow:checkpoint', timestamp: 1_000, data: { step: 1 } },
      { type: 'workflow:checkpoint', timestamp: 2_000, data: { step: 2 } },
    ];
    const wf = workflow({ id: 'wf_events_selection_1' });

    // Simulate the Timeline tab having already selected step 2 — the
    // linked-selection store is shared module state (see that module's
    // doc), so setting it here is equivalent to a click over there.
    timelineSelectionFor(wf.id);
    selectTimelineStep('step-2');

    const { getByText, getByRole, queryByText } = render(EventsTabHarness, {
      props: { client: client(events), workflow: wf },
    });

    await waitFor(() => {
      expect(getByText('step: 2')).not.toBeNull();
      expect(getByText('Checkpoint · step 2')).not.toBeNull();
    });
    expect(queryByText('Checkpoint · step 1')).toBeNull();
    expect(getByText('1 events')).not.toBeNull();

    await fireEvent.click(getByRole('button', { name: 'Clear step filter' }));

    await waitFor(() => {
      expect(queryByText('step: 2')).toBeNull();
      expect(getByText('Checkpoint · step 1')).not.toBeNull();
    });
    expect(getByText('2 events')).not.toBeNull();
  });

  test('Download menu offers both export options', async () => {
    const { render, fireEvent, waitFor } = await import('@testing-library/svelte');
    const { getByRole, getByText } = render(EventsTabHarness, {
      props: { client: client([]), workflow: workflow() },
    });

    await fireEvent.click(getByRole('button', { name: /Download/ }));

    await waitFor(() => {
      expect(getByText('Event history · JSON')).not.toBeNull();
    });
    expect(getByText('Events + timeline · JSON')).not.toBeNull();
  });
});
