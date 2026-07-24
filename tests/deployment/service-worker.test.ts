/**
 * Service Worker deployment-mode integration test (plan §3.3, T9.1).
 *
 * No real browser Service Worker is needed: `setupServiceWorker()`'s fetch
 * listener is a thin wrapper that strips the path prefix and calls
 * `handleRequest(request, engine)` (`@lostgradient/weft`'s
 * `src/service-worker/setup.ts`) — so a hand-built fake scope satisfying only
 * `{ addEventListener }` (the one method the setup helper calls) reaches the
 * exact same code a real Service Worker would run. Storage is
 * `IndexedDBStorage` backed by `fake-indexeddb` (via the constructor's
 * `runtime` param, not the `fake-indexeddb/auto` global side effect — keeps
 * this file self-contained without touching the shared `tests/setup.ts`
 * preload), matching what `setupServiceWorker()` itself defaults to in a
 * browser/Service Worker scope (plan §3.3).
 *
 * **A confirmed gap, not a buffering problem.** Plan §3.3 says "verify [SSE]
 * in an integration test in Phase 9 and file a weft issue if `handleRequest`
 * buffers instead of streams." `handleRequest` does NOT buffer — the second
 * `describe` block below proves genuine incremental delivery. The real gap is
 * upstream of that: `SetupServiceWorkerOptions` / `ServiceWorkerOptions` have
 * no way to pass `HandlerOptions` (`fleetEventFeed`, `workflowEventFeed`,
 * `authContext`) through to `handleRequest`, and `setupServiceWorker`'s own
 * fetch listener calls `handleRequest(delegatedRequest, engine)` with no
 * options at all (`src/service-worker/setup.ts`'s `buildFetchListener`). Two
 * consequences, both exercised below:
 *   1. Every request through the real SW entry point is always anonymous —
 *      there is no way to authenticate it — so any `scoped`/`authenticated`
 *      operation (fleet SSE's `events:read` included) 401s unconditionally.
 *   2. Even with a principal, fleet SSE would still fail: nothing ever
 *      constructs and passes a `fleetEventFeed`, so the operation throws
 *      `UnsupportedTransport` before `createFleetEventFeed`'s streaming
 *      behavior is ever reached through this entry point.
 * This is a newly-surfaced gap in weft's public `service-worker` API (not the
 * same thing as the separately-tracked server auth-posture gap — that one is
 * about operations not checking a principal's scopes; this one is about the
 * SW entry point never producing a non-anonymous principal, or a fleet feed,
 * at all), and not something this track patches locally — weft's
 * `service-worker` module is ground-truth, read-only; it needs its own
 * upstream issue. The README documents the workaround in the meantime: a
 * host that needs SW-mode SSE hand-rolls a `fetch` listener with
 * `buildDelegatedRequest` + explicit `HandlerOptions`, bypassing the
 * `setupServiceWorker` convenience wrapper for that one concern.
 */
import { Engine, workflow } from '@lostgradient/weft';
import { principalFromApiKey } from '@lostgradient/weft/mcp';
import {
  createFleetEventFeed,
  handleRequest,
  type FleetEventFeed,
} from '@lostgradient/weft/server/handler';
import { setupServiceWorker, type MinimalFetchEvent } from '@lostgradient/weft/service-worker';
import { IndexedDBStorage } from '@lostgradient/weft/storage/indexeddb';
import { describe, expect, it } from 'bun:test';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

const pingWorkflow = workflow({ name: 'deployment-sw-ping' }).execute(async function* (
  _ctx,
  input: { message: string },
) {
  yield;
  return { echoed: input.message };
});

function createIndexedDbStorage(): { storage: IndexedDBStorage; cleanup: () => void } {
  const databaseName = `weft-console-sw-test-${crypto.randomUUID()}`;
  const storage = new IndexedDBStorage(databaseName, { indexedDB, IDBKeyRange });
  return {
    storage,
    cleanup: () => {
      storage[Symbol.dispose]();
      try {
        indexedDB.deleteDatabase(databaseName);
      } catch {
        // Best-effort cleanup; ignore errors (mirrors weft's own
        // `storage-backends.test-support.ts` IndexedDBStorage fixture).
      }
    },
  };
}

interface FakeServiceWorkerScope {
  addEventListener(type: string, listener: (event: MinimalFetchEvent) => void): void;
}

/**
 * Minimal fake `self` scope + fetch-event dispatcher. Mirrors the technique
 * weft's own `src/service-worker/setup.test.ts` uses: install a fake `self`
 * global (the one thing `setupServiceWorker` reads to find the SW scope),
 * capture the listener it registers for `'fetch'`, and drive it by calling
 * that listener with an object satisfying `MinimalFetchEvent`
 * (`{ request, respondWith }`) — no real browser or `ServiceWorkerGlobalScope`
 * involved.
 */
function createFakeServiceWorkerScope(): {
  scope: FakeServiceWorkerScope;
  dispatchFetch: (request: Request) => Promise<Response>;
} {
  let fetchListener: ((event: MinimalFetchEvent) => void) | null = null;
  const scope: FakeServiceWorkerScope = {
    addEventListener(type, listener) {
      if (type === 'fetch') fetchListener = listener;
    },
  };
  return {
    scope,
    dispatchFetch(request) {
      if (fetchListener === null) {
        throw new Error('no fetch listener registered — setupServiceWorker did not attach one');
      }
      return new Promise<Response>((resolve, reject) => {
        fetchListener?.({
          request,
          respondWith: (response) => {
            return Promise.resolve(response).then(resolve, reject);
          },
        });
      });
    },
  };
}

