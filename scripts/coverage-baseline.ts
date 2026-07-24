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
   * Re-measured 2026-07-24 after the Cinder 0.19.0 migration. Coverage runs
   * serially because Bun's default-parallel coverage workers can collide on
   * the integration servers' ephemeral ports; the exact command is recorded
   * in package.json's `test:coverage` script.
   */
  overall: AreaCoverage;
  areas: Record<string, AreaCoverage>;
};

export const COVERAGE_BASELINE: CoverageBaseline = {
  measuredAt: '2026-07-24T20:44:04.000Z',
  overall: { linesFound: 35492, linesHit: 23003, functionsFound: 4712, functionsHit: 4064 },
  areas: {
    fixtures: { linesFound: 698, linesHit: 319, functionsFound: 69, functionsHit: 12 },
    scripts: { linesFound: 288, linesHit: 221, functionsFound: 22, functionsHit: 21 },
    'src/app': { linesFound: 1350, linesHit: 1136, functionsFound: 264, functionsHit: 150 },
    'src/lib': { linesFound: 1353, linesHit: 825, functionsFound: 174, functionsHit: 103 },
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
      linesFound: 4728,
      linesHit: 4350,
      functionsFound: 871,
      functionsHit: 807,
    },
    'src/routes/workers': {
      linesFound: 3784,
      linesHit: 1510,
      functionsFound: 294,
      functionsHit: 248,
    },
    'src/routes/workflows': {
      linesFound: 12862,
      linesHit: 6814,
      functionsFound: 1429,
      functionsHit: 1263,
    },
    tests: { linesFound: 145, linesHit: 114, functionsFound: 16, functionsHit: 15 },
  },
};
