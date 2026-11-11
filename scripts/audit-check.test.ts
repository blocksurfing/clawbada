import { describe, expect, test } from 'bun:test';
import { compare, summarize, type AuditReport } from './audit-check';

const report: AuditReport = {
  zeta: [{ url: 'https://github.com/advisories/GHSA-zzzz-0000-0001', title: 'Zeta leaks', severity: 'high' }],
  alpha: [
    { url: 'https://github.com/advisories/GHSA-aaaa-0000-0002', title: 'Alpha two', severity: 'low' },
    { url: 'https://github.com/advisories/GHSA-aaaa-0000-0001', title: 'Alpha one', severity: 'moderate' },
    // the registry lists one advisory twice when it covers two version ranges
    { url: 'https://github.com/advisories/GHSA-aaaa-0000-0001', title: 'Alpha one', severity: 'moderate' },
  ],
};

describe('summarize', () => {
  test('one line per advisory, packages and ids sorted, duplicates folded', () => {
    const s = summarize(report);
    expect(Object.keys(s)).toEqual(['alpha', 'zeta']);
    expect(Object.keys(s.alpha)).toEqual(['GHSA-aaaa-0000-0001', 'GHSA-aaaa-0000-0002']);
    expect(s.zeta['GHSA-zzzz-0000-0001']).toBe('high — Zeta leaks');
  });
});

describe('compare', () => {
  const baseline = summarize(report);

  test('the same report is nothing new', () => {
    expect(compare(summarize(report), baseline)).toEqual({ fresh: [], gone: [] });
  });

  test('a new advisory in a known package is fresh', () => {
    const now = summarize({ ...report, zeta: [...report.zeta, { url: 'https://github.com/advisories/GHSA-zzzz-0000-0009', title: 'Zeta again', severity: 'critical' }] });
    expect(compare(now, baseline).fresh).toEqual([{ pkg: 'zeta', id: 'GHSA-zzzz-0000-0009', line: 'critical — Zeta again' }]);
  });

  test('an advisory in a package never seen before is fresh', () => {
    const now = summarize({ ...report, omega: [{ url: 'https://github.com/advisories/GHSA-oooo-0000-0001', title: 'Omega', severity: 'high' }] });
    expect(compare(now, baseline).fresh.map((f) => f.pkg)).toEqual(['omega']);
  });

  test('a fixed advisory is reported as gone, and is not a failure', () => {
    const { zeta: _fixed, ...rest } = report;
    const c = compare(summarize(rest), baseline);
    expect(c.fresh).toEqual([]);
    expect(c.gone).toEqual([{ pkg: 'zeta', id: 'GHSA-zzzz-0000-0001' }]);
  });

  test('an empty baseline makes everything fresh', () => {
    expect(compare(summarize(report), {}).fresh).toHaveLength(3);
  });
});
