/**
 * Test-only support module (never imported by production code). Boots a
 * REAL in-process weft server for T1.4's integration tests — no mock
 * server; see `sequenced-test-feed.test-support.ts`'s module doc for what
 * "real" means here and why the feed injection is not a mock.
 *
 * **Why not `serve({ engine, port: 0 })`, as the task literally names.**
 * Confirmed by direct repro (not assumed): the published
 * `@lostgradient/weft@0.11.0` `serve()` throws "Engine internals not
 * initialized" for ANY `Engine.create({ workflows })` instance — a
 * dual-module-instance bug between the unbundled root `dist/index.js` and
 * the fully-bundled `dist/server/index.js`. Filed as
 * https://github.com/stevekinney/weft/issues/710. `scripts/dev-server.ts`
 * (T0.3) already established the workaround this module follows: a thin
 * `Bun.serve()` delegating to `handleRequest` from
 * `@lostgradient/weft/server/handler`, which reads engine state only
 * through `Engine`'s own public methods (never the module-scope
 * `getInternals()` free function `serve()` uses), so it does not hit the
 * same bug.
 *
 * **Feeds are genuinely engine-backed, not synthetic.**
 *   - Fleet feed: wired via `wireEventBroadcasting()` (`@lostgradient/weft/server`
 *     — real, exported, public), the SAME function `serve()` itself uses in
 *     production, covering the full `CLIENT_VISIBLE_EVENT_TYPES` set. Also
 *     confirmed empirically not to hit the `getInternals()` bug above — it
 *     only touches `engine.addEventListener` and `engine.storage`, public
 *     surface, never the free `getInternals()` function.
 *   - Per-workflow feed (`/v1/workflows/:id/events/sse`): weft's production
 *     wiring for this is `createEngineEventFeedBackend` + `createWorkflowEventFeed`
 *     (`server/engine-event-feed-backend.ts` / `server/workflow-event-feed.ts`),
 *     neither exported from any public subpath — filed as
 *     https://github.com/stevekinney/weft/issues/714. This module
 *     reimplements the same bridge using the exact public `Engine` methods
 *     that unexported backend uses (`subscribeWorkflowFeedCommits`), feeding
 *     a `sequenced-test-feed.test-support.ts` store.
 *
 * `bridgeWorkflowEvents(workflowId)` wires ONLY the per-workflow feed (call
 * before starting that workflow, with an explicit `{ id }`, so nothing is
 * missed) — the fleet feed needs no such per-workflow registration; it's
 * wired once, globally, for the server's whole lifetime.
 *
 * **Auth**: `handleRequest()` with no `authContext` resolves every request
 * to `anonymousPrincipal()` (no scopes) — every scope-gated route (fleet
 * SSE needs `events:read`, per-workflow SSE needs `events:read`/
 * `streams:read`) would 401/403. `principalFromStdioLocal()`
 * (`@lostgradient/weft/mcp`) grants every declared scope, matching what a
 * trusted local/CLI caller gets in production — appropriate here since
 * these tests exercise `LiveSource` wire behavior, not authorization.
 *
 * **No WebSocket.** `handleRequest` handles ordinary HTTP requests only;
 * WS upgrade handling lives inside `serve()`'s own wiring (same broken
 * bundle). `WorkflowTailSource` integration tests must force
 * `eventTransport: 'sse'` on their `HttpClient` — SSE and polling are
 * unaffected by any of the above (`handleRequest` returns ordinary
 * streaming `Response`s for both).
 */
import { Engine } from '@lostgradient/weft';
import { principalFromStdioLocal } from '@lostgradient/weft/mcp';
import { wireEventBroadcasting } from '@lostgradient/weft/server';
import { handleRequest } from '@lostgradient/weft/server/handler';

import { workflows } from '../../../fixtures/workflows.ts';
import { encodeTestCursor, InMemorySequencedFeed } from './sequenced-test-feed.test-support.ts';

type FeedSelector = 'events' | 'tokens';

interface EventEnvelopeLike {
  readonly kind: string;
  readonly workflowId: string;
  readonly selector: FeedSelector;
  readonly sequence: number;
  readonly cursor: string;
  readonly emittedAtMs: number;
  readonly payload: unknown;
}

interface FleetEventEnvelopeLike {
  readonly kind: string;
  readonly workflowId?: string;
  readonly sequence: number;
  readonly cursor: string;
  readonly emittedAtMs: number;
  readonly payload: unknown;
}

interface FleetEventInputLike {
  readonly kind: string;
  readonly workflowId?: string;
  readonly emittedAtMs: number;
  readonly payload: unknown;
}

/** Structural match for `Engine`'s (unexported) `WorkflowFeedRecord` — inferred contextually from `subscribeWorkflowFeedCommits`'s real declared signature, never named explicitly. */
function envelopeFromFeedRecord(record: {
  kind: string;
  workflowId: string;
  selector: FeedSelector;
  sequence: number;
  timestamp: number;
  payload: unknown;
}): EventEnvelopeLike {
  return {
    kind: record.kind,
    workflowId: record.workflowId,
    selector: record.selector,
    sequence: record.sequence,
    cursor: encodeTestCursor(record.sequence),
    emittedAtMs: record.timestamp,
    payload: record.payload,
  };
}

/**
 * Builds the FULL `FleetEventFeed` shape `wireEventBroadcasting()` needs
 * (`append`/`appendWorkflowEventIfPresent`/`replay`/`subscribe`/
 * `snapshotTailSequence`/`dispose`) over an `InMemorySequencedFeed`, which
 * only natively provides `replaySnapshot`/`subscribe`. Sequence numbers are
 * assigned here, on append — the caller never supplies one (matching the
 * real `FleetEventFeed.append(event: FleetEventInput)` contract, where
 * `FleetEventInput` carries no `sequence`/`cursor`).
 */
