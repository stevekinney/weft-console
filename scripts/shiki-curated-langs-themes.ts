/**
 * Curated replacement for the `shiki/langs` and `shiki/themes` module
 * specifiers (plan §12, T9.3 performance pass — Cinder 0.17.0 revision).
 *
 * ## Why this file exists (superseding the old bare-`shiki` shim)
 *
 * Earlier (`@lostgradient/cinder@0.16.1`), `<CodeBlock>`'s default
 * highlighter fell back to a bare `await import('shiki')`, whose default
 * entry statically enumerated all ~253 bundled grammars and ~50 bundled
 * themes as candidate Rollup chunks. `vite.config.ts` aliased the exact
 * `shiki` specifier to a curated shim to avoid that (filed upstream as
 * stevekinney/cinder#773).
 *
 * Cinder 0.17.0 fixed #773's root complaint — `highlighters/shiki/index.ts`
 * no longer imports bare `shiki` — but its `getSharedShikiModule()` still
 * statically imports the FULL `shiki/langs` and `shiki/themes` modules
 * (`shiki/langs`'s `dist/langs.mjs` is the same ~253-entry
 * `{ id, import: () => import('@shikijs/langs/<id>') }` array shiki's
 * bundle-full.mjs used, just factored into its own subpath), so the same
 * chunk-explosion class of regression reappeared: 353 JS chunks measured
 * in `dist/assets/` after the 0.15.0/0.17.0 bump (vs. a 97-chunk baseline)
 * — the ~256-chunk delta matches shiki's ~253 bundled grammars almost
 * exactly. `@lostgradient/markdown`'s own highlighter (used by
 * `artifact-view.svelte`'s `renderMarkdown`, via
 * `@lostgradient/markdown/rendering`) already curates its own language set
 * internally and is NOT the source of this regression — verified by
 * reading `@lostgradient/markdown/dist/rendering/highlighter.js` directly.
 *
 * `vite.config.ts` aliases the exact `shiki/langs` and `shiki/themes`
 * specifiers (not `shiki/core`, `shiki/wasm`, or `@shikijs/engine-*`,
 * which stay on the real modules — both cinder's and
 * `@lostgradient/markdown`'s highlighters use the oniguruma/WASM engine
 * for full TextMate grammar support, a single legitimate ~600 KB chunk,
 * not a per-language multiplier) to this file. cinder's
 * `getSharedShikiModule()` only ever reads `langsModule.bundledLanguages`/
 * `themesModule.bundledThemes` off these two modules (verified against the
 * installed `highlighters/shiki/index.ts` source directly) — no other
 * named export from either real module is consumed, so this file only
 * needs to provide those two.
 *
 * Current `<CodeBlock language="…" />` call sites this backs (grep
 * `language="` under `src/routes` for the live set): `json`
 * (System → Discovery, System → MCP test session) and `typescript`
 * (System → Health codegen preview), plus `<CodeBlock>`'s own default
 * theme pair `github-light`/`github-dark` (`DEFAULT_THEME` in cinder's
 * `code-block/index.js`) requested whenever no explicit `highlighter` prop
 * overrides it. Add a language/theme below before a new route passes a new
 * `language`/theme to `<CodeBlock>` with highlighting enabled — forgetting
 * to do so is not a build break: cinder's default highlighter degrades an
 * unregistered language to plaintext with one `console.warn`, never a
 * thrown error (`code-block-default-highlighter.ts`'s documented
 * contract).
 *
 * @module
 */

/** Languages this console highlights via `<CodeBlock>` today. */
export const bundledLanguages = {
  json: () => import('@shikijs/langs/json'),
  typescript: () => import('@shikijs/langs/typescript'),
} as const satisfies Record<string, () => Promise<unknown>>;

/** Matches `<CodeBlock>`'s default theme pair (`DEFAULT_THEME`, `code-block/index.js`). */
export const bundledThemes = {
  'github-light': () => import('@shikijs/themes/github-light'),
  'github-dark': () => import('@shikijs/themes/github-dark'),
} as const satisfies Record<string, () => Promise<unknown>>;
