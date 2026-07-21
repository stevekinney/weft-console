/**
 * Workflow status → presentation mapping (plan T2.4, §10.1 status badge
 * system) + contextual-action availability for the detail header.
 *
 * ## "Finalizing" / "Cancelled — cleanup failed" are not implemented here
 *
 * Plan §9.2 and Appendix B call for a `finalizing` (amber, post-cancellation
 * cleanup) and a `cancelled — cleanup failed` (red) sub-status on the header
 * badge. Verified against weft v0.11.0 (`src/core/types/state.ts`,
 * `src/core/types/identity.ts`, `src/core/engine/index.ts` `get()`): the
 * seven-member `WorkflowStatus` union has no such members, `WorkflowState`
 * carries no finalizer-teardown field, and `Engine.get()` does not enrich the
 * state with one — the engine's `teardownOwed`/finalizer bookkeeping
 * (`src/core/engine/lifecycle/start-terminal-conflict-purge.ts`) is an
 * internal storage key never returned over `GET /api/v1/workflows/:id` or
 * any other public operation. There is no honest way to derive these two
 * sub-states client-side today. Filed upstream — see this track's final
 * report. This module maps exactly the seven real `WorkflowStatus` values;
 * add the two sub-states here (and to `availableActions` below) the day the
 * engine exposes the signal, rather than fabricating one now.
 */
import type { WorkflowStatus } from '@lostgradient/weft';

import type { BadgeVariant } from '@lostgradient/cinder/badge';

export type WorkflowStatusIcon =
  'clock' | 'play' | 'pause' | 'circle-check' | 'circle-x' | 'ban' | 'timer-off';

export interface WorkflowStatusPresentation {
  readonly label: string;
  readonly variant: BadgeVariant;
  readonly icon: WorkflowStatusIcon;
}

/** Status → badge tone/label/icon (plan §10.1: green running, blue/slate pending, amber suspended, red failed/timed-out, gray terminal). */
const STATUS_PRESENTATION: Readonly<Record<WorkflowStatus, WorkflowStatusPresentation>> = {
  pending: { label: 'Pending', variant: 'info', icon: 'clock' },
  running: { label: 'Running', variant: 'success', icon: 'play' },
  suspended: { label: 'Suspended', variant: 'warning', icon: 'pause' },
  completed: { label: 'Completed', variant: 'neutral', icon: 'circle-check' },
  failed: { label: 'Failed', variant: 'danger', icon: 'circle-x' },
  cancelled: { label: 'Cancelled', variant: 'neutral', icon: 'ban' },
  'timed-out': { label: 'Timed out', variant: 'danger', icon: 'timer-off' },
};

export function workflowStatusPresentation(status: WorkflowStatus): WorkflowStatusPresentation {
  return STATUS_PRESENTATION[status];
}

const TERMINAL_STATUSES: ReadonlySet<WorkflowStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
  'timed-out',
]);

export function isTerminalStatus(status: WorkflowStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Contextual header actions this track owns (plan T2.4). `client.get()`
 * catalog verification (weft v0.11.0
 * `src/server/operations/single-workflow-control-operation.ts`): cancel,
 * suspend, resume, and force-timeout all declare `access: { kind: 'public'
 * }` — no scope is required server-side, so these are never scope-gated in
 * the UI (a scope tooltip here would be fabricated). `suspend` is a no-op on
 * a non-running workflow per its own description, so it's only offered while
 * `running`; `resume` targets the interactive `suspended` case.
 */
export type WorkflowContextualAction = 'cancel' | 'suspend' | 'resume' | 'force-timeout';

const ACTIONS_BY_STATUS: Readonly<Record<WorkflowStatus, readonly WorkflowContextualAction[]>> = {
  pending: ['cancel', 'force-timeout'],
  running: ['cancel', 'suspend', 'force-timeout'],
  suspended: ['resume', 'cancel', 'force-timeout'],
  completed: [],
  failed: [],
  cancelled: [],
  'timed-out': [],
};

export function availableActions(status: WorkflowStatus): readonly WorkflowContextualAction[] {
  return ACTIONS_BY_STATUS[status];
}

/**
 * Confirmation tier per action (plan §10.6). `cancel`/`force-timeout` are
 * irreversible from the caller's perspective (their own operation
 * descriptions say so) — Tier 2 modal. `suspend`/`resume` are fully
 * reversible round-trips of each other — no modal, direct action.
 */
export type ActionConfirmTier = 'direct' | 'tier-2';

const ACTION_CONFIRM_TIER: Readonly<Record<WorkflowContextualAction, ActionConfirmTier>> = {
  cancel: 'tier-2',
  'force-timeout': 'tier-2',
  suspend: 'direct',
  resume: 'direct',
};

export function actionConfirmTier(action: WorkflowContextualAction): ActionConfirmTier {
  return ACTION_CONFIRM_TIER[action];
}

const ACTION_LABEL: Readonly<Record<WorkflowContextualAction, string>> = {
  cancel: 'Cancel',
  suspend: 'Suspend',
  resume: 'Resume',
  'force-timeout': 'Force timeout',
};

export function actionLabel(action: WorkflowContextualAction): string {
  return ACTION_LABEL[action];
}
