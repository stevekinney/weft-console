/**
 * Live-feed-only observations for two signals `getTimeline()`/`GET
 * /api/v1/workflows/:id` never carry (plan T3.2's finalizer badges, T3.4's
 * async-activity completion drawer): the durable async-activity completion
 * token, and finalizer teardown outcome.
 *
 * ## Why this exists — and its one real limitation
 *
 * Verified against weft v0.11.0 and a live dev-harness curl of `GET
 * /api/v1/events/sse?workflowId=<id>` on both the `ship-package-async` and
 * `sandbox-session` fixtures: `activity:async-pending` (carrying `token`,
 * `operationId`, `activityName`, `attempt`) and `workflow:teardown`
 * (carrying `status`/`attempts`/`error`) are both in
 * `EVENTS_READ_EVENT_TYPES`, so the fleet feed (`GET …/events/sse`, NOT the
 * durable per-workflow event log — `getEvents()` only ever records
 * `workflow:checkpoint` markers, see `events-tab.svelte`) replays them on a
 * FRESH connection (confirmed live: a brand-new SSE connection to the
 * async-activity fixture replayed its `activity:async-pending` frame,
 * `payload.token` intact, before the `replayComplete` ping). Neither
 * `WorkflowState` nor `WorkflowTimelineEntry` carries a token or finalizer
 * field at all — this is the ONLY way the console can discover either.
 *
 * That replay is per-CONNECTION, not per-subscriber: `FleetEventSource`
 * (`lib/live-source/fleet-event-source.svelte.ts`) shares ONE connection
 * app-wide (plan §5's ≤3-socket budget) and does not re-deliver
 * already-dispatched frames to a subscriber that joins after the shared
 * connection's replay phase has already passed.
 *
 * **Confirmed empirically (live browser, fresh tab, dev harness) that this
 * NEVER actually recovers replay in this app today.** This class is
 * instantiated from `workflow-detail.svelte`'s mount specifically to join
 * as early as this track's files can reach — but `src/app/shell/shell.svelte`
 * constructs `EngineStatusController` (`src/app/engine-status.svelte.ts`),
 * whose constructor calls `this.fleetSource.subscribe(...)` SYNCHRONOUSLY,
 * and the shell mounts before any route (including workflow detail) ever
 * does. That shell subscription is therefore always the first subscriber on
 * every page load, always wins the shared connection's one-time replay, and
 * every later subscriber — this one included, no matter how early within
 * route-level code it runs — only ever sees frames emitted AFTER that. Two
 * fresh-tab, direct-URL loads of the `ship-package-async`/`sandbox-session`
 * fixtures' Timeline tab (bypassing every other page) both confirmed the
 * async-pending badge and finalizer strip never populate, even though a
 * bare `curl` of the same SSE endpoint at the same moment does replay the
 * event — proving the gap is this ordering, not server-side event
 * eviction. This is a genuine Foundation-layer property
 * (`FleetEventSource` has no "buffer replay for late joiners" mode), out of
 * this track's owned paths to fix. The code below is kept — it is correct,
 * fully unit-tested, and does the right thing on `activity:async-pending`
 * frames that DO arrive live (an operator watching the Timeline tab in real
 * time while a token is minted) — but do not expect it to populate on a
 * typical page load. Filed upstream: a durable, queryable
 * pending-async-activity listing operation and a finalizer-status field on
 * `WorkflowState` remove the need for replay-racing entirely; alternatively
 * `FleetEventSource` could buffer its own catch-up backlog for late
 * subscribers. See this track's final report.
 *
 * Never reconstructs a token by re-deriving weft's internal
 * `async-act:v1:<workflowId>:<step>:<attempt>` format
 * (`deriveAsyncActivityToken`, unexported from `@lostgradient/weft`) — that
 * would be fragile coupling to a private implementation detail (confirmed
 * live: its internal step numbering is 0-indexed, off by one from the
 * timeline's 1-indexed `step`), exactly the kind of magic-string special
 * case this repo's CLAUDE.md forbids.
 */
import type { QueryClient } from '@tanstack/svelte-query';

import type { FleetEventFrame } from '../../../../lib/live-source/fleet-event-source.svelte.ts';
import { workflowTimelineQueryKey } from '../workflow-timeline-data.ts';

export interface PendingAsyncActivityObservation {
  readonly token: string;
  readonly operationId: string;
  readonly activityName: string;
  readonly attempt: number;
  readonly observedAt: number;
}

export type FinalizerTeardownStatus = 'completed' | 'failed' | 'dead-lettered';

export interface FinalizerTeardownObservation {
  readonly status: FinalizerTeardownStatus;
  readonly attempts: number;
  readonly error: string | undefined;
  readonly observedAt: number;
}

