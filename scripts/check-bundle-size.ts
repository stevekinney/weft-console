/**
 * Bundle-size budget gate (plan §12, T9.3). Reads the Vite build manifest
 * (`dist/.vite/manifest.json`, written because `vite.config.ts` sets
 * `build.manifest: true`) to resolve each named surface to its exact
 * built JS + CSS files, gzips each file directly — the same transfer
 * cost a browser actually pays over a compressed connection — and
 * hard-fails when a surface exceeds its budget.
 *
 * Why the manifest instead of matching `dist/assets/<name>-*.js` by
 * filename: Rollup's hash alphabet includes `-`, so a naive prefix match
 * can't reliably tell `workers-<hash>.js` (the workers ROUTE) apart from
 * `workers-data-<hash>.js` (a shared chunk workers AND dashboard cards
 * both import). The manifest's `src/routes/<domain>/index.svelte` keys —
 * the exact dynamic-import targets `src/app/routes.ts` uses — resolve
 * this precisely.
 *
 * Budgets below are MEASURED, not plan §12's original numbers. That
 * section lists aspirational targets (entry <15 KB, dashboard <30,
 * workflow list <40, workflow detail <60, CodeMirror chunk lazy <150)
 * written before a line of Svelte + cinder existed. Cinder's own base
 * styles, design tokens, and component set cost more than several of
 * those at rest — every enforced budget here is `budgetFromMeasuredKb`
 * applied to a measured baseline (i.e. `ceil(measuredKb * 1.2)`), with
 * the plan's original figure kept alongside as context, not as the
 * ceiling. See each `planNote` for that context, and re-measure
 * (`bun run check:bundle`) + update the baseline argument in the same PR
 * after an intentional size change — this script only catches
 * *regressions*.
 *
 * Route budgets don't split "workflow list" from "workflow detail" the
 * way plan §12's wording does: `src/app/routes.ts` maps both
 * `/workflows` and `/workflows/:id` to the same dynamic import
 * (`src/routes/workflows/index.svelte`), so they build as one chunk.
 *
 * Two chunks outside the per-route budgets get their own documented
 * allowances instead of a shared "reasonable size" heuristic:
 *
 *   - `codemirror-setup`: the plan's own named "CodeMirror chunk lazy"
 *     budget line — resolved via its `src/lib/payload-editor/
 *     codemirror-setup.ts` manifest key.
 *   - cinder's markdown-rendering Web Worker (`render-worker-*.js`,
 *     Reviews' artifact markdown viewer only): not in the Vite manifest
 *     at all — Worker entries build through a separate Rollup pass —
 *     found by filename glob instead. Filed upstream as
 *     stevekinney/cinder#835 (the sync `renderMarkdown` barrel forces
 *     this ~1.8 MB Worker bundle into any consumer's build graph with no
 *     narrower subpath to opt out); not reducible from the console side
 *     until that lands, so it gets a generous documented ceiling instead
 *     of being silently ignored.
 *
 * @module
 */
import { join } from 'node:path';

const DIST_DIR = join(import.meta.dir, '..', 'dist');
const MANIFEST_PATH = join(DIST_DIR, '.vite', 'manifest.json');

/** Fraction of headroom added on top of a measured baseline. */
const HEADROOM = 0.2;

/**
 * Turns a measured gzip-KB baseline into a hard-fail byte ceiling:
 * `measuredKb * (1 + HEADROOM)`, rounded up to the nearest whole KB. Budget
 * entries below pass the measured baseline captured on a clean `bun run
 * build` directly, so the enforced ceiling is always visibly derived from
 * it — never a hand-rounded number that can drift out of sync with the
 * baseline it's supposed to be 20% over.
 */
function budgetFromMeasuredKb(measuredKb: number): number {
  return Math.ceil(measuredKb * (1 + HEADROOM)) * 1024;
}

interface ManifestEntry {
  file: string;
  css?: string[];
}

type Manifest = Record<string, ManifestEntry>;

async function readManifest(): Promise<Manifest> {
  const manifestFile = Bun.file(MANIFEST_PATH);
  if (!(await manifestFile.exists())) {
    throw new Error(
      `check-bundle-size: no manifest at ${MANIFEST_PATH}. Run "bun run build" first — ` +
        `this script measures an existing dist/, it doesn't build one.`,
    );
  }
  return manifestFile.json();
}

/** Gzips a single built asset (relative to `dist/`) and returns its byte size. */
async function gzipSize(relativeFile: string): Promise<number> {
  const bytes = await Bun.file(join(DIST_DIR, relativeFile)).bytes();
  return Bun.gzipSync(bytes).byteLength;
}

/** Sums the gzip size of a manifest entry's own JS file plus its CSS. */
async function manifestEntryGzipSize(entry: ManifestEntry): Promise<number> {
  const files = [entry.file, ...(entry.css ?? [])];
  const sizes = await Promise.all(files.map(gzipSize));
  return sizes.reduce((total, size) => total + size, 0);
}

