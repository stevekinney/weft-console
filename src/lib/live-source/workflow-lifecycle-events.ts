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
 *
 * The event *classes* themselves (`WorkflowStartedEvent` etc.) are root-only
 * value exports: importing any one of them forces a bundler to resolve
 * `@lostgradient/weft`'s package-root barrel (`dist/index.js`), which also
 * re-exports server-only code reaching `node:crypto`
 * (`server/authentication/constant-time-api-key.js`) — the same class of
 * browser-bundle leak `isWeftFault`/`isWeftError*` had before
 * `@lostgradient/weft@0.12.0` moved them to `/client` (weft#722, fixed
 * upstream #733). The event classes haven't made that move yet — filed
 * upstream: https://github.com/stevekinney/weft/issues/751. Until then, this
 * module hardcodes each class's `static readonly type` string literal
 * (verified against the installed `@lostgradient/weft@0.12.0`
 * `dist/core/events/workflow-events.d.ts`) instead of importing the classes
 * as values, keeping this module's dependency graph browser-only end to
 * end. Only the `WorkflowStatus` *type* is imported from the root — types
 * are erased at compile time and never reach the bundler's module graph.
 */
import type { WorkflowStatus } from '@lostgradient/weft';

const WORKFLOW_STATUS_BY_EVENT_TYPE: ReadonlyMap<string, WorkflowStatus> = new Map([
  ['workflow:started', 'running'],
  ['workflow:resumed', 'running'],
  ['workflow:suspended', 'suspended'],
  ['workflow:completed', 'completed'],
  ['workflow:failed', 'failed'],
  ['workflow:cancelled', 'cancelled'],
  ['workflow:timed-out', 'timed-out'],
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