interface AsyncPendingPayload {
  readonly token: string;
  readonly operationId: string;
  readonly activityName: string;
  readonly attempt: number;
}

function isAsyncPendingPayload(payload: unknown): payload is AsyncPendingPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as Record<string, unknown>)['token'] === 'string' &&
    typeof (payload as Record<string, unknown>)['operationId'] === 'string' &&
    typeof (payload as Record<string, unknown>)['activityName'] === 'string' &&
    typeof (payload as Record<string, unknown>)['attempt'] === 'number'
  );
}

interface TeardownPayload {
  readonly status: FinalizerTeardownStatus;
  readonly attempts: number;
  readonly error?: string;
}

const TEARDOWN_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'dead-lettered']);

function isTeardownPayload(payload: unknown): payload is TeardownPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const record = payload as Record<string, unknown>;
  return (
    typeof record['status'] === 'string' &&
    TEARDOWN_STATUSES.has(record['status']) &&
    typeof record['attempts'] === 'number' &&
    (record['error'] === undefined || typeof record['error'] === 'string')
  );
}

const TERMINAL_WITH_POSSIBLE_FINALIZER: ReadonlySet<string> = new Set([
  'workflow:cancelled',
  'workflow:timed-out',
]);

export interface FleetSubscribable {
  subscribe(
    onFrame: (frame: FleetEventFrame) => void,
    filter?: { readonly kind?: string; readonly workflowId?: string },
  ): () => void;
  readonly caughtUp: boolean;
}

/**
 * Subscribes to the shared fleet feed for one workflow's lifetime (owned by
 * whoever constructs it — `workflow-detail.svelte` does, at mount, so this
 * starts as close to page-load as this track's files can reach without
 * itself opening a second fleet connection). Call `dispose()` on unmount.
 */
export class WorkflowLiveObservations {
  pendingAsyncActivities = $state<PendingAsyncActivityObservation[]>([]);
  finalizerTeardown = $state<FinalizerTeardownObservation | null>(null);
  /**
   * True only for a cancel/timeout transition observed AFTER the shared
   * connection's replay caught up (`fleet.caughtUp`) — a REPLAYED
   * cancel/timeout with no subsequent teardown is indistinguishable from
   * "this workflow type has no finalizer at all" (weft exposes no
   * finalizer-presence field anywhere — see `workflow-status.ts`'s sibling
   * finding), so replay never sets this, only a live transition does.
   */
  finalizingLive = $state(false);

  readonly #unsubscribe: () => void;

  constructor(
    fleet: FleetSubscribable,
    queryClient: Pick<QueryClient, 'invalidateQueries'>,
    workflowId: string,
  ) {
    this.#unsubscribe = fleet.subscribe(
      (frame) => this.#handleFrame(frame, fleet, queryClient, workflowId),
      { workflowId },
    );
  }

  #handleFrame(
    frame: FleetEventFrame,
    fleet: FleetSubscribable,
    queryClient: Pick<QueryClient, 'invalidateQueries'>,
    workflowId: string,
  ): void {
    if (frame.kind === 'activity:async-pending' && isAsyncPendingPayload(frame.payload)) {
      const payload = frame.payload;
      if (this.pendingAsyncActivities.some((observed) => observed.token === payload.token)) return;
      this.pendingAsyncActivities = [
        ...this.pendingAsyncActivities,
        {
          token: payload.token,
          operationId: payload.operationId,
          activityName: payload.activityName,
          attempt: payload.attempt,
          observedAt: frame.emittedAtMs,
        },
      ];
    } else if (frame.kind === 'workflow:teardown' && isTeardownPayload(frame.payload)) {
      const payload = frame.payload;
      this.finalizerTeardown = {
        status: payload.status,
        attempts: payload.attempts,
        error: payload.error,
        observedAt: frame.emittedAtMs,
      };
      this.finalizingLive = false;
    } else if (TERMINAL_WITH_POSSIBLE_FINALIZER.has(frame.kind)) {
      if (fleet.caughtUp && this.finalizerTeardown === null) this.finalizingLive = true;
    }

    // Any frame for this workflow may have moved a timeline entry's status
    // (e.g. an externally-completed async activity resuming the run to its
    // next step) — refetch so a stale "still running" badge self-heals
    // without this module needing its own removal signal (see module doc:
    // there is no `activity:completed`/`activity:failed` event for the
    // async-completion path at all).
    void queryClient.invalidateQueries({ queryKey: workflowTimelineQueryKey(workflowId) });
  }

  /** Optimistically drops a token from the observed-pending list right after this console's own drawer resolves it — see module doc for why the fleet feed itself never signals removal. */
  forgetToken(token: string): void {
    this.pendingAsyncActivities = this.pendingAsyncActivities.filter(
      (observed) => observed.token !== token,
    );
  }

  dispose(): void {
    this.#unsubscribe();
  }
}
