/**
 * Proving test for the plain-`.ts` (no DOM) unit-test harness (plan §11.1,
 * T0.1) — also real coverage for the `format` helpers themselves. Runs
 * under `TZ=UTC` (`package.json`'s `test` script), which `computeNextFires`
 * relies on: cron-parser and `Date` getters both resolve the system's local
 * zone, so every cron fixture below is written in UTC.
 */
import { describe, expect, test } from 'bun:test';

import {
  computeNextFires,
  formatBytes,
  formatDuration,
  formatRelativeTime,
  truncateId,
} from './index.ts';

describe('truncateId', () => {
  test('truncates a long id to first8…last4', () => {
    expect(truncateId('wf_9f3c1a2b4d5e6f708192a3b4')).toBe('wf_9f3c1…a3b4');
  });

  test('leaves a short id unchanged', () => {
    expect(truncateId('short-id')).toBe('short-id');
  });
});

describe('formatDuration', () => {
  test('formats sub-second durations in ms', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  test('formats a multi-unit duration with at most two units', () => {
    expect(formatDuration(3_661_000)).toBe('1h 1m');
  });
});

describe('formatBytes', () => {
  test('formats bytes below 1024 verbatim', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  test('formats kilobytes with one decimal', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-07-20T12:00:00.000Z');

  test('collapses anything within 5 seconds to "just now", past or future', () => {
    expect(formatRelativeTime(now - 4_000, now)).toBe('just now');
    expect(formatRelativeTime(now + 4_000, now)).toBe('just now');
    expect(formatRelativeTime(now, now)).toBe('just now');
  });

  test('the 5-second boundary itself is no longer "just now"', () => {
    expect(formatRelativeTime(now - 5_000, now)).toBe('5s ago');
  });

  test('formats a past timestamp with "ago"', () => {
    expect(formatRelativeTime(now - 2 * 60_000, now)).toBe('2m ago');
  });

  test('formats a future timestamp with "in"', () => {
    expect(formatRelativeTime(now + 3 * 3_600_000, now)).toBe('in 3h');
  });

  test('defaults `now` to the current time when omitted', () => {
    expect(formatRelativeTime(Date.now())).toBe('just now');
  });
});

describe('computeNextFires', () => {
  test('interval mode: every N minutes, evenly spaced from `from`', () => {
    const from = new Date('2026-07-20T10:05:00.000Z');
    const fires = computeNextFires({ mode: 'interval', every: 15, unit: 'minutes' }, 3, from);

    expect(fires.map((fire) => fire.id)).toEqual([
      '2026-07-20T10:20:00.000Z',
      '2026-07-20T10:35:00.000Z',
      '2026-07-20T10:50:00.000Z',
    ]);
    expect(fires.every((fire) => fire.label.length > 0)).toBe(true);
  });

  test('interval mode: every N hours/days/weeks scales the step', () => {
    const from = new Date('2026-07-20T00:00:00.000Z');
    expect(computeNextFires({ mode: 'interval', every: 2, unit: 'hours' }, 1, from)[0]?.id).toBe(
      '2026-07-20T02:00:00.000Z',
    );
    expect(computeNextFires({ mode: 'interval', every: 1, unit: 'days' }, 1, from)[0]?.id).toBe(
      '2026-07-21T00:00:00.000Z',
    );
    expect(computeNextFires({ mode: 'interval', every: 1, unit: 'weeks' }, 1, from)[0]?.id).toBe(
      '2026-07-27T00:00:00.000Z',
    );
  });

  test('cron mode: daily at a fixed time', () => {
    const from = new Date('2026-07-20T10:00:00.000Z');
    const fires = computeNextFires({ mode: 'cron', expression: '0 9 * * *' }, 3, from);

    expect(fires.map((fire) => fire.id)).toEqual([
      '2026-07-21T09:00:00.000Z',
      '2026-07-22T09:00:00.000Z',
      '2026-07-23T09:00:00.000Z',
    ]);
  });

  test('cron mode: step syntax ("*/15")', () => {
    const from = new Date('2026-07-20T10:05:00.000Z');
    const fires = computeNextFires({ mode: 'cron', expression: '*/15 * * * *' }, 3, from);

    expect(fires.map((fire) => fire.id)).toEqual([
      '2026-07-20T10:15:00.000Z',
      '2026-07-20T10:30:00.000Z',
      '2026-07-20T10:45:00.000Z',
    ]);
  });

  test('cron mode: day-of-week names and a range (MON-FRI) skip the weekend', () => {
    // 2026-07-17 is a Friday.
    const from = new Date('2026-07-17T00:00:00.000Z');
    const fires = computeNextFires({ mode: 'cron', expression: '0 9 * * MON-FRI' }, 5, from);

    expect(fires.map((fire) => fire.id)).toEqual([
      '2026-07-17T09:00:00.000Z', // Fri (later the same day as `from`)
      '2026-07-20T09:00:00.000Z', // Mon — 07-18/07-19 (Sat/Sun) skipped
      '2026-07-21T09:00:00.000Z',
      '2026-07-22T09:00:00.000Z',
      '2026-07-23T09:00:00.000Z',
    ]);
  });

  test('cron mode: POSIX OR semantics when both day-of-month and day-of-week are restricted', () => {
    const from = new Date('2026-07-01T00:00:00.000Z');
    const fires = computeNextFires({ mode: 'cron', expression: '0 0 1,15 * MON' }, 5, from);

    // 2026-07-15 is a Wednesday — it fires because day-of-month (1,15) OR
    // day-of-week (MON) matches, not because both do.
    expect(fires.map((fire) => fire.id)).toEqual([
      '2026-07-06T00:00:00.000Z',
      '2026-07-13T00:00:00.000Z',
      '2026-07-15T00:00:00.000Z',
      '2026-07-20T00:00:00.000Z',
      '2026-07-27T00:00:00.000Z',
    ]);
  });

  test('cron mode: an out-of-range field throws', () => {
    expect(() =>
      computeNextFires({ mode: 'cron', expression: '99 * * * *' }, 1, new Date()),
    ).toThrow();
  });

  test('cron mode: an unresolvable alias throws', () => {
    expect(() =>
      computeNextFires({ mode: 'cron', expression: '0 9 * * XYZ' }, 1, new Date()),
    ).toThrow();
  });

  test('cron mode: too many fields throws', () => {
    expect(() =>
      computeNextFires({ mode: 'cron', expression: '* * * * * * *' }, 1, new Date()),
    ).toThrow();
  });

  test('count 0 returns an empty list for both modes', () => {
    const from = new Date('2026-07-20T00:00:00.000Z');
    expect(computeNextFires({ mode: 'interval', every: 5, unit: 'minutes' }, 0, from)).toEqual([]);
    expect(computeNextFires({ mode: 'cron', expression: '0 9 * * *' }, 0, from)).toEqual([]);
  });

  test('`from` defaults to the current time when omitted', () => {
    const before = Date.now();
    const [fire] = computeNextFires({ mode: 'interval', every: 1, unit: 'minutes' }, 1);
    const after = Date.now();

    expect(fire).toBeDefined();
    const fireTime = Date.parse(fire!.id);
    expect(fireTime).toBeGreaterThan(before);
    expect(fireTime).toBeLessThanOrEqual(after + 60_000);
  });
});
