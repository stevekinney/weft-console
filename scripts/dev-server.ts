/**
 * Dev harness server (plan §2, T0.3, PROJECT-BRIEF "Dev harness"). Boots a
 * seeded local weft server on port 7233 that `bun run dev`'s Vite proxy
 * (`vite.config.ts`) targets. Run directly with `bun run dev:server`.
 *
 * Ground truth note: `serve()` is exported from `@lostgradient/weft/server`,
 * not the package root — the plan's §3.1 code sample names the root import,
 * but the actual export lives under the `/server` subpath (verified against
 * `weft/src/server/index.ts` and `weft/src/index.ts`).
 *
 * **Not using `serve()` here — upstream bug, not a style choice.**
 * `@lostgradient/weft@0.11.0`'s `scripts/build.ts` bundles `./src/server/index.ts`
 * into a single self-contained `dist/server/index.js` via `Bun.build()`,
 * which inlines its own private copy of `core/engine/internals.ts`'s
 * module-scoped `WeakMap` — separate from the one the *unbundled*
 * `dist/core/engine.js` (behind the root `@lostgradient/weft` export)
 * registers an `Engine` instance's internals into at construction time.
 * Any `Engine` built via the documented root import — `new Engine()` or
 * `Engine.create({ workflows })`, no difference — then throws "Engine
 * internals not initialized — initializeInternals(this) was not called in
 * the Engine constructor" the moment `serve({ engine })` touches it.
 * Reproduces with the published npm 0.11.0 tarball AND a from-source
 * `bun run build` off the current `weft` `main` (commit 4d758a67) —
 * minimal repro is `new Engine()` + `serve({ engine })`, nothing
 * console-specific. `@lostgradient/weft/server/handler`'s `handleRequest()`
 * — a bundled entrypoint too, but one that reads engine state only through
 * `Engine`'s own public methods rather than an externally-called
 * `getInternals(engine)` — does NOT hit this bug (verified: a root-imported
 * `Engine` served real data through it). This file is the PROJECT-BRIEF-
 * sanctioned "minimal app-local composition, file upstream" response: a
 * thin `Bun.serve()` that strips the `/api` prefix (root-stable discovery
 * routes — `/v1/health`, `/openapi.json`, etc. — are canonically
 * unprefixed; `handleRequest` expects canonical paths, and stripping the
 * prefix is exactly what `serve()`'s Bun route table does internally
 * before dispatch — see `weft/src/server/route-model.ts`'s `API_PREFIX`
 * doc comment) and delegates to `handleRequest`. This intentionally does
 * NOT attempt WebSocket upgrades: `serve()` owns that wiring and it is
 * inside the same broken bundle, so live workflow/fleet WebSocket tails
 * are unavailable in the dev harness until the upstream fix lands (SSE and
 * polling sources are unaffected — `handleRequest` returns ordinary
 * streaming `Response`s). File an upstream ticket against `weft` before
 * Phase 1's `T1.4` (`WorkflowTailSource`) lands, and delete this
 * workaround for a plain `serve({ engine, port: PORT, unauthenticatedAccess: 'warn' })`
 * once it's fixed and released.
 *
 * **Auth**: `unauthenticatedAccess: 'warn'` is a `serve()`-level policy with
 * no equivalent `HandlerOptions` field, and calling `handleRequest()` with
 * no `authContext` resolves every request to `anonymousPrincipal()`
 * (`weft/src/server/handler/auth-context-principal.ts`), which has no
 * scopes — public/direct-route endpoints like `/v1/health` work, but
 * scope-gated reads (e.g. `weft.reviews.list` behind `reviews:read`,
 * `weft.schedules.list` behind `schedules:read`) would 401. Every request
 * below instead carries an explicit `authContext.principal` built with
 * `principalFromStdioLocal()` — the full-scope local-admin principal weft
 * mints for trusted local processes (see `weft/src/server/principal.ts`) —
 * so every fixture domain (workflows, reviews, schedules, storage, …) is
 * readable and writable through this dev harness without a real API key.
 * This is a dev-only harness serving a `MemoryStorage`-backed engine on
 * localhost; there is no real access boundary to preserve here.
 *
 * **Fleet SSE (`/v1/events/sse`) is genuinely wired, not degraded.**
 * `handleRequest` only serves that route (and the per-workflow
 * `/v1/workflows/:id/events/sse`) when `HandlerOptions.fleetEventFeed` /
 * `.workflowEventFeed` are supplied — omitted, it 501s (confirmed by
 * direct repro: this is exactly what the console's shell (T1.6) observed
 * as a stuck "reconnecting" pill before this file wired the feed below).
 * `wireEventBroadcasting()` (`@lostgradient/weft/server`, the SAME
 * function `serve()` itself uses in production) is unaffected by the
 * `serve()` bug above — it only calls `engine.addEventListener` and
 * `engine.storage`, both public — so it wires real engine-backed fleet
 * events here even though `serve()` itself can't be used. Only the FLEET
 * feed is wired: the per-workflow feed's production constructor
 * (`createWorkflowEventFeed`) isn't exported from any public subpath
 * (filed as https://github.com/stevekinney/weft/issues/714) and
 * reimplementing its atomic replay/live handoff for a dev script is out of
 * proportion to what any current console surface needs — no route
 * consumes `WorkflowTailSource` yet (Workflow Detail is still a Phase-2
 * placeholder). `/v1/workflows/:id/events/sse` (and JSON-RPC over HTTP,
 * `/jsonrpc` — also `serve()`-pipeline-only, not part of `handleRequest`
 * at all) stay unavailable here until the upstream `serve()` fix lands;
 * `client.operations[...]` calls (e.g. the sidebar's worker-health badge)
 * will 404 against this dev harness in the meantime.
 */
