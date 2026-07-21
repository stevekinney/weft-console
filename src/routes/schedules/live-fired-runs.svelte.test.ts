import { describe, expect, test } from 'bun:test';

import type { FleetEventFrame } from '../../lib/live-source/fleet-event-source.svelte.ts';
import { ScheduleFiredRunTracker, type FiredRunFleetSource } from './live-fired-runs.svelte.ts';

/** A minimal `FleetEventSource` fake — records the handler and lets tests push frames directly, avoiding the need to script a real SSE connection for this unit's own logic (filtering, dedup, cap). */
function fakeFleetSource(): FiredRunFleetSource & { emit: (frame: FleetEventFrame) => void } {
  let handler: ((frame: FleetEventFrame) => void) | null = null;
  return {
    subscribe(onFrame) {
      handler = onFrame;
      return () => {
        handler = null;
      };
    },
    emit(frame) {
      handler?.(frame);
    },
  };
}

function firedFrame(overrides: Partial<FleetEventFrame> = {}): FleetEventFrame {
  return {
    kind: 'schedule:fired',
    sequence: 1,
    cursor: 'c1',
    emittedAtMs: 1_000,
    payload: { scheduleId: 'nightly-rollup', workflowId: 'wf-1', firedAt: 1_000 },
    ...overrides,
  };
}

describe('ScheduleFiredRunTracker', () => {
  test('records a schedule:fired frame matching this schedule id', () => {
    const source = fakeFleetSource();
    const tracker = new ScheduleFiredRunTracker(source, 'nightly-rollup');

    source.emit(firedFrame());

    expect(tracker.runs).toEqual([{ workflowId: 'wf-1', firedAt: 1_000 }]);
    tracker.dispose();
  });

  test('carries occurrence through when present', () => {
    const source = fakeFleetSource();
    const tracker = new ScheduleFiredRunTracker(source, 'nightly-rollup');

    source.emit(
      firedFrame({
        payload: {
          scheduleId: 'nightly-rollup',
          workflowId: 'wf-1',
          firedAt: 1_000,
          occurrence: 42,
        },
      }),
    );

    expect(tracker.runs).toEqual([{ workflowId: 'wf-1', firedAt: 1_000, occurrence: 42 }]);
    tracker.dispose();
  });

  test('ignores frames for a different schedule id', () => {
    const source = fakeFleetSource();
    const tracker = new ScheduleFiredRunTracker(source, 'nightly-rollup');

    source.emit(firedFrame({ payload: { scheduleId: 'other-schedule', workflowId: 'wf-1' } }));

    expect(tracker.runs).toEqual([]);
    tracker.dispose();
  });

  test('ignores frame kinds other than schedule:fired/schedule:missed-fire', () => {
    const source = fakeFleetSource();
    const tracker = new ScheduleFiredRunTracker(source, 'nightly-rollup');

    source.emit(firedFrame({ kind: 'workflow:started' }));

    expect(tracker.runs).toEqual([]);
    tracker.dispose();
  });

  test('prepends newer fires and de-duplicates a re-delivered workflowId', () => {
    const source = fakeFleetSource();
    const tracker = new ScheduleFiredRunTracker(source, 'nightly-rollup');

    source.emit(
      firedFrame({
        cursor: 'c1',
        payload: { scheduleId: 'nightly-rollup', workflowId: 'wf-1', firedAt: 1_000 },
      }),
    );
    source.emit(
      firedFrame({
        cursor: 'c2',
        payload: { scheduleId: 'nightly-rollup', workflowId: 'wf-2', firedAt: 2_000 },
      }),
    );
    // Reconnect replay re-delivers wf-1 — must not duplicate.
    source.emit(
      firedFrame({
        cursor: 'c3',
        payload: { scheduleId: 'nightly-rollup', workflowId: 'wf-1', firedAt: 1_000 },
      }),
    );

    expect(tracker.runs.map((run) => run.workflowId)).toEqual(['wf-2', 'wf-1']);
    tracker.dispose();
  });

  test('caps at the tracked-runs limit', () => {
    const source = fakeFleetSource();
    const tracker = new ScheduleFiredRunTracker(source, 'nightly-rollup');

    for (let index = 0; index < 25; index += 1) {
      source.emit(
        firedFrame({
          cursor: `c${index}`,
          payload: { scheduleId: 'nightly-rollup', workflowId: `wf-${index}`, firedAt: index },
        }),
      );
    }

    expect(tracker.runs.length).toBe(20);
    expect(tracker.runs[0]?.workflowId).toBe('wf-24');
    tracker.dispose();
  });

  test('calls onRelevantEvent for both schedule:fired and schedule:missed-fire, but only tracks fired runs', () => {
    const source = fakeFleetSource();
    let relevantCount = 0;
    const tracker = new ScheduleFiredRunTracker(source, 'nightly-rollup', {
      onRelevantEvent: () => {
        relevantCount += 1;
      },
    });

    source.emit(firedFrame());
    source.emit(
      firedFrame({
        kind: 'schedule:missed-fire',
        payload: { scheduleId: 'nightly-rollup', missedCount: 2 },
      }),
    );

    expect(relevantCount).toBe(2);
    expect(tracker.runs.length).toBe(1);
    tracker.dispose();
  });

  test('does not call onRelevantEvent for a different schedule id', () => {
    const source = fakeFleetSource();
    let relevantCount = 0;
    const tracker = new ScheduleFiredRunTracker(source, 'nightly-rollup', {
      onRelevantEvent: () => {
        relevantCount += 1;
      },
    });

    source.emit(firedFrame({ payload: { scheduleId: 'other-schedule', workflowId: 'wf-1' } }));

    expect(relevantCount).toBe(0);
    tracker.dispose();
  });

  test('ignores a schedule:fired frame with no workflowId in the payload', () => {
    const source = fakeFleetSource();
    const tracker = new ScheduleFiredRunTracker(source, 'nightly-rollup');

    source.emit(firedFrame({ payload: { scheduleId: 'nightly-rollup' } }));

    expect(tracker.runs).toEqual([]);
    tracker.dispose();
  });

  test('dispose() unsubscribes — later emits are ignored', () => {
    const source = fakeFleetSource();
    const tracker = new ScheduleFiredRunTracker(source, 'nightly-rollup');
    tracker.dispose();

    source.emit(firedFrame());

    expect(tracker.runs).toEqual([]);
  });
});
