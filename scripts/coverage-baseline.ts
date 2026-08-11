/**
 * Measured coverage floor for `bun run check:coverage` (scripts/check-coverage.ts).
 *
 * This is a RATCHET, not the plan's target: `docs/implementation-plan.md` §11
 * targets 100% adjusted coverage with an explicit reviewed allowance file,
 * weft-style, once the console's surfaces stabilize. That is aspirational and
 * not enforced here — this file only records the highest measured watermark
 * so coverage cannot silently regress below it. Bump numbers upward (never
 * downward without a written reason in the PR) whenever `bun run
 * check:coverage` reports a new high-water mark; regenerate by running it and
 * copying the printed per-area/overall counts below.
 *
 * PROVISIONAL — see the note above `overall` before trusting these numbers.
 */

/** Raw hit/found counts for one coverage area (or the `overall` rollup). */
export type AreaCoverage = {
  linesFound: number;
  linesHit: number;
  functionsFound: number;
  functionsHit: number;
};

export type CoverageBaseline = {
  measuredAt: string;
  /**
   * Re-measured 2026-08-11 after the cinder 0.23.0 / weft 0.18.0 wave.
   * Absolute covered lines rose again (23,180 → 23,273). One area moved for a
   * reason worth recording rather than silently re-baselining: `src/lib`
   * reported 60.65% against a 60.92% floor, entirely from LINE ATTRIBUTION,
   * not lost coverage. `scopes.svelte.ts`'s module doc shrank by ~25 lines
   * when the probe-and-infer explanation was replaced by the
   * `weft.system.principal` description, which renumbers the whole file and
   * shifts how the Svelte-compiled output maps back to source lines — the
   * "uncovered" lines it reports are the `AUTHORIZATION_SCOPES` literal and
   * class-declaration lines, which are plainly executed (41 passing tests in
   * `scopes.svelte.test.ts` + `scopes.svelte.integration.test.ts` exercise
   * every branch of `resolvePrincipal`, `hasScope`, `bannerMode`,
   * `denyScope`, and `scopeGate`, the last two against real `serve()`
   * instances). Coverage of the module went UP in substance: its three boot
   * outcomes are now pinned on the wire instead of against a fake client.
   *
   * Earlier note (2026-08-10), kept for context: re-measured after the
   * cinder 0.22.0 / weft 0.16.0 dependency
   * wave. Absolute covered lines ROSE (23,003 → 23,180) but a few area
   * percentages dipped fractionally, for structural reasons reviewed in that
   * change: `src/lib` lost exactly the two covered lines of the removed
   * `budget:*` scopes (weft#844); `src/routes/system` grew with the new
   * authoritative Active-alerts section (weft#843) whose compiled template
   * branches are partially covered; `tests` (= `tests/setup.ts` + the smoke
   * harnesses — test FILES are not instrumented) shifted because every test
   * file now imports `@testing-library/svelte` statically, so setup.ts's
   * dynamic-import fallback paths no longer execute. That static-import
   * conversion is itself the fix for `bun test --parallel=1` hard-failing
   * whenever the library's module-scope `beforeEach()` registration first
   * evaluated INSIDE a running test — the root cause of the coverage suite's
   * 378-failure crashes (and the likely identity of the previously
   * intermittent full-suite failure).
   *
   * Earlier note (2026-07-24), kept for context: re-measured after the
   * Cinder 0.19.0 migration. Coverage runs serially because Bun's
   * default-parallel coverage workers can collide on the integration
   * servers' ephemeral ports; the exact command is recorded in
   * package.json's `test:coverage` script.
   *
   * 2026-07-24 SIGTRAP investigation (isolated worktree): the earlier
   * full-parallel SIGTRAP (exit 133; crash report
   * ~/Library/Logs/DiagnosticReports/bun-2026-07-24-121054.ips) did NOT
   * reproduce in 3/3 loaded runs on Bun 1.3.13 — artificial load produced
   * EADDRINUSE noise instead, consistent with the port-collision rationale
   * above — and the full suite ran clean on Bun 1.3.14. Not escalated to
   * oven-sh/bun without a reproduction. Also verified: `--path-ignore-patterns`
   * takes real GLOBS matched against the path (`'*storage-client*'` excludes;
   * a bare substring like `'storage-client'` matches nothing — Jest-style
   * regex-substring expectations do not transfer), and explicitly named file
   * arguments override ignore patterns.
   */
  overall: AreaCoverage;
  areas: Record<string, AreaCoverage>;
};

/**
 * Platforms the coverage gate records separate baselines for.
 *
 * Bun's LCOV attribution is DETERMINISTIC per platform but materially
 * different between macOS and Linux: the same commit, same suite, and same
 * 1213-test pass produced e.g. `src/routes/system` 89.26% lines on darwin
 * vs 26.31% on linux (CI run 31435362335, byte-identical across a rerun —
 * some areas measure higher on linux, some lower, so neither is a subset
 * of the other). One shared floor therefore cannot gate both environments;
 * each platform ratchets against numbers measured on that platform.
 */
export type CoverageMeasurementPlatform = 'darwin' | 'linux';

