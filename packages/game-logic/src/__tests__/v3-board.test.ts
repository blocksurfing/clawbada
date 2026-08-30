import { describe, expect, test } from 'bun:test';
import { v3 } from '../index';

const { hexDistance, neighbors, inBounds, reachableCells, shortestPath, generateLayout, allOpenCellsConnected, defaultSpawns, hexKey } = v3;

const open: v3.ArenaLayout = { layoutId: 'open', cols: 6, rows: 5, blockedHexes: [], tier: 'evolved', ...defaultSpawns() };

describe('hex board (odd-r, pointy-top)', () => {
  test('distance is symmetric and matches cube metric', () => {
    expect(hexDistance({ col: 0, row: 0 }, { col: 0, row: 0 })).toBe(0);
    expect(hexDistance({ col: 0, row: 0 }, { col: 1, row: 0 })).toBe(1);
    expect(hexDistance({ col: 0, row: 0 }, { col: 0, row: 1 })).toBe(1); // odd-r: (0,1) touches (0,0)
    expect(hexDistance({ col: 0, row: 0 }, { col: 5, row: 0 })).toBe(5);
    expect(hexDistance({ col: 0, row: 2 }, { col: 5, row: 2 })).toBe(5);
    for (let i = 0; i < 50; i++) {
      const a = { col: i % 6, row: (i * 7) % 5 }, b = { col: (i * 3) % 6, row: (i * 2) % 5 };
      expect(hexDistance(a, b)).toBe(hexDistance(b, a));
    }
  });

  test('every neighbour is at distance 1 and interior cells have 6 in-bounds neighbours', () => {
    for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) {
      const p = { col: c, row: r };
      const ns = neighbors(p);
      expect(ns).toHaveLength(6);
      for (const n of ns) expect(hexDistance(p, n)).toBe(1);
    }
    expect(neighbors({ col: 2, row: 2 }).filter(n => inBounds(open, n))).toHaveLength(6);
  });

  test('reachable cells respect range, blocked cells, and occupancy (pass through, no stop)', () => {
    const layout: v3.ArenaLayout = { ...open, blockedHexes: [{ col: 1, row: 2 }] };
    const from = { col: 0, row: 2 };
    const r1 = reachableCells(layout, from, 1, []);
    expect(r1.map(hexKey).sort()).toEqual(['0,1', '0,3'].sort()); // (1,2) blocked
    const r2 = reachableCells(layout, from, 2, [{ col: 0, row: 1 }]);
    expect(r2.some(c => hexKey(c) === '0,1')).toBe(false); // occupied: can't end there
    expect(r2.some(c => hexKey(c) === '1,1')).toBe(true); // but can pass through it
    expect(r2.some(c => hexKey(c) === '1,2')).toBe(false);
    for (const c of r2) expect(hexDistance(from, c)).toBeLessThanOrEqual(2);
  });

  test('shortest path routes around blocked cells', () => {
    const layout: v3.ArenaLayout = { ...open, blockedHexes: [{ col: 1, row: 2 }, { col: 1, row: 1 }, { col: 1, row: 3 }] };
    const path = shortestPath(layout, { col: 0, row: 2 }, { col: 2, row: 2 });
    expect(path.length).toBeGreaterThan(2);
    expect(hexKey(path[path.length - 1])).toBe('2,2');
    for (const p of path) expect(layout.blockedHexes.some(b => hexKey(b) === hexKey(p))).toBe(false);
  });
});

describe('layout generator', () => {
  test('deterministic, interior-only, spawn-safe, connected, 5–6 blocked', () => {
    const tiers: v3.ArenaLayout['tier'][] = ['evolved', 'elite', 'apex'];
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      for (const tier of tiers) {
        const seed = BigInt(i) * 7919n + 1n;
        const a = generateLayout(seed, tier);
        const b = generateLayout(seed, tier);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(a.blockedHexes.length).toBeGreaterThanOrEqual(5);
        expect(a.blockedHexes.length).toBeLessThanOrEqual(6);
        const spawns = new Set([...a.teamASpawns, ...a.teamBSpawns].map(hexKey));
        for (const h of a.blockedHexes) {
          expect(h.col).toBeGreaterThanOrEqual(1);
          expect(h.col).toBeLessThanOrEqual(4);
          expect(spawns.has(hexKey(h))).toBe(false);
        }
        expect(new Set(a.blockedHexes.map(hexKey)).size).toBe(a.blockedHexes.length);
        expect(allOpenCellsConnected(a)).toBe(true);
        seen.add(a.blockedHexes.map(hexKey).join(';'));
      }
    }
    expect(seen.size).toBeGreaterThan(500); // plenty of variety across 900 boards
  });
});