function requireManifestEntry(manifest: Manifest, key: string): ManifestEntry {
  const entry = manifest[key];
  if (!entry) {
    throw new Error(
      `check-bundle-size: no manifest entry for "${key}" — did src/app/routes.ts or the ` +
        `payload-editor module path change? Update this script's budget list to match.`,
    );
  }
  return entry;
}

interface Budget {
  /** Human label for the report. */
  label: string;
  /** Hard-fail ceiling in gzip bytes. */
  maxBytes: number;
  /** Context-only note — plan §12's original target, or why there isn't one. */
  planNote: string;
  /** Resolves the measured gzip byte size for this surface. */
  measure: (manifest: Manifest) => Promise<number>;
}

/** A per-domain route budget: `src/routes/<domain>/index.svelte`'s own JS + CSS. */
function routeBudget(domain: string, maxBytes: number, planNote: string): Budget {
  return {
    label: `route: ${domain}`,
    maxBytes,
    planNote,
    measure: (manifest) =>
      manifestEntryGzipSize(requireManifestEntry(manifest, `src/routes/${domain}/index.svelte`)),
  };
}

/**
 * Finds the one `dist/assets/<prefix>-*.js` file matching a stable,
 * distinctive name prefix. Used only for chunks that never appear in the
 * Vite manifest (Worker-environment output) — everything else resolves
 * through `requireManifestEntry` instead, which doesn't have this
 * ambiguity risk. Fails loudly on zero or multiple matches rather than
 * silently measuring the wrong file or skipping the check.
 */
async function gzipSizeByFilenamePrefix(prefix: string): Promise<number> {
  const glob = new Bun.Glob(`${prefix}-*.js`);
  const matches = await Array.fromAsync(glob.scan({ cwd: join(DIST_DIR, 'assets') }));
  if (matches.length !== 1) {
    throw new Error(
      `check-bundle-size: expected exactly one "assets/${prefix}-*.js", found ${matches.length} ` +
        `(${matches.join(', ') || 'none'}). Update this script's glob or budget list.`,
    );
  }
  return gzipSize(join('assets', matches[0] as string));
}

// Baselines measured on a clean `bun run build` while writing this script
// (see the module doc for the rounding/headroom formula `budgetFromMeasuredKb`
// applies). Re-measure and update the baseline argument after an
// intentional size change — the ceiling recomputes from it automatically.
const BUDGETS: Budget[] = [
  {
    label: 'entry (index.html → main bundle)',
    maxBytes: budgetFromMeasuredKb(62.21),
    planNote: 'plan §12 aspirational target: <15 KB gzip (measured baseline: ~62.2 KB)',
    measure: (manifest) => manifestEntryGzipSize(requireManifestEntry(manifest, 'index.html')),
  },
  routeBudget(
    'dashboard',
    budgetFromMeasuredKb(9.12),
    'plan §12 aspirational target: <30 KB gzip (measured baseline: ~9.1 KB, well inside budget)',
  ),
  routeBudget(
    'workflows',
    budgetFromMeasuredKb(72.58),
    'plan §12 aspirational target: workflow list <40 KB / workflow detail <60 KB gzip separately — ' +
      'built as one chunk here (see module doc); measured baseline: ~72.6 KB',
  ),
  routeBudget(
    'schedules',
    budgetFromMeasuredKb(52.33),
    'no dedicated plan §12 line item (measured baseline: ~52.3 KB)',
  ),
  routeBudget(
    'workers',
    budgetFromMeasuredKb(7.81),
    'no dedicated plan §12 line item (measured baseline: ~7.8 KB)',
  ),
  routeBudget(
    'reviews',
    budgetFromMeasuredKb(49.93),
    'no dedicated plan §12 line item (measured baseline: ~49.9 KB)',
  ),
  routeBudget(
    'storage',
    budgetFromMeasuredKb(7.83),
    'no dedicated plan §12 line item (measured baseline: ~7.8 KB)',
  ),
  routeBudget(
    'system',
    budgetFromMeasuredKb(43.43),
    'no dedicated plan §12 line item (measured baseline: ~43.4 KB)',
  ),
  {
    label: 'lazy: payload-editor CodeMirror chunk',
    maxBytes: budgetFromMeasuredKb(104.05),
    planNote:
      'plan §12 aspirational target: CodeMirror chunk lazy <150 KB gzip (measured baseline: ~104.1 KB, inside budget)',
    measure: (manifest) =>
      manifestEntryGzipSize(
        requireManifestEntry(manifest, 'src/lib/payload-editor/codemirror-setup.ts'),
      ),
  },
  {
    label: 'lazy: cinder markdown render worker (Reviews artifact viewer)',
    maxBytes: budgetFromMeasuredKb(473.71),
    planNote:
      'no plan §12 line item — cinder-owned Worker bundle, not reducible from the console side; ' +
      'filed upstream as stevekinney/cinder#835 (measured baseline: ~473.7 KB)',
    measure: () => gzipSizeByFilenamePrefix('render-worker'),
  },
];

