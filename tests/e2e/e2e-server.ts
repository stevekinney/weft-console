/**
 * E2E-only weft server bootstrap (plan §11.4). `playwright.config.ts`'s
 * `webServer` array runs this directly (`bun tests/e2e/e2e-server.ts`)
 * before starting Vite. See `e2e-constants.ts` for why this is a dedicated
 * process rather than a `scripts/dev-server.ts` shared-file edit.
 *
 * Boots a real `serve({ engine, auth })` — same seeded fixtures the
 * interactive dev harness uses (`fixtures/workflows.ts`, append-only, read
 * here rather than mutated) — with a single static API key granted every
 * authorization scope, so every persona flow's list/mutation/admin
 * operation succeeds regardless of which scope it happens to require. The
 * console never sees this key through the `<ApiKeyEntry>` UI: Playwright
 * injects it straight into the runtime config script tag on every document
 * response (`auth-fixtures.ts`), so the app boots directly into the
 * authenticated `Shell` — see that file's module doc for why.
 *
 * Also registers one `RemoteWorker` under `E2E_DEPLOYMENT_NAME` so the
 * Workers → Fleet overview surface has a real deployment group to drain
 * (flow (e)). It advertises `order-processing`'s `chargeCard` activity —
 * already registered on the engine — but nothing ever dispatches a task to
 * it, so it is present purely as fleet inventory, never doing real work.
 *
 * Follows `scripts/dev-server.ts`'s documented seed-after-serve ordering
 * (fleet SSE listeners must be live before fixtures start firing lifecycle
 * events) and its accepted boot-window tradeoff: `serve()` starts accepting
 * connections synchronously, before `await seed(engine)` below resolves.
 * Reproducing a hard readiness guarantee would mean wrapping `serve()` in
 * another app-local `Bun.serve()` proxy — the same composition that
 * rewrite deliberately avoided. In practice this window is sub-millisecond
 * (in-memory `MemoryStorage`) against a Vite cold start that takes
 * multiple seconds, so Playwright's own `webServer` + first-test startup
 * latency already exceeds it; no test in this suite polls a data-bearing
 * endpoint before the UI's own retrying assertions would already tolerate
 * the gap.
 */
import { Engine, RemoteWorker } from '@lostgradient/weft';
import { serve } from '@lostgradient/weft/server';

import { seed, workflows } from '../../fixtures/workflows.ts';
import { E2E_API_KEY, E2E_DEPLOYMENT_NAME, E2E_SERVER_PORT } from './e2e-constants.ts';

// Mirrors `weft/src/server/authorization-scope.ts`'s `AUTHORIZATION_SCOPES`
// (not a public export — `src/lib/scopes.svelte.ts` keeps its own copy for
// the same reason, see that module's doc). This file can't import that
// module instead: it's a `.svelte.ts` rune-backed module that only parses
// under the Svelte compiler, and this script runs as plain Bun. Left
// untyped (no `AuthorizationScope` annotation, also not a public export)
// so each literal is checked contextually against `AuthConfig`'s own type
// at the `auth: { defaultApiKeyScopes: ALL_SCOPES }` call site below.
const ALL_SCOPES = [
  'workflows:read',
  'workflows:write',
  'workflows:admin',
  'schedules:read',
  'schedules:write',
  'signals:write',
  'updates:write',
  'queries:read',
  'reviews:read',
  'reviews:write',
  'attributes:read',
  'attributes:write',
  'tags:write',
  'streams:read',
  'events:read',
  'budget:read',
  'budget:write',
  'storage:read',
  'storage:write',
  'storage:admin',
  'workers:write',
  'system:read',
  'system:admin',
] as const;

const engine = await Engine.create({ workflows });

const server = serve({
  engine,
  port: E2E_SERVER_PORT,
  auth: {
    apiKeys: [E2E_API_KEY],
    defaultApiKeyScopes: ALL_SCOPES,
  },
});

await seed(engine);

const fleetWorker = new RemoteWorker({
  serverUrl: `ws://localhost:${E2E_SERVER_PORT}/v1/tasks/default/stream`,
  workerId: 'e2e-fleet-worker-1',
  deploymentName: E2E_DEPLOYMENT_NAME,
  workflows: {
    'order-processing': {
      name: 'order-processing',
      activities: {
        chargeCard: async () => ({ chargeId: 'unused-e2e-fixture-worker' }),
      },
    },
  },
  headers: { Authorization: `Bearer ${E2E_API_KEY}` },
});

await fleetWorker.connect();

console.log(`weft E2E server listening on ${server.url}`);
console.log(`Registered E2E fleet worker under deployment "${E2E_DEPLOYMENT_NAME}"`);
