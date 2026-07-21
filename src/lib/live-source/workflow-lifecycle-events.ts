/**
 * Workflow lifecycle event `.type` → `WorkflowStatus` mapping, shared by
 * `WorkflowTailSource` (needs to know when a tail should stop reconnecting)
 * and `cache-integration.ts` (needs to know when to patch a cached
 * `WorkflowSummary.status`). Kept in one module so both agree on the exact
 * same event-type set instead of each maintaining its own copy.
 *
 * weft's own `WORKFLOW_TERMINAL_EVENT_TYPES` (`core/events/workflow-
 * events.ts`) is not a public export, so this is the console's own copy —
 * built from the individual event classes' `.type` statics
 * (`WorkflowCompletedEvent.type` etc.), which ARE public root exports, so
 * this can't silently drift on the *names*, only on the *set* (re-verify
 * against `WorkflowStatus`'s terminal members on every `@lostgradient/weft`
 * bump — `'suspended'` is deliberately excluded: a suspended workflow is
 * resumable, not terminal, per that type's own doc comment).
 */
import {
  WorkflowCancelledEvent,
  WorkflowCompletedEvent,
  WorkflowFailedEvent,
  WorkflowResumedEvent,
  WorkflowStartedEvent,
  WorkflowSuspendedEvent,
  WorkflowTimedOutEvent,
  type WorkflowStatus,
} from '@lostgradient/weft';

const WORKFLOW_STATUS_BY_EVENT_TYPE: ReadonlyMap<string, WorkflowStatus> = new Map([
  [WorkflowStartedEvent.type, 'running'],
  [WorkflowResumedEvent.type, 'running'],
  [WorkflowSuspendedEvent.type, 'suspended'],
  [WorkflowCompletedEvent.type, 'completed'],
  [WorkflowFailedEvent.type, 'failed'],
  [WorkflowCancelledEvent.type, 'cancelled'],
  [WorkflowTimedOutEvent.type, 'timed-out'],
]);

const TERMINAL_WORKFLOW_STATUSES: ReadonlySet<WorkflowStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
  'timed-out',
]);

/** The `WorkflowStatus` a lifecycle event type transitions to, or `null` for event types that don't represent a status change (most events — activity/signal/attribute events etc.). */
export function workflowStatusForEventType(type: string): WorkflowStatus | null {
  return WORKFLOW_STATUS_BY_EVENT_TYPE.get(type) ?? null;
}

/** Whether `type` is a lifecycle event that puts the workflow into a terminal `WorkflowStatus`. */
export function isTerminalWorkflowEventType(type: string): boolean {
  const status = workflowStatusForEventType(type);
  return status !== null && TERMINAL_WORKFLOW_STATUSES.has(status);
}
