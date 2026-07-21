/**
 * The shell's one shared `FleetEventSource` connection (plan §5's ≤3-socket
 * connection budget: "one fleet SSE … never per-row/per-surface
 * connections") plus the `/v1/health` polling fallback that backs the
 * sidebar's engine-status pill (plan §13 T1.6).
 *
 * `FleetEventSource`'s `baseUrl`/`headers` reuse the already-constructed
 * `HttpClient`'s own public `baseUrl`/`headers` fields verbatim (both
 * `readonly` on `HttpClient`, `weft/src/client/http-client.ts`) rather than
 * re-deriving them from runtime config — `HttpClient` and `FleetEventSource`
 * are proven, by `live-source-test-server.test-support.ts` (T1.4's own
 * integration-test harness), to expect the SAME unprefixed origin (no
 * `/api`; the server's HTTP front door matches `/v1/...` directly, `/api`
 * being an optional external namespace it strips before routing) — so no
 * new base-URL-resolution logic is needed here at all.
 *
 * Every notification-worthy frame is forwarded into the shell's
 * `NotificationStore` (`./notifications.svelte.ts`) — this module is the
 * ONE place a fleet frame is received and fanned out, so a future
 * dashboard/list-liveness consumer subscribing to the same shared source
 * never doubles the connection.
 */
import type { HttpClient } from '@lostgradient/weft/client';

import {
  FleetEventSource,
  type FleetEventFrame,
} from '../lib/live-source/fleet-event-source.svelte.ts';
import { PollingSource } from '../lib/live-source/polling-source.svelte.ts';
import type { LiveSourceStatus } from '../lib/live-source/types.ts';
import type { NotificationStore } from './notifications.svelte.ts';

const DEFAULT_HEALTH_POLL_INTERVAL_MS = 20_000;

/**
 * Plan §5.3: "SSE fails repeatedly (cap 5 attempts, then surface status)".
 * Matches `PollingSource`'s own `MAX_CONSECUTIVE_FAILURES` cap so the two
 * fallback triggers (principal lacks `events:read` vs. SSE flapping) read as
 * one consistent policy.
 */
const FLEET_STATUS_FALLBACK_AFTER_ATTEMPTS = 5;

async function checkHealth(client: Pick<HttpClient, 'baseUrl' | 'headers'>): Promise<true> {
  const response = await fetch(`${client.baseUrl}/v1/health`, { headers: client.headers });
  if (!response.ok) throw new Error(`weft-console: /v1/health responded ${response.status}`);
  return true;
}

export interface EngineStatusControllerOptions {
  /** Overrides the `/v1/health` poll interval — tests inject a small value rather than waiting out the real 20s default. */
  readonly healthPollIntervalMs?: number;
  /** Overrides the fleet source's reconnect backoff curve — tests inject a near-zero function rather than waiting out the real 1s+/attempt curve to reach the fallback cap. */
  readonly fleetReconnectDelayMs?: (attempt: number) => number;
}

export class EngineStatusController {
  readonly fleetSource: FleetEventSource;
  readonly #healthPoll: PollingSource<true>;
  readonly #unsubscribeFleet: () => void;
  readonly #unsubscribeHealth: () => void;

  constructor(
    client: Pick<HttpClient, 'baseUrl' | 'headers'>,
    notifications: NotificationStore,
    options?: EngineStatusControllerOptions,
  ) {
    this.fleetSource = new FleetEventSource({
      baseUrl: client.baseUrl,
      headers: client.headers,
      ...(options?.fleetReconnectDelayMs === undefined
        ? {}
        : { computeReconnectDelayMs: options.fleetReconnectDelayMs }),
    });
    this.#healthPoll = new PollingSource(() => checkHealth(client), {
      intervalMs: options?.healthPollIntervalMs ?? DEFAULT_HEALTH_POLL_INTERVAL_MS,
    });

    this.#unsubscribeFleet = this.fleetSource.subscribe((frame: FleetEventFrame) => {
      notifications.ingest(frame);
    });
    this.#unsubscribeHealth = this.#healthPoll.subscribe(() => {});
  }

  /**
   * The pill's displayed status: the fleet feed's real connection state
   * whenever it is connecting/live/closed, falling back to the `/v1/health`
   * poll's status once the fleet feed has failed to reconnect
   * `FLEET_STATUS_FALLBACK_AFTER_ATTEMPTS` times in a row (plan §5.3: "SSE
   * fails repeatedly (cap 5 attempts, then surface status)").
   *
   * The fleet source keeps retrying in the background at its own capped
   * curve even after the fallback engages (`backoff.ts` never stops on its
   * own — see that module's doc) — so if the push channel comes back the
   * pill recovers to `'live'` on its own the next successful frame, with no
   * action needed here. Falling back on `fleetSource.status === 'closed'`
   * alone (the original design) was dead code in steady-state failure: the
   * constructor's synchronous `subscribe()` call flips `FleetEventSource`
   * straight to `'connecting'`, and it then cycles
   * `'connecting'`/`'reconnecting'` forever on a down server — it never
   * settles back to `'closed'` short of an explicit `dispose()` — so the
   * pill would read "reconnecting" indefinitely with no health-poll fallback
   * ever visible. The `reconnectAttempt` check below is what actually makes
   * the fallback reachable.
   */
  get status(): LiveSourceStatus {
    const fleetFailedRepeatedly =
      this.fleetSource.reconnectAttempt >= FLEET_STATUS_FALLBACK_AFTER_ATTEMPTS;
    return this.fleetSource.status === 'closed' || fleetFailedRepeatedly
      ? this.#healthPoll.status
      : this.fleetSource.status;
  }

  dispose(): void {
    this.#unsubscribeFleet();
    this.#unsubscribeHealth();
    this.fleetSource.close();
    this.#healthPoll.close();
  }
}
