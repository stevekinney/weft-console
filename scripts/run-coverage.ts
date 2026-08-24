import { $ } from 'bun';
import { join } from 'node:path';

import { coverageTestArguments, discoverCoverageTestFiles } from './check-coverage.ts';

const repositoryRoot = join(import.meta.dir, '..');
const testFiles = discoverCoverageTestFiles(repositoryRoot);
const testArguments = coverageTestArguments(testFiles);

if (testFiles.length === 0) {
  console.error('No coverage test files were discovered.');
  process.exit(1);
}

// Deliberately NOT `--parallel=1`. `bun test --parallel` (even at N=1)
// implies `--isolate`, giving each test file a fresh module registry. When a
// Svelte component is both directly unit-tested AND statically imported by a
// sibling component also under test, that isolation makes Bun's coverage
// engine produce two differently-instrumented instances of the shared file;
// its LCOV merge does not correctly union their per-line hit counts — one
// instance's (lower) numbers clobber the other's instead. Confirmed via
// bisection (see WFC-10 PR description / commit history): reproducible with
// a fresh `BUN_RUNTIME_TRANSPILER_CACHE_PATH`, independent of test order,
// and gone entirely once `--parallel=1` is dropped — filed upstream:
// https://github.com/oven-sh/bun/issues/40386. Running all files in one
// shared process instead (no
// isolation) sidesteps it: two full-suite runs produced near-identical LCOV
// (1290/1290 tests passing both times) and coverage rose from a measured
// 64.71% to 84.95% overall lines with zero new tests — pure measurement
// error, not a real gap. This is also ~9x faster (~25s vs ~230s).
console.log(`Running ${testFiles.length} coverage test files in the versioned baseline order.`);
const run =
  await $`TZ=UTC bun test --conditions browser --conditions svelte --coverage --coverage-reporter=lcov ${testArguments}`
    .cwd(repositoryRoot)
    .nothrow();
process.exit(run.exitCode);
