import { describe, expect, test } from 'bun:test';

import type { WorkflowTimelineEntry } from '@lostgradient/weft';

import { childWorkflowsFromTimeline, signalHistoryFromTimeline } from './workflow-timeline-data.ts';

function entry(overrides: Partial<WorkflowTimelineEntry>): WorkflowTimelineEntry {
  return {
    step: 1,
    operationType: 'activity',
    operationLabel: 'doThing',
    inputSummary: '{}',
    timestamp: 1000,
    status: 'completed',
    ...overrides,
  };
}

describe('signalHistoryFromTimeline', () => {
  test('extracts only wait-signal entries, in timeline order', () => {
    const entries = [
      entry({
        step: 1,
        operationType: 'wait-signal',
        operationLabel: 'advance',
        status: 'completed',
      }),
      entry({ step: 2, operationType: 'activity', operationLabel: 'recordStep' }),
      entry({
        step: 3,
        operationType: 'wait-signal',
        operationLabel: 'advance',
        status: 'running',
      }),
    ];

    const rows = signalHistoryFromTimeline(entries);

    expect(rows).toEqual([
      { step: 1, name: 'advance', status: 'completed', timestamp: 1000 },
      { step: 3, name: 'advance', status: 'running', timestamp: 1000 },
    ]);
  });

  test('empty timeline yields no rows', () => {
    expect(signalHistoryFromTimeline([])).toEqual([]);
  });

  test('a timeline with no wait-signal entries yields no rows', () => {
    const entries = [entry({ operationType: 'activity' }), entry({ operationType: 'sleep' })];
    expect(signalHistoryFromTimeline(entries)).toEqual([]);
  });
});

describe('childWorkflowsFromTimeline', () => {
  test('extracts child-workflow entries with workflowId always null', () => {
    const entries = [
      entry({
        step: 2,
        operationType: 'child-workflow',
        operationLabel: 'validate-shipment',
        status: 'completed',
        duration: 42,
      }),
      entry({ step: 3, operationType: 'activity', operationLabel: 'chargeCard' }),
    ];

    const rows = childWorkflowsFromTimeline(entries);

    expect(rows).toEqual([
      {
        step: 2,
        type: 'validate-shipment',
        status: 'completed',
        timestamp: 1000,
        duration: 42,
        workflowId: null,
      },
    ]);
  });

  test('never fabricates a workflowId even when outputSummary looks like {"id": ...}', () => {
    const entries = [
      entry({
        step: 1,
        operationType: 'child-workflow',
        operationLabel: 'monitor-delivery',
        status: 'completed',
      }),
    ];

    const [row] = childWorkflowsFromTimeline(entries);
    expect(row?.workflowId).toBeNull();
  });

  test('empty timeline yields no rows', () => {
    expect(childWorkflowsFromTimeline([])).toEqual([]);
  });
});
