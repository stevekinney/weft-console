import { describe, expect, test } from 'bun:test';

import type { WorkflowTimelineEntry } from '@lostgradient/weft';

import {
  compensatedActivityName,
  isDegradedCoordinationEntry,
  mapTimelineToSteps,
  stepNumberFromRunStepId,
  timelineEntryLabel,
} from './timeline-mapping.ts';

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

describe('timelineEntryLabel', () => {
  test('activity uses the activity name verbatim', () => {
    expect(timelineEntryLabel(entry({ operationType: 'activity', operationLabel: 'chargeCard' }))).toBe(
      'chargeCard',
    );
  });

  test('wait-signal is prefixed with "Signal"', () => {
    expect(
      timelineEntryLabel(entry({ operationType: 'wait-signal', operationLabel: 'advance' })),
    ).toBe('Signal: advance');
  });

  test('child-workflow is prefixed with "Child"', () => {
    expect(
      timelineEntryLabel(
        entry({ operationType: 'child-workflow', operationLabel: 'validate-shipment' }),
      ),
    ).toBe('Child: validate-shipment');
  });

  test('race shows the structural label and branch count from inputSummary', () => {
    expect(
      timelineEntryLabel(
        entry({
          operationType: 'race',
          operationLabel: 'race',
          inputSummary: '{"operationCount":2}',
        }),
      ),
    ).toBe('Race · 2 branches');
  });

  test('speculate has no operationCount in its inputSummary, so no count is shown', () => {
    expect(
      timelineEntryLabel(
        entry({
          operationType: 'speculate',
          operationLabel: 'speculate',
          inputSummary: '{"branch":"speculative"}',
        }),
      ),
    ).toBe('Speculate');
  });

  test('an unrecognized structural operation type falls back to operationLabel, not a fabricated title', () => {
    expect(
      timelineEntryLabel(entry({ operationType: 'some-future-op', operationLabel: 'some-future-op' })),
    ).toBe('some-future-op');
  });
});

describe('isDegradedCoordinationEntry', () => {
  test('race, parallel, and speculate are degraded', () => {
    expect(isDegradedCoordinationEntry(entry({ operationType: 'race' }))).toBe(true);
    expect(isDegradedCoordinationEntry(entry({ operationType: 'parallel' }))).toBe(true);
    expect(isDegradedCoordinationEntry(entry({ operationType: 'speculate' }))).toBe(true);
  });

  test('a plain activity is not degraded', () => {
    expect(isDegradedCoordinationEntry(entry({ operationType: 'activity' }))).toBe(false);
  });
});

describe('compensatedActivityName', () => {
  test('extracts the forward activity name from a compensate: label', () => {
    expect(
      compensatedActivityName(entry({ operationType: 'activity', operationLabel: 'compensate:reserveHotel' })),
    ).toBe('reserveHotel');
  });

  test('a plain activity is not a compensation', () => {
    expect(compensatedActivityName(entry({ operationType: 'activity', operationLabel: 'reserveHotel' }))).toBeNull();
  });

  test('a non-activity operation type is never a compensation, even with a matching label', () => {
    expect(
      compensatedActivityName(entry({ operationType: 'wait-signal', operationLabel: 'compensate:x' })),
    ).toBeNull();
  });
});

describe('mapTimelineToSteps', () => {
  test('maps a plain sequential timeline in order', () => {
    const entries = [
      entry({ step: 1, operationLabel: 'reserveFlight', status: 'completed', duration: 5 }),
      entry({ step: 2, operationLabel: 'reserveHotel', status: 'running', timestamp: 2_000 }),
    ];

    const steps = mapTimelineToSteps(entries);

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ id: 'step-1', label: 'reserveFlight', status: 'succeeded' });
    expect(steps[0]?.duration).toBe('5ms');
    expect(steps[1]).toMatchObject({ id: 'step-2', label: 'reserveHotel', status: 'running' });
    expect(steps[1]?.duration).toBeUndefined();
  });

  test('links a saga compensation step to its forward step by id (the trip-booking-saga fixture shape)', () => {
    const entries = [
      entry({ step: 1, operationLabel: 'reserveFlight', status: 'completed' }),
      entry({ step: 2, operationLabel: 'reserveHotel', status: 'completed' }),
      entry({ step: 3, operationLabel: 'chargeTripCard', status: 'failed' }),
      entry({ step: 4, operationLabel: 'compensate:reserveHotel', status: 'completed' }),
      entry({ step: 5, operationLabel: 'compensate:reserveFlight', status: 'failed' }),
    ];

    const steps = mapTimelineToSteps(entries);

    expect(steps[3]).toMatchObject({ id: 'step-4', compensates: 'step-2' });
    expect(steps[4]).toMatchObject({ id: 'step-5', compensates: 'step-1' });
    // The step it compensates is unaffected — its own status is untouched.
    expect(steps[1]).toMatchObject({ id: 'step-2', status: 'succeeded' });
  });

  test('an unmatched compensate: name renders in place with no compensates link (never guesses)', () => {
    const entries = [entry({ step: 1, operationLabel: 'compensate:neverHappened', status: 'completed' })];

    const steps = mapTimelineToSteps(entries);

    expect(steps[0]?.compensates).toBeUndefined();
  });

  test('a degraded coordination entry gets an explanatory detail panel', () => {
    const entries = [
      entry({
        step: 1,
        operationType: 'race',
        operationLabel: 'race',
        inputSummary: '{"operationCount":2}',
        status: 'completed',
      }),
    ];

    const steps = mapTimelineToSteps(entries);
    const noteDetail = steps[0]?.details?.find((detail) => detail.label === 'About this step');
    expect(noteDetail?.content).toContain('one entry for the whole coordinated operation');
  });

  test('a failed step labels its output detail "Error"', () => {
    const entries = [
      entry({ step: 1, status: 'failed', outputSummary: '"boom"' }),
    ];

    const steps = mapTimelineToSteps(entries);
    expect(steps[0]?.details?.find((detail) => detail.id === 'step-1-output')?.label).toBe('Error');
  });

  test('empty timeline maps to an empty step list', () => {
    expect(mapTimelineToSteps([])).toEqual([]);
  });
});

describe('stepNumberFromRunStepId', () => {
  test('round-trips a mapped step id', () => {
    expect(stepNumberFromRunStepId('step-42')).toBe(42);
  });

  test('returns null for an id this module did not mint', () => {
    expect(stepNumberFromRunStepId('branch-race')).toBeNull();
    expect(stepNumberFromRunStepId('step-')).toBeNull();
    expect(stepNumberFromRunStepId('not-a-step')).toBeNull();
  });
});
