import { describe, expect, test } from 'bun:test';

import type { WorkflowState, WorkflowTimelineEntry } from '@lostgradient/weft';
import { QueryClient } from '@tanstack/svelte-query';

import type { FleetEventFrame } from '../../../lib/live-source/fleet-event-source.svelte.ts';
import TimelineTabHarness from './timeline-tab.test-harness.svelte';
import { WorkflowLiveObservations } from './timeline/workflow-live-observations.svelte.ts';

function workflow(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    id: 'wf-1',
    type: 'trip-booking-saga',
    status: 'running',
    input: {},
    versionTuple: { workflowVersion: '1' },
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function entry(overrides: Partial<WorkflowTimelineEntry>): WorkflowTimelineEntry {
  return {
    step: 1,
    operationType: 'activity',
    operationLabel: 'doThing',
    inputSummary: '{}',
    timestamp: 1_000,
    status: 'completed',
    ...overrides,
  };
}

class InertFleet {
  caughtUp = false;
  #handler: ((frame: FleetEventFrame) => void) | null = null;

  subscribe(onFrame: (frame: FleetEventFrame) => void): () => void {
    this.#handler = onFrame;
    return () => {
      this.#handler = null;
    };
  }

  emit(frame: FleetEventFrame): void {
    this.#handler?.(frame);
  }
}

function inertQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function baseClient(entries: WorkflowTimelineEntry[]) {
  return {
    getTimeline: async () => entries,
    activity: {
      complete: async () => {},
      completeExceptionally: async () => {},
    },
  };
}

describe('TimelineTab', () => {
  test('shows an empty state with no timeline entries', async () => {
    const { render, waitFor } = await import('@testing-library/svelte');
    const liveObservations = new WorkflowLiveObservations(
      new InertFleet(),
      inertQueryClient(),
      'wf-1',
    );

    const { getByText } = render(TimelineTabHarness, {
      props: { client: baseClient([]), workflow: workflow(), liveObservations },
    });

    await waitFor(() => expect(getByText('No timeline entries yet')).not.toBeNull());
  });

  test('renders steps in order with their labels', async () => {
    const { render, waitFor } = await import('@testing-library/svelte');
    const liveObservations = new WorkflowLiveObservations(
      new InertFleet(),
      inertQueryClient(),
      'wf-1',
    );
    const entries = [
      entry({ step: 1, operationLabel: 'reserveFlight' }),
      entry({ step: 2, operationLabel: 'reserveHotel', status: 'running' }),
    ];

    const { getByText } = render(TimelineTabHarness, {
      props: { client: baseClient(entries), workflow: workflow(), liveObservations },
    });

    await waitFor(() => {
      expect(getByText('reserveFlight')).not.toBeNull();
      expect(getByText('reserveHotel')).not.toBeNull();
    });
  });

  test('clicking a step selects it and shows the linked-selection chip, Clear removes it', async () => {
    const { render, fireEvent, waitFor } = await import('@testing-library/svelte');
    const liveObservations = new WorkflowLiveObservations(
      new InertFleet(),
      inertQueryClient(),
      'wf-1',
    );
    const entries = [entry({ step: 1, operationLabel: 'reserveFlight' })];

    const { getByText, queryByText } = render(TimelineTabHarness, {
      props: {
        client: baseClient(entries),
        workflow: workflow({ id: 'wf-select-1' }),
        liveObservations,
      },
    });

    await waitFor(() => expect(getByText('reserveFlight')).not.toBeNull());
    await fireEvent.click(getByText('reserveFlight'));

    await waitFor(() => {
      expect(getByText('Selected — Events filtered to this step')).not.toBeNull();
    });

    await fireEvent.click(getByText('Clear'));

    await waitFor(() => {
      expect(queryByText('Selected — Events filtered to this step')).toBeNull();
    });
  });

  /**
   * T9.4 accessibility pass: the per-step "Select" control is the real
   * keyboard-accessible path (a native `<button>`, reachable by Tab,
   * activated by Enter/Space via the platform — no manual keydown wiring
   * needed). This also guards the `stopPropagation` fix in
   * `toggleStepSelection`: `selectTimelineStep` TOGGLES, so if the click
   * bubbled to the row-level delegate too, one click would select-then-
   * immediately-deselect and `aria-pressed` would never flip.
   */
  test('the step-selection button toggles aria-pressed and the linked-selection chip on a single click (no double-toggle from the row delegate)', async () => {
    const { render, fireEvent, waitFor } = await import('@testing-library/svelte');
    const liveObservations = new WorkflowLiveObservations(
      new InertFleet(),
      inertQueryClient(),
      'wf-1',
    );
    const entries = [entry({ step: 1, operationLabel: 'reserveFlight' })];

    const { getByRole, getByText, queryByText } = render(TimelineTabHarness, {
      props: {
        client: baseClient(entries),
        workflow: workflow({ id: 'wf-select-2' }),
        liveObservations,
      },
    });

    await waitFor(() => expect(getByText('reserveFlight')).not.toBeNull());
    const selectButton = getByRole('button', { name: 'Select — filter events to this step' });
    expect(selectButton.getAttribute('aria-pressed')).toBe('false');

    await fireEvent.click(selectButton);

    await waitFor(() => {
      expect(getByText('Selected — Events filtered to this step')).not.toBeNull();
    });
    expect(
      getByRole('button', { name: 'Selected — filtering events' }).getAttribute('aria-pressed'),
    ).toBe('true');

    await fireEvent.click(getByRole('button', { name: 'Selected — filtering events' }));

    await waitFor(() => {
      expect(queryByText('Selected — Events filtered to this step')).toBeNull();
    });
    expect(
      getByRole('button', { name: 'Select — filter events to this step' }).getAttribute(
        'aria-pressed',
      ),
    ).toBe('false');
  });

  test('the Failed quick filter narrows the rendered steps', async () => {
    const { render, fireEvent, waitFor } = await import('@testing-library/svelte');
    const liveObservations = new WorkflowLiveObservations(
      new InertFleet(),
      inertQueryClient(),
      'wf-1',
    );
    const entries = [
      entry({ step: 1, operationLabel: 'reserveFlight', status: 'completed' }),
      entry({ step: 2, operationLabel: 'chargeTripCard', status: 'failed' }),
    ];

    const { getByText, getByRole, queryByText } = render(TimelineTabHarness, {
      props: {
        client: baseClient(entries),
        workflow: workflow({ id: 'wf-filter-1' }),
        liveObservations,
      },
    });

    await waitFor(() => expect(getByText('reserveFlight')).not.toBeNull());
    await fireEvent.click(getByRole('radio', { name: 'Failed' }));

    await waitFor(() => {
      expect(queryByText('reserveFlight')).toBeNull();
      expect(getByText('chargeTripCard')).not.toBeNull();
    });
  });

  test('shows the Finalizing badge when the live observations report a still-in-flight finalizer', async () => {
    const { render, waitFor } = await import('@testing-library/svelte');
    const fleet = new InertFleet();
    fleet.caughtUp = true;
    const liveObservations = new WorkflowLiveObservations(fleet, inertQueryClient(), 'wf-1');
    fleet.emit({
      kind: 'workflow:cancelled',
      workflowId: 'wf-1',
      sequence: 1,
      cursor: '1',
      emittedAtMs: 1,
      payload: {},
    });

    const { getByText } = render(TimelineTabHarness, {
      props: {
        client: baseClient([]),
        workflow: workflow({ status: 'cancelled' }),
        liveObservations,
      },
    });

    await waitFor(() => expect(getByText('Finalizing')).not.toBeNull());
  });

  test('an unambiguous pending async activity badges the matching step', async () => {
    const { render, waitFor } = await import('@testing-library/svelte');
    const fleet = new InertFleet();
    const liveObservations = new WorkflowLiveObservations(fleet, inertQueryClient(), 'wf-1');
    fleet.emit({
      kind: 'activity:async-pending',
      workflowId: 'wf-1',
      sequence: 1,
      cursor: '1',
      emittedAtMs: 1,
      payload: {
        token: 'tok-1',
        operationId: 'op-1',
        activityName: 'printShippingLabel',
        attempt: 1,
      },
    });
    const entries = [
      entry({
        step: 1,
        operationType: 'activity',
        operationLabel: 'printShippingLabel',
        status: 'running',
      }),
    ];

    const { getByText } = render(TimelineTabHarness, {
      props: {
        client: baseClient(entries),
        workflow: workflow({ id: 'wf-1', status: 'running' }),
        liveObservations,
      },
    });

    await waitFor(() => {
      expect(getByText('printShippingLabel')).not.toBeNull();
      expect(getByText('Awaiting external completion')).not.toBeNull();
    });
  });

  test('an ambiguous (unattached) pending async activity shows in the standalone list instead of on a step', async () => {
    const { render, waitFor } = await import('@testing-library/svelte');
    const fleet = new InertFleet();
    const liveObservations = new WorkflowLiveObservations(fleet, inertQueryClient(), 'wf-1');
    fleet.emit({
      kind: 'activity:async-pending',
      workflowId: 'wf-1',
      sequence: 1,
      cursor: '1',
      emittedAtMs: 1,
      payload: {
        token: 'tok-1',
        operationId: 'op-1',
        activityName: 'printShippingLabel',
        attempt: 1,
      },
    });
    // No matching timeline entry at all — the observation stays unattached.
    const entries = [entry({ step: 1, operationLabel: 'unrelatedStep', status: 'completed' })];

    const { getByText } = render(TimelineTabHarness, {
      props: { client: baseClient(entries), workflow: workflow({ id: 'wf-1' }), liveObservations },
    });

    await waitFor(() => {
      expect(getByText(/Couldn't link this to a single timeline step/)).not.toBeNull();
    });
  });
});
