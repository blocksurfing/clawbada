/**
 * Terrain cover: the hex line traced between two positions, and the damage reduction that
 * rides on it. The geometry is load-bearing — a wrong line silently poisons every balance
 * sweep that uses cover — so it is tested directly rather than only through battle outcomes.
 */
import { describe, expect, test } from 'bun:test';
import { hasCover, hexDistance, hexLineBetween, type ArenaLayout, type HexPos } from '../v3/board';
import { BOARD_COLS, BOARD_ROWS } from '../v3/constants';

const layout = (blockedHexes: HexPos[]): ArenaLayout => ({
  layoutId: 'test', cols: BOARD_COLS, rows: BOARD_ROWS, tier: 'elite', blockedHexes,
  teamASpawns: [{ col: 0, row: 0 }, { col: 0, row: 1 }, { col: 0, row: 2 }],
  teamBSpawns: [{ col: 5, row: 0 }, { col: 5, row: 1 }, { col: 5, row: 2 }],
});

const everyHex = (): HexPos[] => {
  const out: HexPos[] = [];
  for (let col = 0; col < BOARD_COLS; col++) for (let row = 0; row < BOARD_ROWS; row++) out.push({ col, row });
  return out;
};

describe('hexLineBetween', () => {
  test('adjacent and identical hexes have nothing in between — melee is never in cover', () => {
    for (const a of everyHex()) {
      for (const b of everyHex()) {
        if (hexDistance(a, b) <= 1) expect(hexLineBetween(a, b)).toEqual([]);
      }
    }
  });

  test('every returned hex lies strictly on the path, and neither endpoint is included', () => {
    for (const a of everyHex()) {
      for (const b of everyHex()) {
        const n = hexDistance(a, b);
        for (const p of hexLineBetween(a, b)) {
          // On a hex grid, a cell is on the path iff going through it costs no detour.
          expect(hexDistance(a, p) + hexDistance(p, b)).toBe(n);
          expect(hexDistance(a, p)).toBeGreaterThan(0);
          expect(hexDistance(p, b)).toBeGreaterThan(0);
        }
      }
    }
  });

  test('is symmetric — a shot cannot be blocked one way and clear the other', () => {
    const key = (p: HexPos) => `${p.col},${p.row}`;
    for (const a of everyHex()) {
      for (const b of everyHex()) {
        const there = hexLineBetween(a, b).map(key).sort();
        const back = hexLineBetween(b, a).map(key).sort();
        expect(there).toEqual(back);
      }
    }
  });

  test('a straight run along a row reports the cells between', () => {
    const line = hexLineBetween({ col: 0, row: 0 }, { col: 3, row: 0 });
    expect(line.map(p => `${p.col},${p.row}`).sort()).toEqual(['1,0', '2,0']);
  });
});

describe('hasCover', () => {
  test('an obstacle directly in the lane gives cover; an empty lane does not', () => {
    const from = { col: 0, row: 0 }, to = { col: 3, row: 0 };
    expect(hasCover(layout([{ col: 2, row: 0 }]), from, to)).toBe(true);
    expect(hasCover(layout([]), from, to)).toBe(false);
  });

  test('an obstacle behind the target or on the shooter does not count', () => {
    const from = { col: 0, row: 0 }, to = { col: 2, row: 0 };
    expect(hasCover(layout([{ col: 3, row: 0 }]), from, to)).toBe(false);
    expect(hasCover(layout([{ col: 0, row: 0 }]), from, to)).toBe(false);
  });

  test('is symmetric for every pair on a fully seeded board', () => {
    const lay = layout([{ col: 2, row: 1 }, { col: 3, row: 3 }, { col: 1, row: 2 }]);
    for (const a of everyHex()) for (const b of everyHex()) expect(hasCover(lay, a, b)).toBe(hasCover(lay, b, a));
  });

  test('adjacent targets are never in cover, whatever the board looks like', () => {
    const lay = layout(everyHex());
    for (const a of everyHex()) for (const b of everyHex()) if (hexDistance(a, b) <= 1) expect(hasCover(lay, a, b)).toBe(false);
  });
});
