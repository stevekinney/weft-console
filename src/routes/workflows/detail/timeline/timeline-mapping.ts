/**
 * `WorkflowTimelineEntry[]` (`GET …/timeline`) → Cinder `RunStepTimelineEntry[]`
 * (plan T3.1/T3.2). Trusts the server timeline rather than re-deriving
 * attempts client-side (this repo's CLAUDE.md, plan §9.9 portability caveat).
 *
 * ## What this module can and cannot honestly render
 *
 * Verified against weft v0.11.0 (`src/core/types/state.ts`
 * `WorkflowTimelineEntry`, `src/core/engine/checkpoint-io.ts`
 * `appendTimelineBatchOperations`/`finalizePendingTimelineEntry`, and a live
 * dev-harness curl against the `checkout-coordination` and
 * `trip-booking-saga` fixtures):
 *
 * - **One entry per durable step**, not per attempt. There is no
 *   `attemptCount`, per-attempt error, heartbeat, or retry-policy data
 *   anywhere in `WorkflowTimelineEntry` — a retried activity collapses into
 *   one entry carrying only its FINAL status. `RunStep.attemptCount` is
 *   therefore always left `undefined` here rather than guessed at 1.
 * - **Saga compensation is real, structural data — not a guess.**
 *   `ctx.saga()` (`weft/src/core/context/saga.ts`) names its compensating
 *   activity call literally `` `compensate:${forwardStep.name}` ``, which
 *   becomes the timeline entry's `operationLabel` via
 *   `getTimelineOperationLabel`'s `activityName` case (confirmed live:
 *   `trip-booking-saga`'s timeline has `operationLabel: "compensate:reserveHotel"`
 *   immediately after `"reserveHotel"`). This module reads that
 *   deterministic, engine-established naming convention to set `compensates`
 *   — it is not inferring anything from business data.
 * - **Coordination groups (`ctx.race`/`ctx.all`/`ctx.speculate`) genuinely
 *   degrade to one opaque step.** Verified live: a `checkout-coordination`
 *   run's `race`/`parallel` (the operation type for `ctx.all`)/`speculate`
 *   operations each produce exactly ONE timeline entry with
 *   `inputSummary: '{"operationCount":2}'` and a single `outputSummary` for
 *   the whole group — no per-branch id, label, duration, or winner/loser
 *   outcome is recorded anywhere the client can read. Cinder's
 *   `RunStepBranchGroup` (lanes with individual steps and outcomes) cannot
 *   be honestly populated from this data, so this module never emits one —
 *   it renders a single step labeled with the operation kind and (when the
 *   input summary carries it) the branch count, and says so in a detail
 *   panel. Filed upstream (weft) for per-branch timeline detail; see this
 *   track's final report.
 * - **No timeline entry exists for finalizer execution at all** — durable
 *   finalizers run on the engine host outside the normal workflow generator
 *   (this repo's CLAUDE.md), so `destroySandbox`-style teardown never
 *   appears in `getTimeline()`. See `workflow-live-observations.svelte.ts`
 *   for the (live-event-only) finalizer strip this track builds instead.
 */
import type { WorkflowTimelineEntry } from '@lostgradient/weft';

import type { RunStep, RunStepDetail } from '@lostgradient/cinder/run-step-timeline';

import { formatDuration } from '../../../../lib/format/index.ts';
import { timelineStepStatus } from './timeline-step-state.ts';

const COMPENSATE_PREFIX = 'compensate:';

/** Structural operation types with no single "name" field — displayed by kind, not by `operationLabel` (which just repeats `operationType` for these). */
const STRUCTURAL_OPERATION_LABEL: Readonly<Record<string, string>> = {
  race: 'Race',
  parallel: 'All (parallel)',
  speculate: 'Speculate',
  sleep: 'Sleep',
  memo: 'Memo',
  offload: 'Offload',
  archive: 'Archive',
  stream: 'Stream',
  'wait-condition': 'Wait for condition',
  'state-read': 'Read state',
  'state-commit': 'Write state',
  'wait-review': 'Human review',
};

/** Operation types whose `operationLabel` (via `getTimelineOperationLabel`) is already a meaningful name. */
const NAMED_OPERATION_PREFIX: Readonly<Record<string, string>> = {
  'wait-signal': 'Signal',
  'wait-update': 'Update',
  'child-workflow': 'Child',
  'get-version': 'Version check',
  load: 'Load',
};

/** Best-effort `{ operationCount: number }` read out of a coordination entry's `inputSummary` JSON. `null` when absent or malformed — never guessed. */
function parseOperationCount(inputSummary: string): number | null {
  try {
    const parsed: unknown = JSON.parse(inputSummary);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'operationCount' in parsed &&
      typeof (parsed as { operationCount: unknown }).operationCount === 'number'
    ) {
      return (parsed as { operationCount: number }).operationCount;
    }
  } catch {
    // Not JSON, or not the shape we expect — fall through to `null`.
  }
  return null;
}

