/**
 * Session-scoped "recent fires" tracker for the Schedule Detail page (Track
 * B, plan §9.3: "history of fired runs; live update on schedule:fired via
 * FleetEventSource").
 *
 * Weft has no queryable link from a schedule back to the workflow runs it
 * launched — no REST/JSON-RPC operation, no `scheduleId` field on
 * `WorkflowSummary`/`ListFilter` (verified against `weft/src/core/types/
 * list-options.ts` and `state.ts`, v0.11.0). The only place that linkage
 * ever surfaces on the wire is the live `schedule:fired` fleet event, whose
 * `payload` carries `{ scheduleId, workflowId, firedAt, occurrence? }`
 * (`ScheduleFiredEvent`, serialized verbatim by
 * `weft/src/server/runtime/event-broadcasting.ts` `serializeEvent`). This
 * class accumulates those events for one schedule id, so the "recent runs"
 * list is real, live data — honestly scoped to "observed this session",
 * matching the same sanctioned pattern the Alerts view uses for its own
 * no-persisted-list gap (plan §9.7 T7.6, "since page load" labeled).
 * Follow-up upstream request tracked — see this track's final report.
 *
 * Reuses the shell's ONE shared `FleetEventSource` (via
 * `../../app/engine-status.svelte.ts`'s `getFleetEventSource()`) rather than
 * opening a second connection — plan §5's connection budget.
 */
import type {
  FleetEventFrame,
  FleetEventSource,
} from '../../lib/live-source/fleet-event-source.svelte.ts';

/** The one `FleetEventSource` method this tracker needs, narrowed so a test can pass a minimal fake instead of scripting a real SSE connection. */
export type FiredRunFleetSource = Pick<FleetEventSource, 'subscribe'>;

export interface ScheduleFiredRun {
  readonly workflowId: string;
  readonly firedAt: number;
  readonly occurrence?: number;
}

const MAX_TRACKED_RUNS = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(payload: unknown, key: string): string | undefined {
  if (!isRecord(payload)) return undefined;
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

function numberField(payload: unknown, key: string): number | undefined {
  if (!isRecord(payload)) return undefined;
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toFiredRun(frame: FleetEventFrame): ScheduleFiredRun | null {
  const workflowId = stringField(frame.payload, 'workflowId');
  if (workflowId === undefined) return null;
  const occurrence = numberField(frame.payload, 'occurrence');
  return {
    workflowId,
    firedAt: numberField(frame.payload, 'firedAt') ?? frame.emittedAtMs,
    ...(occurrence !== undefined ? { occurrence } : {}),
  };
}

export interface ScheduleFiredRunTrackerOptions {
  /** Called for every `schedule:fired`/`schedule:missed-fire` frame matching this schedule — the caller's cue to refetch the schedule detail query (fresh `missedFireCount`/`nextFireAt`/`currentWorkflowId`). */
  readonly onRelevantEvent?: () => void;
}

/** Live-accumulates `schedule:fired` runs for one schedule id from the shared fleet feed. */
export class ScheduleFiredRunTracker {
  runs: ScheduleFiredRun[] = $state([]);

  readonly #unsubscribe: () => void;

  constructor(
    source: FiredRunFleetSource,
    scheduleId: string,
    options?: ScheduleFiredRunTrackerOptions,
  ) {
    this.#unsubscribe = source.subscribe((frame) => {
      if (frame.kind !== 'schedule:fired' && frame.kind !== 'schedule:missed-fire') return;
      if (stringField(frame.payload, 'scheduleId') !== scheduleId) return;

      options?.onRelevantEvent?.();

      if (frame.kind !== 'schedule:fired') return;
      const run = toFiredRun(frame);
      if (run === null) return;
      // De-duplicate by workflowId — a reconnect's replay can redeliver an
      // already-seen frame (plan §5.1's cursor-resume catch-up).
      if (this.runs.some((existing) => existing.workflowId === run.workflowId)) return;
      this.runs = [run, ...this.runs].slice(0, MAX_TRACKED_RUNS);
    });
  }

  dispose(): void {
    this.#unsubscribe();
  }
}
