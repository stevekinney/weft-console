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

`scripts/dev-server.ts` boots a real, unwrapped `serve()` from `@lostgradient/weft/server` — no
hand-rolled `Bun.serve()`, no `handleRequest()` workaround, no manual `/api`-prefix stripping, no
reimplemented event feed. WebSocket upgrades, the per-workflow SSE/WS tail, and JSON-RPC over HTTP
(`/jsonrpc`) all work against `bun run dev:server` as a result. (An earlier `@lostgradient/weft@0.11.0`
bug made that impossible — `serve({ engine })` threw for any root-imported `Engine`
(https://github.com/stevekinney/weft/issues/710); fixed upstream in `0.12.0` (#716), the version this
package is pinned to. See `scripts/dev-server.ts`'s module doc if you need the full history.) The
production mount path this package exists for — `serve({ dashboard: weftConsole() })` — is
runtime-verified the same way: a real `serve({ engine, dashboard: weftConsole() })` instance returns
the built shell (`index.html` with its `weft-console-config` block) at `200`.

**A real dev harness needs a real credential, not `unauthenticatedAccess`.** `unauthenticatedAccess`
only controls whether `serve()` refuses to _start_ with no `auth` configured — it has no per-request
effect once running. A credential-less request always resolves to a zero-scope anonymous principal,
so only `access: 'public'` operations (most workflow reads and single-item actions) succeed against
`bun run dev:server` out of the box; `access: 'scoped'`/`'authenticated'` operations (schedules,
reviews, storage, system/registry, …) correctly 401 — confirmed live
(`curl localhost:7233/api/v1/schedules` → `401 {"error":"authentication required"}`). This is
narrower than `@lostgradient/weft@0.11.0`'s workaround, which hand-injected a full-scope principal
on every request regardless of credentials; `serve()` has no equivalent hook. `src/lib/scopes.svelte.ts`
already designs the console around exactly this (optimistic scope grant, graceful 401/403 degrade),
so the console itself renders correctly either way — it just shows real auth-required states for
those surfaces in the dev harness until a real `auth` config (and a matching token the console
sends) is wired up, which is a deliberate follow-up, not done here.

## Scripts

| Script                 | What it does                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run dev`          | Vite dev server with full HMR.                                                                                                            |
| `bun run dev:server`   | Boots a seeded local `weft` server (`scripts/dev-server.ts`) on port 7233.                                                                |
| `bun run build`        | Production build (Vite) → `dist/`, then `bun run check:bundle` (hard-fails on a budget miss).                                             |
| `bun run check:bundle` | Gzip-measures every route/lazy chunk against `scripts/check-bundle-size.ts`'s budgets — run standalone for a quick recheck after a build. |
| `bun run typecheck`    | `svelte-check` over the whole project.                                                                                                    |
| `bun run lint`         | `oxlint`.                                                                                                                                 |
| `bun run lint:fix`     | `oxlint --fix`.                                                                                                                           |
| `bun run format`       | `prettier --write` (Svelte + import-organizing plugins).                                                                                  |
| `bun run format:check` | `prettier --check` — what CI/pre-commit should run instead of `format`.                                                                   |
| `bun run test`         | `bun test` with the Svelte 5 compile plugin + happy-dom preload.                                                                          |

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
    object is captured once and never updates. The resolved bridge, used consistently across every
    domain track: `toStore(() => ({ queryKey, queryFn, ... }))` from `svelte/store`, wrapping a
    getter that reads whatever `$derived`/`$state` values the query depends on — e.g.
    `src/routes/schedules/schedule-list.svelte`'s `createQuery(toStore(() => ({ queryKey:
queryKeys.schedules.list(filter), queryFn: () => fetchScheduleList(client, filter) })))`. A bare
    `$derived` object or a plain getter function passed directly to `createQuery` both fail the same
    way the footgun above describes; `toStore()` is what actually satisfies `createQuery`'s
    `StoreOrVal<T>` parameter type reactively.
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
available on the server` for every component test — not a real regression, just proof the flags
  are load-bearing. There is no bunfig.toml or
  env-var equivalent for `--conditions` (checked: a top-level `conditions` key and `BUN_CONDITIONS`
  are both silently no-ops for `bun test`/`bun run`); the CLI flags are a hard requirement, per the
  comment at the top of `scripts/svelte-test-plugin.ts`.
- **Cinder v0.17.0, `@lostgradient/weft` v0.15.0** — pinned exact versions, bumped from the
  scaffolding task's v0.16.1/v0.12.0 (ahead of the plan document's recorded v0.9.0/v0.11.0
  ground-truth pass at authoring time). `lucide-svelte` is pinned inside Cinder's declared peer
  range (`>=0.400.0 <1`) rather than the latest `1.x` line, which falls outside that peer contract.
  Cinder 0.17.0 finished extracting markdown/editor into standalone packages and deleted the
  `@lostgradient/cinder/markdown/*` shim — the console's one consumer (`artifact-view.svelte`)
  now imports `@lostgradient/markdown/rendering` directly, and `@lostgradient/markdown` is a
  direct dependency.

## Cinder-first evaluations against landed upstream work (post-0.17.0 bump)

Three Cinder additions the console had filed or was tracking landed between 0.16.1 and 0.17.0.
Each was re-evaluated against the installed component source, not assumed from the issue title:

- **`RunStepTimeline`'s `timed-out` status (cinder#848, fixed by cinder#853)** — adopted outright.
  `timeline-step-state.ts` previously collapsed Weft's `timed-out` timeline status into Cinder's
  `failed` `RunStepStatus` because no dedicated value existed; Cinder 0.17.0 added one (danger
  tone, terminal), so the mapping now passes it through unchanged.
- **`InvocationRuleBuilder`'s `mode="flat-conditions"` (cinder#847, fixed by cinder#854)** —
  fixed the rule-grouping blocker that stopped the original C4 evaluation (`mode="conditions"`
  forced every condition set under a named, moveable/removable "rule" — a shape this console's
  flat AND-only search-attribute grammar can't represent), but did not unblock adoption. Every
  mode's field selector remains a plain `<select>` bound to a fixed `fieldOptions` list
  (`invocation-rule-builder.svelte:635-651`) with no free-text entry, and the console's query
  builder needs to filter on search-attribute keys it has never observed a value for yet — exactly
  what Cinder's own `Combobox` (already used in `query-builder.svelte`) provides via free-text
  `bind:inputValue`. Filed as cinder#865. `src/routes/workflows/list/query-builder.ts`/`.svelte`
  keep the app-local `Combobox`+`Select`+`Input` composition until it lands.
- **`JsonEditor` (cinder#852)** — evaluated against `src/lib/payload-editor/` (the shared
  CodeMirror 6 editor behind Start/Signal/Update/Schedule/Storage's five payload call sites) and
  **not adopted**. Read from the installed `json-editor.svelte` source directly: it is a native
  `<textarea>` with `JSON.parse`-based valid/invalid feedback (`role="status"`/`role="alert"`) and
  accessible label/description wiring — no syntax highlighting, no inline lint squiggles, and
  nothing to lazy-load (a bare textarea has no chunk to split out). Cinder's own component
  metadata frames it as the deliberately lightweight alternative to a code-editor runtime
  (`@useWhen A lightweight native editor is preferable to shipping a code-editor runtime`), not a
  richer replacement for one, so this isn't a defect in `JsonEditor` as shipped — it's a different
  point in the design space than what `payload-editor.svelte` already provides: CodeMirror 6 JSON
  syntax highlighting, `@codemirror/lint`'s `jsonParseLinter()` inline squiggles, a
  plain-`<textarea>` progressive-enhancement fallback (functionally close to what `JsonEditor`
  offers on its own), and a lazy `import('./codemirror-setup.ts')` chunk kept out of every route's
  own bundle (plan §12's `<150 KB` lazy-chunk budget). `payload-editor.svelte` keeps CodeMirror;
  `JsonEditor` was not adopted at any of the five payload-editing call sites. Filed a feature
  request (not a bug) upstream as cinder#866 for a syntax-highlighted `JsonEditor` family member,
  since that gap is genuine even though today's `JsonEditor` is working exactly as designed.

## Repository layout

See plan §2 for the authoritative layout description. The short version:

- `src/mount.ts` — the Bun mount export.
- `src/main.ts` / `src/app/` — SPA entry + shell (sidebar, topbar, command palette, notification
  center, toasts, scope banner — built in Phase 1, T1.6; frozen alongside `src/lib/**` after the
  Phase 1 Foundation gate).
- `src/routes/<domain>/` — one directory per domain (`dashboard`, `workflows`, `schedules`,
  `workers`, `reviews`, `storage`, `system`). Each domain track owns its own directory
  exclusively; all seven are fully implemented (list/detail surfaces, mutations, live updates,
  fault/empty/loading states, colocated tests) — see plan Appendix B for the per-surface
  acceptance checklist. `src/routes/dashboard/cards.ts` is the one shared card-slot registry.
- `src/lib/` — framework-free (or `.svelte.ts` rune-based) modules: `client.ts`, `config.ts`,
  `scopes.svelte.ts`, `router.svelte.ts`, `filters.ts`, `faults.ts`, `format/`, `live-source/`.
  Frozen after the Phase 1 Foundation gate.
- `src/styles/` — `index.css` (shared entry, Cinder base styles + theme contract) plus one
  per-track stylesheet each domain owns exclusively (`@lostgradient/cinder/<component>/styles`
  imports plus route-local rules — never added to `index.css`).
- `fixtures/` — deterministic demo data for the dev server and integration tests, split by
  concern (`workflows.ts` is the base module + orchestrating `seed()`; `coordination.ts`,
  `saga.ts`, `finalizer.ts`, `async-activity.ts`, `children.ts`, `history.ts`, `tagged.ts`,
  `failures.ts`, `reviews.ts`, `schedules.ts` each seed one domain-specific specimen). Append-only
  — see the Development section below for a tour. Playwright E2E (plan §11.4) is not yet built in
  this repository; there are no Playwright seeds today despite what an earlier draft of this file
  claimed.
- `scripts/dev-server.ts` — boots the seeded local `weft` server `bun run dev` proxies to.
- `scripts/check-bundle-size.ts` — the CI-facing bundle-size gate (plan §12), chained onto
  `bun run build`.
- `tests/` — the test harness (`setup.ts`) plus integration/proving tests that don't belong to a
  single domain track.

## Development

- **Two-terminal dev harness.** `bun run dev:server` (port 7233) and `bun run dev` (port 5173) —
  see Quickstart above. Kill both when you're done; `bun run dev:server` holds an in-memory engine
  with no persistence between restarts.
- **Test conditions flags are load-bearing.** Always run `bun run test`, never bare `bun test` —
  it runs `bun test --conditions browser --conditions svelte`, and without those two flags Bun
  resolves both Cinder and Svelte itself to their non-browser (`dist`/SSR-only) export conditions,
  which fails every component test with `lifecycle_function_unavailable`. See the "Toolchain
  decisions" section above for the full diagnosis.
- **Fixture tour** (`fixtures/*.ts`, all started by `seed()` in `fixtures/workflows.ts` against
  `bun run dev:server`'s engine): `order-processing` (completes), `payment-failing` (always
  fails), `long-sleeper` / `review-gate` / `signal-stepped` (deliberately left running),
  `checkout-coordination` (`coordination.ts` — `ctx.race`/`ctx.all`/`ctx.speculate` in one run,
  for the Timeline's branch-group rendering), `trip-booking-saga` (`saga.ts` — a failing final
  step so `ctx.saga` compensates in reverse order), `sandbox-session` (`finalizer.ts` — cancelled
  mid-run so the finalizer sub-states render), `ship-package-async` (`async-activity.ts` — a
  never-externally-completed `ctx.completeAsync()` token, for the async-completion drawer),
  `fulfillment-parent` + `validate-shipment`/`monitor-delivery` (`children.ts` — one awaited
  child, one detached long-running child), `audit-trail-sweep` (`history.ts` — 200+ durable steps,
  for timeline/checkpoint pagination), `customer-outreach-campaign` ×4 (`tagged.ts` — varied
  run-level tags and search attributes), the `timeout`/`cancellation`/`resource`/`system` failure
  demos (`failures.ts` — one run per failure-category taxonomy value), `content-review` ×3
  (`reviews.ts` — a pending sectioned/partial review, a completed decision, a timed-out review),
  and two schedules over `inventory-sync-sweep` (`schedules.ts` — one active every-5-minutes cron,
  one paused). Extend a
  module or add a new one for a new demo state; never mutate an existing specimen another track's
  tests or the dev harness itself already assert against.
