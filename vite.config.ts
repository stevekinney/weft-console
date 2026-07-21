import { fileURLToPath } from 'node:url';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

/**
 * `@lostgradient/weft/client`'s `HttpClient` transitively imports
 * `node:fs`/`node:fs/promises` (`connection.ts`, for its CLI-oriented
 * `~/.weft/config`/run-lockfile resolution) and `node:module`
 * (`core/types/definition-schema-to-json.ts`, for an optional Valibot schema
 * adapter) — none of which exist in a browser. Confirmed via a live
 * in-browser repro (both `vite build` + a static server, and `bun run dev`);
 * filed upstream: https://github.com/stevekinney/weft/issues/713.
 *
 * Aliased (not a `resolveId`/`load` plugin hook) because `bun run dev`
 * pre-bundles dependencies like `@lostgradient/weft` with esbuild
 * (`optimizeDeps`), a pass that does not run normal Vite/Rolldown plugin
 * hooks — a plugin-hook stub alone left `node:fs` externalized (and the app
 * blank) under `bun run dev` even though the equivalent `vite build` output
 * was clean. `resolve.alias` is consulted by both the esbuild optimizer and
 * the production Rolldown build, so this covers both. See
 * `scripts/node-builtin-browser-stubs.ts` for the actual replacement
 * implementations (real, on-disk exports of exactly the names weft's
 * bundled code reads) — same category of workaround as `src/lib/client.ts`'s
 * `Bun.env` shim, which documents the full upstream issue; this is not a
 * fork of weft's own logic.
 */
const nodeBuiltinBrowserStubsPath = fileURLToPath(
  new URL('./scripts/node-builtin-browser-stubs.ts', import.meta.url),
);

/**
 * Dev proxy target: a local `weft` server started by `bun run dev:server`
 * (`scripts/dev-server.ts`). Override with `WEFT_API_BASE_URL` to point the
 * dev console at a different server without editing this file.
 */
const devServerTarget = process.env['WEFT_API_BASE_URL'] ?? 'http://localhost:7233';

// Everything functional is served under `/api`; a handful of discovery and
// health routes stay root-relative (see plan §0 / Appendix A). Both groups —
// plus WebSocket upgrades and unbuffered SSE — must proxy through in dev so
// realtime behavior matches production.
//
// `/jsonrpc` and `/mcp` are root-relative too (never under `/api` — see
// `weft/src/client/http-operations.ts`'s `httpClientCatalogTransport`,
// which builds its endpoint as `${baseUrl}/jsonrpc` with no `/v1`/`/api`
// segment, and `weft/src/mcp/http.ts`'s canonical `/mcp` path) but were
// missing here, so `client.operations[...]`/`client.call(...)` (every
// operation without an ergonomic `HttpClient` method — registry, metrics,
// recover-all, workers, task queues, diagnostics, …) and the System →
// Discovery → MCP "Test session" panel 404'd in dev even though the same
// requests work in a real `serve()`-mounted deployment. Confirmed via a
// live browser repro (`POST http://localhost:5173/jsonrpc` → 404) while
// building Track E2's System surfaces.
const proxiedApiPaths = [
  '/api',
  '/v1',
  '/openapi.json',
  '/openrpc.json',
  '/asyncapi.json',
  '/.well-known',
  '/jsonrpc',
  '/mcp',
];

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    // Array form with exact-match `RegExp` `find` patterns, not the object
    // shorthand: Vite's object-key aliasing treats a string key as a
    // directory-style prefix, so a `'node:fs'` key also matches
    // `'node:fs/promises'` and rewrites it to
    // `<stub-path>/promises` — a real, on-disk path that doesn't exist.
    // `^…$` anchors force each of the three specifiers to match only itself.
    alias: [
      { find: /^node:fs$/, replacement: nodeBuiltinBrowserStubsPath },
      { find: /^node:fs\/promises$/, replacement: nodeBuiltinBrowserStubsPath },
      { find: /^node:module$/, replacement: nodeBuiltinBrowserStubsPath },
    ],
  },
  server: {
    proxy: Object.fromEntries(
      proxiedApiPaths.map((path) => [
        path,
        {
          target: devServerTarget,
          changeOrigin: true,
          ws: true,
          // Server-Sent Event responses must not be buffered by the proxy —
          // Vite's proxy (http-proxy) streams by default as long as the
          // response isn't explicitly buffered, which is the case here.
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes) => {
              if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
                proxyRes.headers['cache-control'] = 'no-cache';
              }
            });
          },
        },
      ]),
    ),
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        // Hashed filenames for cache-busting; per-route code-splitting is
        // achieved by the dynamic imports in `src/app/routes.ts` — Rollup
        // creates a chunk per unique dynamic-import target automatically.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
