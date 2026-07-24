/**
 * Curated replacement for the bare `shiki` module specifier (plan §12,
 * T9.3 performance pass).
 *
 * `@lostgradient/cinder/code-block`'s default highlighter
 * (`code-block-default-highlighter.ts`) falls back to `await
 * import('shiki')` whenever a `<CodeBlock language="…" />` is rendered
 * without an explicit `highlighter` prop. The bare `shiki` package's
 * default entry point resolves to `bundle-full.mjs`, which statically
 * enumerates all ~253 bundled grammars and ~50 bundled themes as
 * candidate dynamic imports. Rollup has to emit a chunk for every one of
 * them at build time — even though each only *loads* on demand, several
 * individually exceed the 500 kB warning threshold (`emacs-lisp.js`
 * ~780 kB, `cpp.js` ~626 kB, the oniguruma `wasm.js` engine ~622 kB) and
 * the sheer chunk count bloats `dist/` for languages this console never
 * highlights.
 *
 * `vite.config.ts` aliases the *exact* `shiki` specifier (a `^shiki$`
 * regex — not `shiki/core`, `shiki/wasm`, or any other subpath) to this
 * file. Anything that imports a shiki subpath directly is untouched,
 * which matters because `@lostgradient/cinder/markdown/rendering`'s
 * Web Worker (used by the Reviews artifact viewer's markdown rendering)
 * imports `shiki/core` + `shiki/wasm` directly for its own highlighter —
 * that stays on the full oniguruma engine and is out of scope here.
 *
 * The approach mirrors the pattern cinder's own
 * `markdown/rendering/highlighter.js` already uses internally: `shiki/core`
 * plus a curated per-language `@shikijs/langs/<name>` loader map, so Rollup
 * only has languages this console actually requests to emit chunks for.
 * It also swaps the oniguruma/WASM engine for `@shikijs/engine-javascript`
 * (no `.wasm` binary) — the curated language set below doesn't need any
 * TextMate grammar feature the pure-JS regex engine can't cover.
 *
 * Current `<CodeBlock language="…" />` call sites this backs (grep
 * `language="` under `src/routes` for the live set): `json`
 * (System → Discovery, System → MCP test session) and `typescript`
 * (System → Health codegen preview). Add a loader below — and to
 * `bundledLanguages` — before a new route passes a new `language` to
 * `<CodeBlock>` with highlighting enabled. Forgetting to do so is not a
 * build break: `code-block-default-highlighter.ts`'s documented contract
 * has an unregistered language degrade to plaintext with one
 * `console.warn`, never a thrown error.
 *
 * Upstream status: this exact defect is filed as
 * stevekinney/cinder#773 ("code-block loads shiki's full grammar bundle
 * (~10 MB) instead of shiki/core"). It's already closed as completed in
 * the cinder source tree — `packages/components/src/highlighters/shiki/index.ts`
 * converged on `shiki/core` + `@shikijs/engine-oniguruma` + per-language
 * loaders — but that fix has not shipped in a published `@lostgradient/cinder`
 * version yet (npm's latest is still `0.16.1`, the same version string as
 * the installed copy that still has the bare `import('shiki')` default).
 * Once a release containing that fix is installed, `<CodeBlock>`'s own
 * default highlighter stops pulling `bundle-full.mjs` and this alias +
 * shim can be deleted (delete the `shikiAlias` block in `vite.config.ts`
 * and this file; nothing else references either).
 *
 * @module
 */
import type { HighlighterCore } from 'shiki/core';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

/** `codeToHtml`'s options parameter, lifted from the real highlighter type. */
type CodeToHtmlOptions = Parameters<HighlighterCore['codeToHtml']>[1];

/** Languages this console highlights via `<CodeBlock>` today. */
const LANGUAGE_LOADERS = {
  json: () => import('@shikijs/langs/json'),
  typescript: () => import('@shikijs/langs/typescript'),
} as const satisfies Record<string, () => Promise<unknown>>;

/**
 * Matches cinder's `DEFAULT_THEME` (`code-block/index.js`) — the theme
 * pair `<CodeBlock>`'s default highlighter always requests when no
 * explicit `highlighter` prop overrides it.
 */
const THEME_LOADERS = {
  'github-light': () => import('@shikijs/themes/github-light'),
  'github-dark': () => import('@shikijs/themes/github-dark'),
} as const satisfies Record<string, () => Promise<unknown>>;

let highlighterPromise: Promise<HighlighterCore> | undefined;

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: Object.values(THEME_LOADERS).map((load) => load()),
    langs: Object.values(LANGUAGE_LOADERS).map((load) => load()),
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}

/**
 * Stands in for real shiki's `bundledLanguages` map. cinder's default
 * highlighter only ever reads this via `Object.hasOwn(shiki.bundledLanguages,
 * lang)` to decide whether to attempt a highlight at all — the property
 * values themselves are never used, so `true` is a sufficient placeholder.
 */
export const bundledLanguages: Record<keyof typeof LANGUAGE_LOADERS, true> = {
  json: true,
  typescript: true,
};

/**
 * Structural match for `shiki`'s top-level `codeToHtml(code, options)` —
 * the only two members cinder's default highlighter destructures off the
 * `shiki` module (see `@lostgradient/cinder`'s
 * `code-block-default-highlighter.ts`).
 */
export async function codeToHtml(code: string, options: CodeToHtmlOptions): Promise<string> {
  const highlighter = await getHighlighter();
  return highlighter.codeToHtml(code, options);
}