/** The current process's baseline platform, or `null` when unrecognized. */
export function coverageMeasurementPlatform(): CoverageMeasurementPlatform | null {
  return process.platform === 'darwin' || process.platform === 'linux' ? process.platform : null;
}

const DARWIN_BASELINE: CoverageBaseline = {
  measuredAt: '2026-08-11T16:22:00.000Z',
  overall: { linesFound: 35964, linesHit: 23283, functionsFound: 4747, functionsHit: 4090 },
  areas: {
    fixtures: { linesFound: 698, linesHit: 319, functionsFound: 69, functionsHit: 12 },
    // +10 lines over the 14:05 measurement, all covered: `LINUX_BASELINE` below
    // is itself instrumented `scripts/` code, so recording it raised this area's
    // own watermark. Ratcheted rather than left slack.
    scripts: {
      linesFound: 393,
      linesHit: 322,
      functionsFound: 24,
      functionsHit: 23,
    },
    src: { linesFound: 12, linesHit: 12, functionsFound: 2, functionsHit: 2 },
    'src/app': { linesFound: 1350, linesHit: 1136, functionsFound: 264, functionsHit: 150 },
    'src/lib': {
      linesFound: 1357,
      linesHit: 823,
      functionsFound: 174,
      functionsHit: 103,
    },
    'src/routes/dashboard': {
      linesFound: 1454,
      linesHit: 1202,
      functionsFound: 244,
      functionsHit: 218,
    },
    'src/routes/reviews': {
      linesFound: 2351,
      linesHit: 1812,
      functionsFound: 377,
      functionsHit: 342,
    },
    'src/routes/schedules': {
      linesFound: 3507,
      linesHit: 3393,
      functionsFound: 727,
      functionsHit: 690,
    },
    'src/routes/storage': {
      linesFound: 2972,
      linesHit: 1307,
      functionsFound: 225,
      functionsHit: 195,
    },
    'src/routes/system': {
      linesFound: 4926,
      linesHit: 4397,
      functionsFound: 883,
      functionsHit: 811,
    },
    'src/routes/workers': {
      linesFound: 3784,
      linesHit: 1510,
      functionsFound: 294,
      functionsHit: 248,
    },
    'src/routes/workflows': {
      linesFound: 13015,
      linesHit: 6940,
      functionsFound: 1449,
      functionsHit: 1283,
    },
    tests: { linesFound: 145, linesHit: 110, functionsFound: 15, functionsHit: 13 },
  },
};

/**
 * Recorded from CI run 31500023108's bootstrap-mode output (ubuntu runner,
 * 2026-08-11) after the cinder 0.23.0 / weft 0.18.0 wave re-bootstrapped it.
 * Linux attribution differs from darwin's in both directions (see the
 * platform-divergence note on {@link CoverageMeasurementPlatform}), so these
 * numbers are NOT comparable to `DARWIN_BASELINE`'s — each ratchets only
 * against its own platform's measurements.
 */
const LINUX_BASELINE: CoverageBaseline = {
  measuredAt: '2026-08-11T14:13:26.903Z',
  overall: { linesFound: 36932, linesHit: 19412, functionsFound: 3937, functionsHit: 3235 },
  areas: {
    fixtures: { linesFound: 698, linesHit: 319, functionsFound: 69, functionsHit: 12 },
    scripts: { linesFound: 339, linesHit: 268, functionsFound: 24, functionsHit: 23 },
    src: { linesFound: 12, linesHit: 12, functionsFound: 2, functionsHit: 2 },
    'src/app': { linesFound: 1350, linesHit: 1136, functionsFound: 264, functionsHit: 150 },
    'src/lib': { linesFound: 1318, linesHit: 896, functionsFound: 178, functionsHit: 113 },
    'src/routes/dashboard': {
      linesFound: 1468,
      linesHit: 1172,
      functionsFound: 243,
      functionsHit: 209,
    },
    'src/routes/reviews': {
      linesFound: 2712,
      linesHit: 936,
      functionsFound: 183,
      functionsHit: 149,
    },
    'src/routes/schedules': {
      linesFound: 3748,
      linesHit: 2313,
      functionsFound: 487,
      functionsHit: 409,
    },
    'src/routes/storage': {
      linesFound: 3089,
      linesHit: 992,
      functionsFound: 171,
      functionsHit: 138,
    },
    'src/routes/system': {
      linesFound: 5778,
      linesHit: 1520,
      functionsFound: 274,
      functionsHit: 219,
    },
    'src/routes/workers': {
      linesFound: 3866,
      linesHit: 1359,
      functionsFound: 264,
      functionsHit: 216,
    },
    'src/routes/workflows': {
      linesFound: 12409,
      linesHit: 8375,
      functionsFound: 1762,
      functionsHit: 1580,
    },
    tests: { linesFound: 145, linesHit: 114, functionsFound: 16, functionsHit: 15 },
  },
};

export const COVERAGE_BASELINES: Record<CoverageMeasurementPlatform, CoverageBaseline | null> = {
  darwin: DARWIN_BASELINE,
  linux: LINUX_BASELINE,
};
