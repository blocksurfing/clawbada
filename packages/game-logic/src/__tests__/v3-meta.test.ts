import { describe, expect, test } from 'bun:test';
import { v3 } from '../index';

describe('comp-meta analysis pieces', () => {
  test('enumerates all 220 comps, sorted and unique', () => {
    const comps = v3.enumerateComps();
    expect(comps).toHaveLength(220);
    const keys = new Set(comps.map(c => c.join(',')));
    expect(keys.size).toBe(220);
    for (const c of comps) expect(c[0] <= c[1] && c[1] <= c[2]).toBe(true);
  });

  test('replicator finds the uniform mix on rock-paper-scissors', () => {
    const W = [
      [0.5, 1.0, 0.0],
      [0.0, 0.5, 1.0],
      [1.0, 0.0, 0.5],
    ];
    const mix = v3.replicator(W, 8000);
    for (const p of mix) expect(Math.abs(p - 1 / 3)).toBeLessThan(0.05);
    expect(v3.effectiveSupport(mix)).toBeGreaterThan(2.8);
  });

  test('replicator collapses onto a dominant strategy', () => {
    const W = [
      [0.5, 0.8, 0.8],
      [0.2, 0.5, 0.6],
      [0.2, 0.4, 0.5],
    ];
    const mix = v3.replicator(W, 8000);
    expect(mix[0]).toBeGreaterThan(0.95);
    expect(v3.effectiveSupport(mix)).toBeLessThan(1.3);
    const pay = v3.payoffsVsMix(W, mix);
    expect(Math.max(...pay)).toBeLessThanOrEqual(0.51); // dominant strategy is unexploitable
  });

  test('duelComps is deterministic and symmetric-ish on a mirror', () => {
    const a: v3.Comp = [0, 5, 8];
    const r1 = v3.duelComps(a, a, v3.focusPolicy, 3, { tier: 'elite', purity: 3, seed: 42n });
    const r2 = v3.duelComps(a, a, v3.focusPolicy, 3, { tier: 'elite', purity: 3, seed: 42n });
    expect(r1).toBe(r2);
    expect(r1).toBeGreaterThan(0.15);
    expect(r1).toBeLessThan(0.85);
  });
});
