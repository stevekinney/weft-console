import { describe, expect, it } from 'bun:test';

import {
  aggregateByArea,
  areaForFile,
  findRegressions,
  overallTotals,
  parseLcov,
  percentage,
  renderAreaTable,
  type FileCoverage,
} from './check-coverage.ts';
import type { AreaCoverage } from './coverage-baseline.ts';

describe('parseLcov', () => {
  it('parses a single record', () => {
    const lcov = [
      'TN:',
      'SF:src/lib/example.ts',
      'FNF:2',
      'FNH:1',
      'DA:1,5',
      'DA:2,0',
      'LF:10',
      'LH:7',
      'end_of_record',
      '',
    ].join('\n');

    expect(parseLcov(lcov)).toEqual([
      {
        file: 'src/lib/example.ts',
        linesFound: 10,
        linesHit: 7,
        functionsFound: 2,
        functionsHit: 1,
      },
    ]);
  });

  it('parses multiple records in one report', () => {
    const lcov = [
      'SF:a.ts',
      'FNF:1',
      'FNH:1',
      'LF:2',
      'LH:2',
      'end_of_record',
      'SF:b.ts',
      'FNF:3',
      'FNH:0',
      'LF:4',
      'LH:1',
      'end_of_record',
    ].join('\n');

    expect(parseLcov(lcov)).toEqual([
      { file: 'a.ts', linesFound: 2, linesHit: 2, functionsFound: 1, functionsHit: 1 },
      { file: 'b.ts', linesFound: 4, linesHit: 1, functionsFound: 3, functionsHit: 0 },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseLcov('')).toEqual([]);
  });

  it('drops a record with no SF: line rather than throwing', () => {
    const lcov = ['FNF:1', 'FNH:1', 'LF:2', 'LH:2', 'end_of_record'].join('\n');
    expect(parseLcov(lcov)).toEqual([]);
  });

  it('ignores unrecognized lines (e.g. DA:/TN:/BRDA:) between records', () => {
    const lcov = [
      'TN:',
      'SF:src/lib/example.ts',
      'FNF:1',
      'FNH:1',
      'BRDA:1,0,0,1',
      'DA:1,5',
      'LF:1',
      'LH:1',
      'end_of_record',
    ].join('\n');
    expect(parseLcov(lcov)).toEqual([
      {
        file: 'src/lib/example.ts',
        linesFound: 1,
        linesHit: 1,
        functionsFound: 1,
        functionsHit: 1,
      },
    ]);
  });

  it('resets state between records so one bad block cannot bleed into the next', () => {
    const lcov = [
      'SF:a.ts',
      'FNF:5',
      'FNH:5',
      'LF:5',
      'LH:5',
      'end_of_record',
      // No SF: for this block — dropped, and must not inherit a.ts's counts.
      'FNF:9',
      'FNH:9',
      'LF:9',
      'LH:9',
      'end_of_record',
      'SF:b.ts',
      'LF:2',
      'LH:2',
      'end_of_record',
    ].join('\n');
    expect(parseLcov(lcov)).toEqual([
      { file: 'a.ts', linesFound: 5, linesHit: 5, functionsFound: 5, functionsHit: 5 },
      { file: 'b.ts', linesFound: 2, linesHit: 2, functionsFound: 0, functionsHit: 0 },
    ]);
  });
});

describe('areaForFile', () => {
  it('buckets a src/routes/<domain> file by its domain', () => {
    expect(areaForFile('src/routes/workflows/list/workflow-list.svelte')).toBe(
      'src/routes/workflows',
    );
    expect(areaForFile('src/routes/storage/storage-client.ts')).toBe('src/routes/storage');
  });

  it('buckets a direct src/<segment> file by that segment', () => {
    expect(areaForFile('src/lib/faults.ts')).toBe('src/lib');
    expect(areaForFile('src/app/shell/topbar.svelte')).toBe('src/app');
  });

  it('buckets a top-level src/ file as "src"', () => {
    expect(areaForFile('src/main.ts')).toBe('src');
  });

  it('buckets non-src top-level directories by their own name', () => {
    expect(areaForFile('fixtures/workflows.ts')).toBe('fixtures');
    expect(areaForFile('scripts/check-coverage.ts')).toBe('scripts');
    expect(areaForFile('tests/setup.ts')).toBe('tests');
  });
});

describe('aggregateByArea', () => {
  it('sums per-file records into per-area totals', () => {
    const records: FileCoverage[] = [
      { file: 'src/lib/a.ts', linesFound: 10, linesHit: 5, functionsFound: 2, functionsHit: 1 },
      { file: 'src/lib/b.ts', linesFound: 4, linesHit: 4, functionsFound: 1, functionsHit: 1 },
      {
        file: 'src/routes/workers/index.ts',
        linesFound: 6,
        linesHit: 3,
        functionsFound: 2,
        functionsHit: 0,
      },
    ];

    const areas = aggregateByArea(records);
    expect(areas.get('src/lib')).toEqual({
      linesFound: 14,
      linesHit: 9,
      functionsFound: 3,
      functionsHit: 2,
    });
    expect(areas.get('src/routes/workers')).toEqual({
      linesFound: 6,
      linesHit: 3,
      functionsFound: 2,
      functionsHit: 0,
    });
  });

  it('returns an empty map for no records', () => {
    expect(aggregateByArea([])).toEqual(new Map());
  });
});

describe('overallTotals', () => {
  it('sums every record into one total', () => {
    const records: FileCoverage[] = [
      { file: 'a.ts', linesFound: 10, linesHit: 5, functionsFound: 2, functionsHit: 1 },
      { file: 'b.ts', linesFound: 4, linesHit: 4, functionsFound: 1, functionsHit: 1 },
    ];
    expect(overallTotals(records)).toEqual({
      linesFound: 14,
      linesHit: 9,
      functionsFound: 3,
      functionsHit: 2,
    });
  });

  it('returns all-zero totals for no records', () => {
    expect(overallTotals([])).toEqual({
      linesFound: 0,
      linesHit: 0,
      functionsFound: 0,
      functionsHit: 0,
    });
  });
});

describe('percentage', () => {
  it('computes hit/found as a percentage', () => {
    expect(percentage(1, 2)).toBe(50);
    expect(percentage(3, 4)).toBe(75);
  });

  it('treats zero found as vacuously 100% covered', () => {
    expect(percentage(0, 0)).toBe(100);
  });
});

describe('findRegressions', () => {
  it('reports no regressions when current matches baseline exactly', () => {
    const baseline = new Map<string, AreaCoverage>([
      ['src/lib', { linesFound: 10, linesHit: 10, functionsFound: 2, functionsHit: 2 }],
    ]);
    expect(findRegressions(baseline, baseline)).toEqual([]);
  });

  it('reports no regressions when current coverage improves', () => {
    const baseline = new Map<string, AreaCoverage>([
      ['src/lib', { linesFound: 10, linesHit: 5, functionsFound: 2, functionsHit: 1 }],
    ]);
    const current = new Map<string, AreaCoverage>([
      ['src/lib', { linesFound: 10, linesHit: 8, functionsFound: 2, functionsHit: 2 }],
    ]);
    expect(findRegressions(current, baseline)).toEqual([]);
  });

  it('reports a line regression', () => {
    const baseline = new Map<string, AreaCoverage>([
      ['src/lib', { linesFound: 10, linesHit: 10, functionsFound: 2, functionsHit: 2 }],
    ]);
    const current = new Map<string, AreaCoverage>([
      ['src/lib', { linesFound: 10, linesHit: 5, functionsFound: 2, functionsHit: 2 }],
    ]);
    expect(findRegressions(current, baseline)).toEqual([
      { area: 'src/lib', metric: 'lines', currentPercentage: 50, baselinePercentage: 100 },
    ]);
  });

  it('reports a function regression independently of lines', () => {
    const baseline = new Map<string, AreaCoverage>([
      ['src/lib', { linesFound: 10, linesHit: 10, functionsFound: 4, functionsHit: 4 }],
    ]);
    const current = new Map<string, AreaCoverage>([
      ['src/lib', { linesFound: 10, linesHit: 10, functionsFound: 4, functionsHit: 1 }],
    ]);
    expect(findRegressions(current, baseline)).toEqual([
      { area: 'src/lib', metric: 'functions', currentPercentage: 25, baselinePercentage: 100 },
    ]);
  });

  it('does not gate an area missing from the current run (skipped, not failed)', () => {
    const baseline = new Map<string, AreaCoverage>([
      [
        'src/routes/removed-domain',
        { linesFound: 10, linesHit: 10, functionsFound: 2, functionsHit: 2 },
      ],
    ]);
    expect(findRegressions(new Map(), baseline)).toEqual([]);
  });

  it('does not gate a new area with no baseline entry', () => {
    const current = new Map<string, AreaCoverage>([
      [
        'src/routes/new-domain',
        { linesFound: 10, linesHit: 0, functionsFound: 2, functionsHit: 0 },
      ],
    ]);
    expect(findRegressions(current, new Map())).toEqual([]);
  });
});

describe('renderAreaTable', () => {
  it('renders a header row plus one row per union of current/baseline areas, sorted', () => {
    const current = new Map<string, AreaCoverage>([
      ['src/lib', { linesFound: 10, linesHit: 10, functionsFound: 2, functionsHit: 2 }],
      ['src/app', { linesFound: 4, linesHit: 2, functionsFound: 1, functionsHit: 1 }],
    ]);
    const baseline = new Map<string, AreaCoverage>([
      ['src/lib', { linesFound: 10, linesHit: 10, functionsFound: 2, functionsHit: 2 }],
    ]);

    const lines = renderAreaTable(current, baseline);
    expect(lines[0]).toBe('area | lines | functions | baseline lines | baseline functions');
    expect(lines[1]).toBe('src/app | 50.00% | 100.00% | (new) | (new)');
    expect(lines[2]).toBe('src/lib | 100.00% | 100.00% | 100.00% | 100.00%');
  });

  it('marks a baselined area missing from the current run as (missing)', () => {
    const baseline = new Map<string, AreaCoverage>([
      ['src/routes/removed', { linesFound: 10, linesHit: 10, functionsFound: 2, functionsHit: 2 }],
    ]);
    const lines = renderAreaTable(new Map(), baseline);
    expect(lines[1]).toBe('src/routes/removed | (missing) | (missing) | 100.00% | 100.00%');
  });
});
