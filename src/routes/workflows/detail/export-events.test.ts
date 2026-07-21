import { describe, expect, test } from 'bun:test';

import type { WorkflowEvent, WorkflowTimelineEntry } from '@lostgradient/weft';

import {
  buildEventHistoryExport,
  buildEventsAndTimelineExport,
  exportFilename,
} from './export-events.ts';

const events: readonly WorkflowEvent[] = [
  { type: 'workflow:checkpoint', timestamp: 1000, data: { step: 1 } },
];

const timeline: readonly WorkflowTimelineEntry[] = [
  {
    step: 1,
    operationType: 'activity',
    operationLabel: 'chargeCard',
    inputSummary: '{}',
    timestamp: 1000,
    status: 'completed',
  },
];

describe('buildEventHistoryExport', () => {
  test('includes workflow id, an ISO exportedAt, and the events verbatim', () => {
    const result = buildEventHistoryExport('wf_1', events, 1_700_000_000_000);
    expect(result.workflowId).toBe('wf_1');
    expect(result.exportedAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(result.events).toEqual(events);
  });
});

describe('buildEventsAndTimelineExport', () => {
  test('includes events and timeline together', () => {
    const result = buildEventsAndTimelineExport('wf_1', events, timeline, 1_700_000_000_000);
    expect(result.events).toEqual(events);
    expect(result.timeline).toEqual(timeline);
    expect(result.workflowId).toBe('wf_1');
  });
});

describe('exportFilename', () => {
  test('never contains a colon (filesystem-hostile on Windows)', () => {
    expect(exportFilename('wf_1', 'events')).not.toContain(':');
  });

  test('includes the workflow id and export kind', () => {
    const filename = exportFilename('wf_1', 'events-and-timeline');
    expect(filename.startsWith('wf_1-events-and-timeline-')).toBe(true);
    expect(filename.endsWith('.json')).toBe(true);
  });
});
