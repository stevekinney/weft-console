/**
 * The Bun mount export (plan §1, §3.1, T0.2): `serve({ dashboard: weftConsole() })`
 * serves the built console shell at exactly `DASHBOARD_PAGE_ROUTES` — it never
 * shadows `/api/*` or the root-stable discovery routes, because weft's Bun
 * route table matches those first (see `@lostgradient/weft/server`'s own
 * `DASHBOARD_PAGE_ROUTES` doc comment for why that ordering is load-bearing).
 *
 * @module mount
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DashboardRouteTarget } from '@lostgradient/weft/server';

export interface WeftConsoleOptions {
  /**
   * Directory containing the built console assets (`index.html` plus
   * content-hashed asset files under `assets/`). Defaults to this package's
   * own `dist/` — the output of `bun run build` (Vite). Pass an explicit
   * value for CDN deployments that build once and copy `dist/` elsewhere.
   */
  distDir?: string;
}

const DEFAULT_DIST_DIR = fileURLToPath(new URL('../dist', import.meta.url));

/**
 * Returns a static `Response` streaming the built `index.html` shell,
 * suitable for `serve({ dashboard: weftConsole() })`. The runtime config
 * `<script type="application/json" id="weft-console-config">` block baked
 * into `index.html` at build time defaults to same-origin (`baseUrl: ''`),
 * which is correct for this deployment mode — the console and API share an
 * origin under a Bun mount.
 */
export function weftConsole(options: WeftConsoleOptions = {}): DashboardRouteTarget {
  const distDir = options.distDir ?? DEFAULT_DIST_DIR;
  const indexPath = join(distDir, 'index.html');

  return new Response(Bun.file(indexPath), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