import { Engine } from '@lostgradient/weft';
import { principalFromStdioLocal } from '@lostgradient/weft/mcp';
import { wireEventBroadcasting } from '@lostgradient/weft/server';
import { handleRequest, type HandlerOptions } from '@lostgradient/weft/server/handler';

import { seed, workflows } from '../fixtures/workflows.ts';
import {
  encodeSequencedFeedCursor,
  InMemorySequencedFeed,
} from '../src/lib/live-source/in-memory-sequenced-feed.ts';

const PORT = 7233;
const API_PREFIX = '/api';

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

/**
 * Builds the FULL fleet-feed shape `wireEventBroadcasting()` needs
 * (`append`/`appendWorkflowEventIfPresent`/`replay`/`subscribe`/
 * `snapshotTailSequence`/`dispose`) over an `InMemorySequencedFeed`, which
 * only natively provides `replaySnapshot`/`subscribe`. `handleRequest`'s
 * `fleetEventFeed` option only needs `.subscribe` (structurally satisfied
 * by the same store), so both call sites share one instance below.
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
      cursor: encodeSequencedFeedCursor(nextSequence),
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

const fleet = createFleetEventFeedForWiring();

const handlerOptions: HandlerOptions = {
  authContext: { method: 'api-key', principal: principalFromStdioLocal() },
  fleetEventFeed: fleet.store,
};

const engine = await Engine.create({ workflows });

// `handleRequest`'s `Engine` parameter is the plain, default-registry
// `Engine` — not structurally assignable from the concretely-registry-typed
// `Engine.create({ workflows })` return value under strict TypeScript
// (`register()`'s return type varies with the registry). Same upstream
// type-design gap as `ServeOptions.engine`, filed at
// https://github.com/stevekinney/weft/issues/708 — `handleRequest` only
// calls registry-erased members, so the cast is a compile-time-only gap,
// not a real runtime concern.
const untypedEngine = engine as unknown as Engine;

// `wireEventBroadcasting()` needs the bound `Bun.serve()` instance (for
// `server.publish()`), so it can't run before the port is open — but
// `seed()` needs to run AFTER `wireEventBroadcasting()` attaches its
// `engine.addEventListener`, or the fleet feed's replay buffer would be
// missing every event the seeded fixtures emitted (workflow:started,
// human-review:requested, …). That leaves a real window where the port is
// open (so `GET /v1/health` is already green) but `seed()` hasn't finished,
// which a caller polling health-then-workflows (see the README quickstart
// and the T0 gate's curl sequence) would read as a seeding failure. Close
// that window by gating the request handler on a `readyPromise` that
// resolves only once `seed()` completes — every request, including
// `/v1/health`, now blocks until seeding is done, so "the health request
// got a response" implies "the fixtures are seeded," without reordering the
// event-wiring-before-seeding requirement above.
let readyPromise: Promise<void> = Promise.resolve();

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    await readyPromise;
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${API_PREFIX}/`)) {
      return handleRequest(request, untypedEngine, handlerOptions);
    }

    const canonicalPath = url.pathname.slice(API_PREFIX.length);
    const rewritten = new URL(canonicalPath + url.search, url.origin);
    return handleRequest(new Request(rewritten, request), untypedEngine, handlerOptions);
  },
});

wireEventBroadcasting(untypedEngine, server, { fleetEventFeed: fleet.wireOption });

readyPromise = seed(engine);
await readyPromise;

console.log(`weft dev server listening on ${server.url}`);
console.log(
  'Seeded fixture workflows: order-processing, payment-failing, long-sleeper, review-gate, ' +
    'checkout-coordination, trip-booking-saga, sandbox-session, ship-package-async, ' +
    'fulfillment-parent (+ validate-shipment, monitor-delivery), audit-trail-sweep, ' +
    'customer-outreach-campaign (x4), timeout/cancellation/resource/system-failure-demo, ' +
    'content-review (x3), inventory-sync-sweep',
);
console.log(
  'Seeded schedules: inventory-sync-every-5-minutes (active), nightly-inventory-audit (paused)',
);
console.log(
  'NOTE: fleet SSE (/v1/events/sse) is live (real engine events). WebSocket upgrades, ' +
    'per-workflow SSE tails, and JSON-RPC (/jsonrpc) are unavailable — see the module ' +
    'comment above (upstream weft bug, serve() bypassed).',
);