/** Display label for one timeline entry (plan T3.1/T3.2 — see module doc for what's real vs. degraded). */
export function timelineEntryLabel(entry: WorkflowTimelineEntry): string {
  if (entry.operationType === 'activity') return entry.operationLabel;

  const namedPrefix = NAMED_OPERATION_PREFIX[entry.operationType];
  if (namedPrefix !== undefined) return `${namedPrefix}: ${entry.operationLabel}`;

  const structuralLabel = STRUCTURAL_OPERATION_LABEL[entry.operationType];
  if (structuralLabel === undefined) return entry.operationLabel;

  const operationCount = parseOperationCount(entry.inputSummary);
  return operationCount === null ? structuralLabel : `${structuralLabel} · ${operationCount} branches`;
}

/** True for the structural coordination operation types that degrade to one opaque step (see module doc). */
export function isDegradedCoordinationEntry(entry: WorkflowTimelineEntry): boolean {
  return entry.operationType === 'race' || entry.operationType === 'parallel' ||
    entry.operationType === 'speculate';
}

/** `compensate:<name>` → the forward step's real name, or `null` when this entry isn't a saga compensation. */
export function compensatedActivityName(entry: WorkflowTimelineEntry): string | null {
  if (entry.operationType !== 'activity') return null;
  if (!entry.operationLabel.startsWith(COMPENSATE_PREFIX)) return null;
  return entry.operationLabel.slice(COMPENSATE_PREFIX.length);
}

/**
 * Resolves each compensating entry's `compensates` id to the LATEST prior
 * (in step order) plain-activity entry sharing the compensated name — a
 * saga's forward call for a given activity is unique per run, so "latest
 * prior match" is unambiguous here, unlike the child-workflow-id case this
 * track deliberately does not guess at.
 */
function resolveCompensationTargets(
  entries: readonly WorkflowTimelineEntry[],
): ReadonlyMap<number, number> {
  const forwardStepByName = new Map<string, number>();
  const compensatesStep = new Map<number, number>();

  for (const entry of entries) {
    const compensatedName = compensatedActivityName(entry);
    if (compensatedName !== null) {
      const forwardStep = forwardStepByName.get(compensatedName);
      if (forwardStep !== undefined) compensatesStep.set(entry.step, forwardStep);
      continue;
    }
    if (entry.operationType === 'activity') forwardStepByName.set(entry.operationLabel, entry.step);
  }

  return compensatesStep;
}

/** The `RunStep.id` this module mints for a given timeline step number — exported so sibling modules (async-activity step matching) mint the identical id rather than duplicating the format. */
export function timelineStepId(step: number): string {
  return `step-${step}`;
}

/** Given a mapped step id (`step-N`) back to its timeline step number, or `null` if it isn't one of ours. */
export function stepNumberFromRunStepId(id: string): number | null {
  const match = /^step-(\d+)$/.exec(id);
  if (match === null) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function buildDetails(entry: WorkflowTimelineEntry): RunStepDetail[] {
  const details: RunStepDetail[] = [
    { id: `${timelineStepId(entry.step)}-input`, label: 'Input', content: entry.inputSummary },
  ];

  if (entry.outputSummary !== undefined) {
    details.push({
      id: `${timelineStepId(entry.step)}-output`,
      label: entry.status === 'failed' || entry.status === 'timed-out' ? 'Error' : 'Output',
      content: entry.outputSummary,
    });
  }

  if (isDegradedCoordinationEntry(entry)) {
    details.push({
      id: `${timelineStepId(entry.step)}-coordination-note`,
      label: 'About this step',
      content:
        'The timeline API records one entry for the whole coordinated operation — ' +
        'per-branch labels, durations, and winner/loser outcomes are not available. ' +
        'Filed upstream; see the workflow detail track report.',
    });
  }

  return details;
}

/**
 * Maps the full timeline to Cinder `RunStep[]` in step order. Always a flat
 * array — `WorkflowTimelineEntry` has no parent/child structure, so this
 * module never nests via `RunStep.children` (nesting is reserved for the
 * genuinely-recoverable case Cinder documents; Weft's child-workflow entries
 * don't qualify — see `workflow-timeline-data.ts`).
 */
export function mapTimelineToSteps(entries: readonly WorkflowTimelineEntry[]): RunStep[] {
  const compensatesStep = resolveCompensationTargets(entries);

  return entries.map((entry) => {
    const compensatesTargetStep = compensatesStep.get(entry.step);
    const step: RunStep = {
      id: timelineStepId(entry.step),
      label: timelineEntryLabel(entry),
      status: timelineStepStatus(entry.status),
      startTime: new Date(entry.timestamp).toISOString(),
      details: buildDetails(entry),
      ...(entry.duration !== undefined
        ? {
            duration: formatDuration(entry.duration),
            endTime: new Date(entry.timestamp + entry.duration).toISOString(),
          }
        : {}),
      ...(compensatesTargetStep !== undefined
        ? { compensates: timelineStepId(compensatesTargetStep) }
        : {}),
    };
    return step;
  });
}