/**
 * Installs a fake `self` global for the duration of `run()`, then restores
 * whatever was there before. No registry reset is needed afterward:
 * `setupServiceWorker`'s "already initialized" guard is a `WeakMap` keyed by
 * the scope object's own identity (`src/service-worker/setup.ts`'s
 * `setupRegistry`), and `resetSetupServiceWorkerRegistry` — the test-only
 * helper weft's own suite uses to clear it — is not re-exported from the
 * public `@lostgradient/weft/service-worker` barrel. Each test below creates
 * its own fresh scope object via `createFakeServiceWorkerScope()`, so there is
 * no shared identity to reset in the first place.
 */
async function withFakeSelf<T>(scope: FakeServiceWorkerScope, run: () => Promise<T>): Promise<T> {
  const previous = (globalThis as { self?: unknown }).self;
  (globalThis as { self?: unknown }).self = scope;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete (globalThis as { self?: unknown }).self;
    else (globalThis as { self?: unknown }).self = previous;
  }
}

describe('Service Worker mode — REST via a real setupServiceWorker() fetch listener', () => {
  it('serves a workflow read through IndexedDBStorage, end to end, through the fake SW fetch boundary', async () => {
    const { scope, dispatchFetch } = createFakeServiceWorkerScope();
    const { storage, cleanup } = createIndexedDbStorage();

    try {
      await withFakeSelf(scope, async () => {
        const setup = await setupServiceWorker({
          storage,
          register: (engine) => {
            engine.register(pingWorkflow);
          },
        });

        const handle = await setup.engine.start('deployment-sw-ping', { message: 'hello' });

        // `pathPrefix` defaults to `/weft/`; the fetch listener strips it
        // before delegating, so `/weft/v1/workflows/:id` reaches
        // `handleRequest` as `/v1/workflows/:id` — `weft.workflows.get`'s
        // REST binding (`access: 'public'`, confirmed in
        // `src/server/operations/get-workflow.ts`).
        const response = await dispatchFetch(
          new Request(`https://sw-host.example/weft/v1/workflows/${handle.id}`),
        );

        expect(response.status).toBe(200);
        const body = (await response.json()) as { id: string; type: string; status: string };
        expect(body.id).toBe(handle.id);
        expect(body.type).toBe('deployment-sw-ping');
        expect(typeof body.status).toBe('string');
      });
    } finally {
      cleanup();
    }
  });

  it('cannot reach a scoped operation (fleet SSE) — the fetch listener never authenticates a principal', async () => {
    const { scope, dispatchFetch } = createFakeServiceWorkerScope();
    const { storage, cleanup } = createIndexedDbStorage();

    try {
      await withFakeSelf(scope, async () => {
        await setupServiceWorker({ storage });

        const response = await dispatchFetch(
          new Request('https://sw-host.example/weft/v1/events/sse', {
            headers: { Accept: 'text/event-stream' },
          }),
        );

        // `weft.events.sse` declares `access: { kind: 'scoped', scopes: {
        // anyOf: ['events:read'] } }` (`src/server/operations/fleet-events-sse.ts`).
        // `buildFetchListener` calls `handleRequest(delegatedRequest, engine)`
        // with no `HandlerOptions`, so `authContextToPrincipal(undefined)`
        // always resolves to `anonymousPrincipal()` — this 401s before the
        // pipeline ever reaches the (also-missing) `fleetEventFeed` check.
        expect(response.status).toBe(401);
      });
    } finally {
      cleanup();
    }
  });
});

function operatorPrincipalAuthContext() {
  return {
    method: 'api-key' as const,
    principal: principalFromApiKey({ subject: 'sw-deployment-test', scopes: ['events:read'] }),
  };
}

describe('Service Worker mode — fleet SSE streams incrementally through handleRequest (not buffered)', () => {
  it('delivers a live-appended fleet event over the open Response body without waiting for the stream to end', async () => {
    const { storage, cleanup } = createIndexedDbStorage();
    const engine = new Engine({ storage });
    const fleetEventFeed: FleetEventFeed = createFleetEventFeed(engine.storage);
    const abortController = new AbortController();

    try {
      const request = new Request('https://sw-host.example/v1/events/sse', {
        headers: { Accept: 'text/event-stream' },
        signal: abortController.signal,
      });

      // The fleet feed's `subscribe()` never completes on its own for a live
      // stream with no persisted backlog (only `close()`/abort ends it) — if
      // `handleRequest` buffered the whole SSE body before returning a
      // `Response`, this `await` could never resolve. It resolving at all,
      // well inside the test's timeout, is itself part of the streaming
      // proof; the incremental reads below are the rest of it.
      const response = await handleRequest(request, engine, {
        authContext: operatorPrincipalAuthContext(),
        fleetEventFeed,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      if (response.body === null) throw new Error('expected a streamed body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = '';

      async function readUntil(predicate: (text: string) => boolean): Promise<void> {
        while (!predicate(buffered)) {
          const { done, value } = await reader.read();
          if (done) throw new Error('stream closed before the expected frame arrived');
          buffered += decoder.decode(value, { stream: true });
        }
      }

      // Empty storage → replay is immediately complete; wait for that ready
      // ping so the append below is unambiguously a *live* delivery, not
      // something racing the replay-to-live handoff.
      await readUntil((text) => text.includes('"replayComplete":true'));

      const appended = await fleetEventFeed.append({
        kind: 'workflow:started',
        workflowId: 'sw-deployment-live-event',
        emittedAtMs: Date.now(),
        payload: { workflowId: 'sw-deployment-live-event' },
      });

      await readUntil((text) => text.includes(`id: ${appended.cursor}`));
      expect(buffered).toContain('event: workflow:started');
      expect(buffered).toContain('"workflowId":"sw-deployment-live-event"');

      await reader.cancel();
    } finally {
      abortController.abort();
      fleetEventFeed.dispose();
      cleanup();
    }
  });
});