function createFleetEventFeedForWiring(): {
  readonly store: InMemorySequencedFeed<FleetEventEnvelopeLike>;
  readonly wireOption: {
    append: (event: FleetEventInputLike) => Promise<FleetEventEnvelopeLike>;
    appendWorkflowEventIfPresent: (
      event: FleetEventInputLike & { workflowId: string },
    ) => Promise<FleetEventEnvelopeLike | null>;
    replay: (options?: {
      fromCursor?: string;
      limit?: number;
    }) => AsyncIterable<FleetEventEnvelopeLike>;
    subscribe: (
      options?: Parameters<InMemorySequencedFeed<FleetEventEnvelopeLike>['subscribe']>[0],
    ) => AsyncIterable<FleetEventEnvelopeLike>;
    snapshotTailSequence: () => Promise<number>;
    dispose: () => void;
  };
} {
  const store = new InMemorySequencedFeed<FleetEventEnvelopeLike>();
  let nextSequence = 0;

  function append(event: FleetEventInputLike): FleetEventEnvelopeLike {
    nextSequence += 1;
    const envelope: FleetEventEnvelopeLike = {
      kind: event.kind,
      ...(event.workflowId === undefined ? {} : { workflowId: event.workflowId }),
      sequence: nextSequence,
      cursor: encodeTestCursor(nextSequence),
      emittedAtMs: event.emittedAtMs,
      payload: event.payload,
    };
    store.append(envelope);
    return envelope;
  }

  return {
    store,
    wireOption: {
      append: async (event) => append(event),
      appendWorkflowEventIfPresent: async (event) => append(event),
      replay: (options) => store.replaySnapshot(options?.fromCursor, options?.limit),
      subscribe: (options) => store.subscribe(options),
      snapshotTailSequence: async () => nextSequence,
      dispose: () => {},
    },
  };
}

export interface LiveSourceTestServer {
  /** Canonical, unprefixed base URL (e.g. `http://localhost:PORT`) — no `/api` prefix, matching what `handleRequest` expects and what `HttpClient` itself always requests against (`${baseUrl}/v1${path}`, verified in `weft/src/client/http-request.ts`). */
  readonly baseUrl: string;
  readonly engine: Engine;
  /**
   * Wires `workflowId`'s real committed checkpoint events (both selectors)
   * into the per-workflow SSE feed. Call BEFORE starting the workflow
   * (pass an explicit `{ id }` to `engine.start()`) so nothing is missed.
   * The fleet feed needs no equivalent call — it's wired globally at boot.
   * Returns an unsubscribe function.
   */
  bridgeWorkflowEvents(workflowId: string): () => void;
  stop(): void;
}

export async function startLiveSourceTestServer(): Promise<LiveSourceTestServer> {
  const engine = await Engine.create({ workflows });

  const workflowFeed = new InMemorySequencedFeed<EventEnvelopeLike>();

  function bridgeWorkflowEvents(workflowId: string): () => void {
    const unsubscribers = (['events', 'tokens'] as const).map((selector) =>
      engine.subscribeWorkflowFeedCommits(workflowId, selector, (record) => {
        workflowFeed.append(envelopeFromFeedRecord(record));
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }

  // `Engine.create({ workflows })`'s concrete registry type is not
  // structurally assignable to the plain `Engine` `handleRequest` (and this
  // module's own exposed `engine` field) expects (its `register()` return
  // type varies with the registry) — the same upstream type-design gap
  // `scripts/dev-server.ts` casts around
  // (https://github.com/stevekinney/weft/issues/708). Every method these
  // tests call (`start`, `signal`, `setAttributes`, `subscribeWorkflowFeedCommits`,
  // …) is registry-erased, so this is compile-time-only.
  const untypedEngine = engine as unknown as Engine;

  const fleet = createFleetEventFeedForWiring();

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      return handleRequest(request, untypedEngine, {
        authContext: { method: 'public', principal: principalFromStdioLocal() },
        fleetEventFeed: fleet.store,
        workflowEventFeed: {
          replay: (args) => replayScoped(workflowFeed, args),
          subscribe: (args) => subscribeScoped(workflowFeed, args),
          dispose: () => {},
        },
      });
    },
  });

  wireEventBroadcasting(untypedEngine, server, { fleetEventFeed: fleet.wireOption });

  return {
    baseUrl: server.url.toString().replace(/\/+$/, ''),
    engine: untypedEngine,
    bridgeWorkflowEvents,
    stop: () => server.stop(true),
  };
}

function matchesScope(
  envelope: EventEnvelopeLike,
  workflowId: string,
  selector: FeedSelector,
): boolean {
  return envelope.workflowId === workflowId && envelope.selector === selector;
}

async function* replayScoped(
  store: InMemorySequencedFeed<EventEnvelopeLike>,
  args: { workflowId: string; selector: FeedSelector; fromCursor?: string; limit?: number },
): AsyncGenerator<EventEnvelopeLike, void, void> {
  for await (const envelope of store.replaySnapshot(args.fromCursor, args.limit)) {
    if (matchesScope(envelope, args.workflowId, args.selector)) yield envelope;
  }
}

function subscribeScoped(
  store: InMemorySequencedFeed<EventEnvelopeLike>,
  args: { workflowId: string; selector: FeedSelector } & Parameters<
    InMemorySequencedFeed<EventEnvelopeLike>['subscribe']
  >[0],
): AsyncIterable<EventEnvelopeLike> {
  const { workflowId, selector, filterEnvelope, ...rest } = args;
  return store.subscribe({
    ...rest,
    filterEnvelope: (envelope) =>
      matchesScope(envelope, workflowId, selector) && (filterEnvelope?.(envelope) ?? true),
  });
}
