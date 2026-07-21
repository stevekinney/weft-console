# Weft Console

Operator console for the [Weft](https://github.com/stevekinney/weft) durable-workflow engine —
Svelte 5 + [Cinder](https://github.com/stevekinney/cinder). See
[`docs/implementation-plan.md`](docs/implementation-plan.md) for the full plan and
[`PROJECT-BRIEF.md`](PROJECT-BRIEF.md) for the agent-facing ground rules.

## Quickstart

```bash
bun install

# Terminal 1: a seeded local weft server on :7233 (fixture workflows from fixtures/workflows.ts)
bun run dev:server

# Terminal 2: the Vite dev server on :5173, proxying /api, /v1, and discovery routes to :7233
bun run dev
```

Open <http://localhost:5173>.

**Known upstream blocker (`@lostgradient/weft@0.11.0`)**: `scripts/dev-server.ts` does **not** call
`serve()` from `@lostgradient/weft/server` — doing so throws `Error: Engine internals not
initialized` for any `Engine` built via the documented root import (`new Engine()` or
`Engine.create({...})`, no difference). Root cause: weft's `scripts/build.ts` bundles
`./src/server/index.ts` into a single self-contained `dist/server/index.js` via `Bun.build()`,
which inlines its own private copy of `core/engine/internals.ts`'s module-scoped `WeakMap` —
separate from the one the _unbundled_ `dist/core/engine.js` (behind the root export) registers an
`Engine`'s internals into at construction. Reproduces with the published npm tarball and a
from-source build off `weft`'s current `main` (commit `4d758a67`); minimal repro is `new Engine()`

- `serve({ engine })`, nothing console-specific. `dev-server.ts` uses
  `@lostgradient/weft/server/handler`'s `handleRequest()` directly instead (also a bundled
  entrypoint, but one that reads engine state only through `Engine`'s own public methods, not an
  externally-called `getInternals(engine)` — verified working) behind a thin `Bun.serve()` that
  strips the `/api` prefix. This is the PROJECT-BRIEF-sanctioned "minimal app-local composition, file
  upstream" response — see the full comment at the top of `scripts/dev-server.ts` for the complete
  diagnosis and the auth/scope gap from bypassing `serve()`'s `unauthenticatedAccess` handling.
  **Fleet SSE (`/api/v1/events/sse`) is genuinely wired against real engine events** — `dev-server.ts`
  calls `wireEventBroadcasting()` (the same function `serve()` itself uses, unaffected by the bug
  above) directly. What stays unavailable until the upstream fix lands: WebSocket upgrades, the
  per-workflow tail (`/api/v1/workflows/:id/events/sse` — its production constructor isn't exported
  from any public subpath either, tracked separately), and JSON-RPC over HTTP (`/jsonrpc`, both live
  only inside `serve()`'s own pipeline, not `handleRequest`) — `client.operations[...]` calls (e.g.
  the sidebar's worker-health badge) 404 against this dev harness in the meantime. **File this
  upstream against `weft` before Phase 1** and delete the workaround for a plain
  `serve({ engine, port, unauthenticatedAccess: 'warn' })` once fixed and released. The _production_
  mount path this package exists for — `serve({ dashboard: weftConsole() })` — is blocked by the
  same bug and cannot be runtime-verified until then; `mount.test-d.ts` only proves `weftConsole()`'s
  return type, not that `serve()` can actually run with it.

## Scripts

| Script               | What it does                                                               |
| -------------------- | -------------------------------------------------------------------------- |
| `bun run dev`        | Vite dev server with full HMR.                                             |
| `bun run dev:server` | Boots a seeded local `weft` server (`scripts/dev-server.ts`) on port 7233. |
| `bun run build`      | Production build (Vite) → `dist/`.                                         |
| `bun run typecheck`  | `svelte-check` over the whole project.                                     |
| `bun run lint`       | `oxlint`.                                                                  |
| `bun run format`     | `prettier --write` (Svelte + import-organizing plugins).                   |
| `bun run test`       | `bun test` with the Svelte 5 compile plugin + happy-dom preload.           |

## Deployment modes

The same built bundle (`dist/`) boots in three modes, distinguished only by how it's served and
which realtime transport is viable — see plan §3 for the full detail:

1. **Bun server mount** (primary) — `serve({ engine, dashboard: weftConsole() })` from
   `@lostgradient/weft/server`. `src/mount.ts` exports `weftConsole()`.
2. **Service Worker** — the engine runs inside a browser Service Worker
   (`setupServiceWorker`); the host page serves `dist/` itself and the console boots with
   `{ baseUrl: '/weft', eventTransport: 'sse' }` (WebSocket upgrades can't cross a Service
   Worker).
3. **Standalone / cross-origin** — the console on a different origin than the `weft` server,
   via weft's `cors` option.

All three read their runtime configuration from one place: the
`<script type="application/json" id="weft-console-config">` block in `index.html`
(`src/lib/config.ts` reads and validates it). **Security note**: the shell HTML is served
before weft's `auth` handler runs (Bun's static route table is matched first) — `auth` protects
the API, not the page itself. Deployments that must hide the shell put it behind a reverse
proxy or private network.

## Toolchain decisions (Phase 0, plan §2/§13 T0.2–T0.3)

- **Vite for both dev and production build** — one pipeline, not a dev/prod split. Compiler-integrated
  HMR via `@sveltejs/vite-plugin-svelte` is the proven path for Svelte 5 (runes-aware, no full-page
  reloads, CSS hot-applies). Production `bun run build` runs `vite build`: content-hashed assets,
  external sourcemaps, and one chunk per route via the dynamic imports in `src/app/routes.ts`
  (`src/routes/dashboard/cards.ts` gives each dashboard card its own chunk boundary too).
- **`@tanstack/svelte-query` v5, store API (not the v6 runes API)** — v5's Svelte-5 support is via
  its store contract (`createQuery(...)` returns a Svelte store; read it with `$query` inside a
  component). The runes-native rewrite is a v6 feature (`svelte: '^5.25.0'` peer, a from-scratch
  API) and was not pulled in because the console is pinned to v5 by the scaffolding task. Verified
  with a real mounted smoke test (`tests/tanstack-query-smoke*.svelte` + `.test.ts`), not just a
  type check — and that test caught a real footgun:
  - **Pass a plain options object, `createQuery({...})` — NOT `createQuery(() => ({...}))`.**
    `createQuery`'s parameter type is `StoreOrVal<T> = T | Readable<T>`: a plain value or a real
    Svelte store (something with `.subscribe`), never a callback. Passing a getter function makes
    the _function itself_ the "options" value — `queryKey`/`queryFn` read as `undefined` inside
    `createBaseQuery`, so the query silently sits at `status: 'pending'` forever with no error and
    the console-logs `"As of v4, queryKey needs to be an Array"` warning. `$query.data`/`$query.status`
    read via the `$`-store-subscription prefix is correct and works once options are a plain
    object or a real store.
  - **For options that must react to changing component state** (a filter, a page offset, an id
    from the route — the common case for every list/detail route this console builds), a plain
    object is captured once and never updates. Wrap it in an actual `svelte/store` (`readable`/
    `derived`), not a `$derived` rune value passed as a plain object and not a getter function —
    Phase 1's data-layer tracks (`src/routes/*/`) need to establish this bridge once and reuse it;
    it is out of scope for this Phase-0 scaffold's static smoke test.
- **Bun test + a hand-rolled Svelte-compile plugin, not Vitest** — `tests/setup.ts` +
  `scripts/svelte-test-plugin.ts` port the proven `cinder/packages/components` pattern: a Bun
  plugin compiles `.svelte` (client generate) and `.svelte.ts` rune modules
  (`svelte/compiler`'s `compileModule`) before Bun's module loader sees them, happy-dom supplies
  DOM globals via a `Window` instance copied onto `globalThis`, and `@testing-library/svelte`'s
  `cleanup()` runs after every test via one global `afterEach`. Component tests run with
  `bun test --conditions browser --conditions svelte` — those flags are load-bearing: Cinder ships
  `.svelte`/`.ts` **source** (not just `dist/`) behind its `browser`/`svelte` package.json export
  conditions, and without the flags Bun resolves to already-compiled `dist/` output instead.
  **Always run `bun run test`, never bare `bun test`.** This isn't Cinder-specific: `svelte`
  itself exports `mount()` only behind the `browser` condition (`default`/`node` resolves to
  `svelte/src/index-server.js`, an SSR-only build with no `mount`), so bare `bun test` fails
  `tests/component-harness.test.ts` with `lifecycle_function_unavailable: mount(...) is not
available on the server` — 6 pass / 1 fail, not a real regression. There is no bunfig.toml or
  env-var equivalent for `--conditions` (checked: a top-level `conditions` key and `BUN_CONDITIONS`
  are both silently no-ops for `bun test`/`bun run`); the CLI flags are a hard requirement, per the
  comment at the top of `scripts/svelte-test-plugin.ts`.
- **Cinder v0.16.1, `@lostgradient/weft` v0.11.0** — pinned exact versions per the scaffolding task
  (ahead of the plan document's recorded v0.9.0/v0.11.0 ground-truth pass at authoring time).
  `lucide-svelte` is pinned inside Cinder's declared peer range (`>=0.400.0 <1`) rather than the
  latest `1.x` line, which falls outside that peer contract.

## Repository layout

See plan §2 for the authoritative layout description. The short version:

- `src/mount.ts` — the Bun mount export.
- `src/main.ts` / `src/app/` — SPA entry + shell (sidebar, topbar, command palette, notification
  center, toasts, scope banner — built in Phase 1, T1.6; frozen alongside `src/lib/**` after the
  Phase 1 Foundation gate).
- `src/routes/<domain>/` — one directory per domain (`dashboard`, `workflows`, `schedules`,
  `workers`, `reviews`, `storage`, `system`). Each domain track owns its own directory
  exclusively (currently scaffolded `EmptyState` placeholders awaiting their Phase 2+ track);
  `src/routes/dashboard/cards.ts` is the one shared card-slot registry.
- `src/lib/` — framework-free (or `.svelte.ts` rune-based) modules: `client.ts`, `config.ts`,
  `scopes.svelte.ts`, `router.svelte.ts`, `filters.ts`, `faults.ts`, `format/`, `live-source/`.
  Frozen after the Phase 1 Foundation gate.
- `src/styles/` — `index.css` (shared entry, Cinder base styles + theme contract) plus one empty
  per-track stylesheet each domain owns exclusively.
- `fixtures/workflows.ts` — deterministic demo workflows for the dev server, integration tests,
  and Playwright seeds. Append-only.
- `scripts/dev-server.ts` — boots the seeded local `weft` server `bun run dev` proxies to.
- `tests/` — the test harness (`setup.ts`) plus integration/proving tests that don't belong to a
  single domain track.
