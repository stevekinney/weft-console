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
   * PROVISIONAL — measured 2026-07-24 with one known gap.
   *
   * `bun run test:coverage` (the exact command `check-coverage.ts` runs)
   * currently SIGTRAPs on this machine when
   * `src/routes/storage/storage-client.integration.test.ts` is included in
   * the full default-parallel run — reproduced 3/3 times, with and without
   * `--coverage`; removing only that one file from the run (whether by
   * explicit file list or by excluding all of `src/routes/storage/`) makes
   * the crash disappear every time, and running that file alone (with
   * coverage) passes cleanly. That file boots several real
   * `serve({ engine })` instances per test (one per test case) but disposes
   * each one; nothing in it looks like an obvious leak, so this may be a
   * Bun coverage/parallel-worker resource issue rather than a bug in that
   * file — see the task report for the full bisection. `--path-ignore-
   * patterns` did NOT work around it (verified: excluding the whole
   * `src/routes/storage/` directory via that flag still crashed at the same
   * point), so these numbers were measured by passing every OTHER
   * `**\/*.test.ts` file explicitly to `bun test`.
   *
   * Net effect: every area's numbers below are real and current EXCEPT
   * `src/routes/storage`, which is missing that one file's contribution
   * (its other 8 files are included). Re-measure once the crash is
   * root-caused and fixed, and replace this baseline outright rather than
   * just widening the gap.
   */
  overall: AreaCoverage;
  areas: Record<string, AreaCoverage>;
};

export const COVERAGE_BASELINE: CoverageBaseline = {
  measuredAt: '2026-07-24T18:15:50.000Z',
  overall: { linesFound: 34246, linesHit: 27214, functionsFound: 5581, functionsHit: 5121 },
  areas: {
    fixtures: { linesFound: 698, linesHit: 319, functionsFound: 69, functionsHit: 12 },
    scripts: { linesFound: 288, linesHit: 221, functionsFound: 22, functionsHit: 21 },
    'src/app': { linesFound: 1300, linesHit: 1260, functionsFound: 282, functionsHit: 267 },
    'src/lib': { linesFound: 1543, linesHit: 1526, functionsFound: 250, functionsHit: 245 },
    'src/routes/dashboard': {
      linesFound: 1452,
      linesHit: 1214,
      functionsFound: 250,
      functionsHit: 225,
    },
    'src/routes/reviews': {
      linesFound: 2289,
      linesHit: 2032,
      functionsFound: 418,
      functionsHit: 395,
    },
    'src/routes/schedules': {
      linesFound: 3502,
      linesHit: 3400,
      functionsFound: 729,
      functionsHit: 703,
    },
    // Missing storage-client.integration.test.ts's contribution — see the note above.
    'src/routes/storage': {
      linesFound: 2879,
      linesHit: 1423,
      functionsFound: 267,
      functionsHit: 225,
    },
    'src/routes/system': {
      linesFound: 4679,
      linesHit: 4439,
      functionsFound: 882,
      functionsHit: 842,
    },
    'src/routes/workers': {
      linesFound: 3784,
      linesHit: 1510,
      functionsFound: 294,
      functionsHit: 248,
    },
    'src/routes/workflows': {
      linesFound: 11687,
      linesHit: 9756,
      functionsFound: 2102,
      functionsHit: 1923,
    },
    tests: { linesFound: 145, linesHit: 114, functionsFound: 16, functionsHit: 15 },
  },
};
