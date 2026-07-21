/**
 * Formatting helpers (plan §4, §10.8, T1.3): id truncation, durations,
 * bytes, relative time, and the `computeNextFires` callback ScheduleBuilder
 * (Cinder) is date-library-free and expects consumers to inject (plan §7.1,
 * `design/README.md` "ScheduleBuilder"). Frozen after the Phase 1
 * Foundation gate — see PROJECT-BRIEF "Shared contracts".
 */
import { CronExpressionParser } from 'cron-parser';

import type { ScheduleFire, ScheduleValue } from '@lostgradient/cinder';

/**
 * Truncates a high-cardinality id to `first8…last4` for display (plan §10.8).
 * IDs shorter than 13 characters (8 + 1 ellipsis + 4) are returned unchanged
 * — there is nothing useful to hide.
 */
export function truncateId(id: string): string {
  if (id.length <= 13) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

const DURATION_UNITS: readonly { readonly ms: number; readonly label: string }[] = [
  { ms: 86_400_000, label: 'd' },
  { ms: 3_600_000, label: 'h' },
  { ms: 60_000, label: 'm' },
  { ms: 1_000, label: 's' },
];

/**
 * Formats a millisecond duration as a compact human string, e.g. `1h 20m`,
 * `45s`, `500ms`. Shows at most two significant units.
 */
export function formatDuration(milliseconds: number): string {
  const absolute = Math.abs(milliseconds);
  if (absolute < 1_000) return `${Math.round(milliseconds)}ms`;

  const sign = milliseconds < 0 ? '-' : '';
  const parts: string[] = [];
  let remaining = absolute;

  for (const { ms, label } of DURATION_UNITS) {
    if (remaining < ms) continue;
    const value = Math.floor(remaining / ms);
    remaining -= value * ms;
    parts.push(`${value}${label}`);
    if (parts.length === 2) break;
  }

  return sign + (parts.length > 0 ? parts.join(' ') : '0s');
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Formats a byte count as e.g. `1.2 KB`, `340 B`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${BYTE_UNITS[unitIndex]}`;
}

/**
 * Formats a timestamp relative to `now` as e.g. `2m ago`, `in 3h`, `just now`.
 */
export function formatRelativeTime(timestampMs: number, now: number = Date.now()): string {
  const deltaMs = timestampMs - now;
  const absolute = Math.abs(deltaMs);
  if (absolute < 5_000) return 'just now';

  const suffix = deltaMs < 0 ? 'ago' : undefined;
  const prefix = deltaMs > 0 ? 'in' : undefined;
  const magnitude = formatDuration(absolute).split(' ')[0] ?? formatDuration(absolute);

  return suffix ? `${magnitude} ${suffix}` : `${prefix} ${magnitude}`;
}

// ---------------------------------------------------------------------------
// computeNextFires — injected into Cinder's ScheduleBuilder (plan §7.1/§7.2 C3)
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;

/**
 * The next `count` fires of a 5-field cron expression (minute hour
 * day-of-month month day-of-week — the field order `ScheduleValue`'s `cron`
 * mode documents), strictly after `from`. Delegates to `cron-parser`
 * (`CronExpressionParser`) rather than hand-rolling field/range/alias
 * parsing: it already handles month/day-of-week name aliases (`MON`,
 * `JAN-MAR`, …), step/range/list syntax, and POSIX day-of-month ×
 * day-of-week OR semantics correctly. A 5-field expression is accepted
 * as-is — `cron-parser` defaults the (unused) seconds field to `0`.
 * Malformed expressions or out-of-range field values throw synchronously
 * from `CronExpressionParser.parse`; that throw is intentionally left to
 * propagate rather than swallowed, so an invalid schedule fails loudly
 * instead of silently previewing zero fires.
 */
function nextCronFires(expression: string, count: number, from: Date): readonly Date[] {
  const interval = CronExpressionParser.parse(expression, { currentDate: from });
  return interval.take(count).map((cronDate) => cronDate.toDate());
}

function nextIntervalFires(
  every: number,
  unit: 'minutes' | 'hours' | 'days' | 'weeks',
  count: number,
  from: Date,
): readonly Date[] {
  const unitMs: Record<typeof unit, number> = {
    minutes: MINUTE_MS,
    hours: 60 * MINUTE_MS,
    days: 24 * 60 * MINUTE_MS,
    weeks: 7 * 24 * 60 * MINUTE_MS,
  };
  const stepMs = every * unitMs[unit];

  const fires: Date[] = [];
  let next = from.getTime() + stepMs;
  for (let index = 0; index < count; index += 1) {
    fires.push(new Date(next));
    next += stepMs;
  }
  return fires;
}

const FIRE_LABEL_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * The `computeNextFires` callback injected into Cinder's `ScheduleBuilder`
 * (plan §7.1/§7.2 C3). Signature takes an optional `from` (defaulting to
 * `new Date()`) so it can be passed straight through as
 * `ScheduleBuilderProps['computeNextFires']`, which only ever calls it with
 * `(value, count)`. `cron` mode's field parsing/timezone handling is
 * `cron-parser`'s and throws on a malformed expression or an out-of-range
 * field; `interval` mode is a plain fixed-step walk and trusts `every` to be
 * the positive integer `ScheduleValue` documents.
 */
export function computeNextFires(
  value: ScheduleValue,
  count: number,
  from: Date = new Date(),
): ScheduleFire[] {
  const dates =
    value.mode === 'cron'
      ? nextCronFires(value.expression, count, from)
      : nextIntervalFires(value.every, value.unit, count, from);

  return dates.map((date) => ({
    id: date.toISOString(),
    label: FIRE_LABEL_FORMATTER.format(date),
  }));
}