interface BudgetResult {
  budget: Budget;
  actualBytes: number;
  withinBudget: boolean;
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

/**
 * Total-chunk-count regression guard.
 *
 * The per-surface budgets above measure each ROUTE and each documented
 * lazy chunk — but a full-shiki-bundle-style regression (see this
 * script's and `scripts/shiki-curated-highlighter.ts`'s module docs: the
 * bug this file was written to catch a recurrence of) doesn't grow any
 * of those. It adds ~250 new grammar chunks and ~50 new theme chunks
 * that no per-surface budget names, so none of the checks above would
 * ever go red for it — `vite build` prints its own advisory ">500 kB
 * chunk" warning in that scenario but still exits 0. This asserts total
 * `.js` chunk count in `dist/assets/` instead, which that class of
 * regression can't avoid tripping (391 chunks were measured with the bug
 * present, 97 after the fix in this same PR — this check exists so a
 * reintroduction, from any future importer of the bare `shiki`
 * specifier, fails CI instead of quietly bloating `dist/` again).
 *
 * The headroom here is deliberately much looser than `HEADROOM` above
 * (2x, not 1.2x): this guard's job is catching a catastrophic multiplier,
 * not tracking the one-or-two-chunk growth ordinary feature work adds
 * across the other tracks building on this codebase in parallel.
 */
const MEASURED_JS_CHUNK_COUNT = 97;
const CHUNK_COUNT_HEADROOM_MULTIPLIER = 2;
const MAX_JS_CHUNK_COUNT = MEASURED_JS_CHUNK_COUNT * CHUNK_COUNT_HEADROOM_MULTIPLIER;

async function countJsChunks(): Promise<number> {
  const glob = new Bun.Glob('*.js');
  const matches = await Array.fromAsync(glob.scan({ cwd: join(DIST_DIR, 'assets') }));
  return matches.length;
}

async function run(): Promise<void> {
  const manifest = await readManifest();

  const results: BudgetResult[] = await Promise.all(
    BUDGETS.map(async (budget) => {
      const actualBytes = await budget.measure(manifest);
      return { budget, actualBytes, withinBudget: actualBytes <= budget.maxBytes };
    }),
  );

  const labelWidth = Math.max(...results.map((result) => result.budget.label.length));
  console.log('Bundle size budgets (gzip):\n');
  for (const { budget, actualBytes, withinBudget } of results) {
    const status = withinBudget ? 'OK  ' : 'FAIL';
    console.log(
      `  [${status}] ${budget.label.padEnd(labelWidth)}  ${formatKb(actualBytes).padStart(11)} / ` +
        `${formatKb(budget.maxBytes).padStart(11)} budget`,
    );
    console.log(`           ${' '.repeat(labelWidth)}  ${budget.planNote}`);
  }

  const jsChunkCount = await countJsChunks();
  const chunkCountWithinBudget = jsChunkCount <= MAX_JS_CHUNK_COUNT;
  console.log(
    `  [${chunkCountWithinBudget ? 'OK  ' : 'FAIL'}] total JS chunk count in dist/assets/`.padEnd(
      labelWidth + 10,
    ) +
      `  ${String(jsChunkCount).padStart(11)} / ${String(MAX_JS_CHUNK_COUNT).padStart(11)} budget`,
  );
  console.log(
    `           ${' '.repeat(labelWidth)}  regression guard for a full-shiki-bundle-style chunk explosion ` +
      `(measured baseline: ${MEASURED_JS_CHUNK_COUNT})`,
  );

  const failures = results.filter((result) => !result.withinBudget);
  if (failures.length > 0) {
    console.error(`\n${failures.length} of ${results.length} bundle size budget(s) exceeded:`);
    for (const { budget, actualBytes } of failures) {
      console.error(
        `  - ${budget.label}: ${formatKb(actualBytes)} exceeds the ${formatKb(budget.maxBytes)} budget ` +
          `by ${formatKb(actualBytes - budget.maxBytes)}`,
      );
    }
  }
  if (!chunkCountWithinBudget) {
    console.error(
      `\ntotal JS chunk count ${jsChunkCount} exceeds the regression-guard budget of ${MAX_JS_CHUNK_COUNT} ` +
        `(baseline ${MEASURED_JS_CHUNK_COUNT} × ${CHUNK_COUNT_HEADROOM_MULTIPLIER}). This usually means a bare ` +
        `"shiki" import (or similar full-bundle dependency) slipped past the alias in vite.config.ts — see ` +
        `scripts/shiki-curated-highlighter.ts's module doc.`,
    );
  }
  if (failures.length > 0 || !chunkCountWithinBudget) {
    process.exit(1);
  }

  console.log(`\nAll ${results.length} bundle size budgets and the chunk-count guard passed.`);
}

await run();
