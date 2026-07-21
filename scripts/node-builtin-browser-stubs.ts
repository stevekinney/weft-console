/**
 * Browser-safe stand-ins for the Node builtins `@lostgradient/weft/client`'s
 * bundled code touches, aliased in `vite.config.ts` (see its comment for the
 * full "why" and the filed upstream issue: `#713` in `stevekinney/weft`).
 *
 * `resolve.alias` is deliberately used instead of a `resolveId`/`load`
 * plugin hook: Vite's dev server pre-bundles dependencies like
 * `@lostgradient/weft` with esbuild (`optimizeDeps`), a pass that does not
 * run normal Vite/Rolldown plugin hooks — confirmed via a live `bun run dev`
 * repro (the `node:fs` externalization warning still fired with only a
 * plugin-hook stub in place, even though the equivalent `vite build` output
 * was clean). `resolve.alias` is consulted by both the esbuild optimizer and
 * the production Rolldown build, so aliasing to a real on-disk module — this
 * file — is what makes the stub apply everywhere the app actually runs in a
 * browser.
 *
 * One file backs three original specifiers (`node:fs`, `node:fs/promises`,
 * `node:module`) — unused named exports are simply never imported by any
 * given call site, so there is no cost to combining them here rather than
 * splitting into three near-empty files.
 */

// Stands in for `node:fs` (`connection.ts`'s `readWeftConfiguration()`).
export function existsSync(): boolean {
  return false;
}

export function readFileSync(): never {
  throw new Error('weft-console: readFileSync is unavailable in the browser');
}

// Stands in for `node:fs/promises` (`connection.ts`'s
// `writeRunLockfile()`/`removeRunLockfile()` — CLI-only functions bundled
// alongside the browser-reachable code, never actually called from here).
export async function mkdir(): Promise<void> {}

export async function rm(): Promise<void> {}

// Stands in for `node:module` (`core/types/definition-schema-to-json.ts`'s
// optional Valibot schema adapter).
export function createRequire(): never {
  throw new Error(
    'weft-console: createRequire is unavailable in the browser (the Valibot schema adapter is unsupported)',
  );
}
