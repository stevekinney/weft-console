/**
 * Production CSS integrity gate for Cinder's automatic component styles.
 * Component JavaScript entrypoints own these selectors; the console must
 * not restore a parallel per-component style ledger to make this pass.
 */
import { join } from 'node:path';

const ASSETS_DIRECTORY = join(import.meta.dir, '..', 'dist', 'assets');

const REQUIRED_SELECTORS = [
  '.cinder-sidebar',
  '.cinder-feed',
  '.cinder-run-step-timeline',
  '.cinder-schedule-builder',
  '.cinder-meter',
  '.cinder-segmented-control',
  '.cinder-payload-inspector',
  '.cinder-tree',
  '.cinder-badge',
] as const;

const stylesheetPaths = await Array.fromAsync(
  new Bun.Glob('*.css').scan({ cwd: ASSETS_DIRECTORY, absolute: true }),
);

if (stylesheetPaths.length === 0) {
  throw new Error(
    'check-cinder-styles: no production stylesheets found; run `bun run build` first',
  );
}

const stylesheetContents = await Promise.all(
  stylesheetPaths.map((stylesheetPath) => Bun.file(stylesheetPath).text()),
);
const productionCss = stylesheetContents.join('\n');

const missingSelectors = REQUIRED_SELECTORS.filter(
  (requiredSelector) => !productionCss.includes(requiredSelector),
);

if (missingSelectors.length > 0) {
  throw new Error(
    `check-cinder-styles: missing Cinder selectors from production CSS: ${missingSelectors.join(', ')}`,
  );
}

console.log(
  `Cinder production CSS contains all ${REQUIRED_SELECTORS.length} representative component selectors.`,
);
