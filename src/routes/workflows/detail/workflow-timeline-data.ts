/**
 * Pure derivations over `GET …/timeline` (`client.getTimeline(id)`) for the
 * Signals and Children tabs (plan T2.6).
 *
 * ## Why the timeline, not `getEvents()`
 *
 * Verified empirically against a live dev-harness workflow (start a
 * `signal-stepped` fixture run, send it a signal, diff `GET
 * …/events` before/after): the durable per-workflow event log
 * (`engine.getEvents()`, weft v0.11.0 `src/core/engine/checkpoint-reads.ts`)
 * records only `workflow:checkpoint` markers (`{ step }`) — no
 * `signal:received`/`update:received`/`child-workflow` entries ever appear
 * there, regardless of what `EVENTS_READ_EVENT_TYPES` documents for the
 * live fleet/tail channels. `GET …/timeline`
 * (`engine.getTimeline()`), by contrast, records one rich entry per durable
 * operation — `operationType: 'wait-signal'` with `operationLabel` as the
 * signal name, `operationType: 'child-workflow'` with `operationLabel` as
 * the child's workflow type — confirmed against the same live workflow.
 * This module reads that instead. (The Timeline *tab*'s own UI, T3.1, is a
 * different track; this module only calls the same read-only
 * `client.getTimeline()` the Timeline tab will also call — no coupling to
 * its component.)
 *
 * ## Children: id is not recoverable, and this module does not fabricate one
 *
 * `WorkflowTimelineEntry.outputSummary` is `JSON.stringify(sanitize(result))`
 * (weft `src/core/debug-output.ts` `safeDebugStringify`). For a DETACHED
 * child (`parentClosePolicy: 'abandon'`/`'request-cancel'`), the operation
 * resolves with `ChildWorkflowHandle` (`{ id }`), so `outputSummary` really
 * is `{"id":"..."}`. For an AWAITED child (the default), it resolves with
 * the child's own application `TResult` — arbitrary data that may or may
 * not coincidentally contain an `id` field. There is no way to tell these
 * two cases apart from the timeline alone, so guessing would risk a
 * navigation link pointing at the wrong workflow (silently reading an
 * unrelated `id` field off a child's business result). This module never
 * attempts that: `ChildTimelineRow.workflowId` is always `null`. See this
 * track's final report for the upstream issue tracking a real
 * parent→child relationship operation.
 */
import type { WorkflowTimelineEntry, WorkflowTimelineStatus } from '@lostgradient/weft';
import type { QueryKey } from '@tanstack/svelte-query';

/** Shared `getTimeline(id)` query key — used by the Lineage panel (children), the Signals tab (history), and the Children tab, so all three read the same TanStack Query cache entry instead of drifting into separately-keyed duplicate fetches. */
export function workflowTimelineQueryKey(workflowId: string): QueryKey {
  return ['workflows', 'timeline', workflowId];
}

export interface SignalTimelineRow {
  readonly step: number;
  readonly name: string;
  readonly status: WorkflowTimelineStatus;
  readonly timestamp: number;
}

/** Signals delivered to a `ctx.waitForSignal()` wait point, oldest first. Signals sent while the workflow was not yet waiting for them are not visible here — see module doc. */
export function signalHistoryFromTimeline(
  entries: readonly WorkflowTimelineEntry[],
): SignalTimelineRow[] {
  return entries
    .filter((entry) => entry.operationType === 'wait-signal')
    .map((entry) => ({
      step: entry.step,
      name: entry.operationLabel,
      status: entry.status,
      timestamp: entry.timestamp,
    }));
}

export interface ChildTimelineRow {
  readonly step: number;
  readonly type: string;
  readonly status: WorkflowTimelineStatus;
  readonly timestamp: number;
  readonly duration: number | undefined;
  /** Always `null` — see module doc "Children: id is not recoverable". */
  readonly workflowId: null;
}

/** Child-workflow operations started from this run, oldest first. */
export function childWorkflowsFromTimeline(
  entries: readonly WorkflowTimelineEntry[],
): ChildTimelineRow[] {
  return entries
    .filter((entry) => entry.operationType === 'child-workflow')
    .map((entry) => ({
      step: entry.step,
      type: entry.operationLabel,
      status: entry.status,
      timestamp: entry.timestamp,
      duration: entry.duration,
      workflowId: null,
    }));
}
