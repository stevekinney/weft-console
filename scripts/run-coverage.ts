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

console.log(`Running ${testFiles.length} coverage test files in the versioned baseline order.`);
const run =
  await $`TZ=UTC bun test --parallel=1 --conditions browser --conditions svelte --coverage --coverage-reporter=lcov ${testArguments}`
    .cwd(repositoryRoot)
    .nothrow();
process.exit(run.exitCode);
