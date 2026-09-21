/**
 * 6×5 pointy-top offset hex board, odd-row-right (odd rows shifted right).
 * Coordinate conventions match the Unity client's HexCoord.cs exactly so
 * server and viewer agree on every cell.
 */
import { BOARD_COLS, BOARD_ROWS } from './constants';

export interface HexPos {
  col: number;
  row: number;
}

/** Wire-compatible with Unity's ArenaLayout (BattleBridge.cs). */
export interface ArenaLayout {
  layoutId: string;
  cols: number;
  rows: number;
  blockedHexes: HexPos[];
  teamASpawns: HexPos[];
  teamBSpawns: HexPos[];
  tier: 'evolved' | 'elite' | 'apex';
}

export function hexKey(p: HexPos): string {
  return `${p.col},${p.row}`;
}

export function sameHex(a: HexPos, b: HexPos): boolean {
  return a.col === b.col && a.row === b.row;
}

export function inBounds(layout: Pick<ArenaLayout, 'cols' | 'rows'>, p: HexPos): boolean {
  return p.col >= 0 && p.col < layout.cols && p.row >= 0 && p.row < layout.rows;
}

/** Offset (odd-r) → cube. */
export function offsetToCube(p: HexPos): [number, number, number] {
  const x = p.col - (p.row - (p.row & 1)) / 2;
  const z = p.row;
  return [x, -x - z, z];
}

export function hexDistance(a: HexPos, b: HexPos): number {
  const [ax, ay, az] = offsetToCube(a);
  const [bx, by, bz] = offsetToCube(b);
  return (Math.abs(ax - bx) + Math.abs(ay - by) + Math.abs(az - bz)) / 2;
}

/** Round fractional cube coords to the nearest hex (largest-drift component is recomputed). */
function cubeRound(x: number, y: number, z: number): [number, number, number] {
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return [rx, ry, rz];
}

/**
 * The hexes a shot passes over, strictly between `from` and `to`.
 *
 * Supercover: the line is walked twice with opposite epsilon nudges and the results
 * unioned, so a shot cannot thread a corner it visually should not. Endpoints are
 * excluded, so distance <= 1 always returns [] — adjacent lobsters are never in cover.
 */
export function hexLineBetween(from: HexPos, to: HexPos): HexPos[] {
  const n = hexDistance(from, to);
  if (n <= 1) return [];
  const [ax, ay, az] = offsetToCube(from);
  const [bx, by, bz] = offsetToCube(to);
  const seen = new Set<string>();
  const out: HexPos[] = [];
  for (const e of [1e-6, -1e-6]) {
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const [rx, , rz] = cubeRound(ax + (bx - ax) * t + e, ay + (by - ay) * t - e, az + (bz - az) * t);
      const p: HexPos = { col: rx + (rz - (rz & 1)) / 2, row: rz };
      const k = hexKey(p);
      if (!seen.has(k)) { seen.add(k); out.push(p); }
    }
  }
  return out;
}

/** True when a blocked hex lies on the line between the two positions (terrain cover). */
export function hasCover(layout: ArenaLayout, from: HexPos, to: HexPos): boolean {
  if (hexDistance(from, to) <= 1) return false;
  const blocked = blockedSet(layout);
  return hexLineBetween(from, to).some(p => blocked.has(hexKey(p)));
}

/** Six neighbours (may be out of bounds — callers filter). */
export function neighbors(p: HexPos): HexPos[] {
  const odd = (p.row & 1) === 1;
  return odd
    ? [
        { col: p.col + 1, row: p.row },
        { col: p.col, row: p.row - 1 },
        { col: p.col + 1, row: p.row - 1 },
        { col: p.col, row: p.row + 1 },
        { col: p.col + 1, row: p.row + 1 },
        { col: p.col - 1, row: p.row },
      ]
    : [
        { col: p.col + 1, row: p.row },
        { col: p.col - 1, row: p.row - 1 },
        { col: p.col, row: p.row - 1 },
        { col: p.col - 1, row: p.row + 1 },
        { col: p.col, row: p.row + 1 },
        { col: p.col - 1, row: p.row },
      ];
}

export function blockedSet(layout: ArenaLayout): Set<string> {
  return new Set(layout.blockedHexes.map(hexKey));
}

export function isBlocked(layout: ArenaLayout, p: HexPos): boolean {
  return layout.blockedHexes.some(b => sameHex(b, p));
}

/**
 * Cells reachable within `range` steps. Blocked cells and out-of-bounds cells
 * are impassable. Occupied cells (other lobsters) can be passed THROUGH but not
 * ended on — per CLAUDE.md "lobsters do not block movement (can path around)"
 * and "one lobster per hex". Origin is excluded from the result.
 */
export function reachableCells(
  layout: ArenaLayout,
  from: HexPos,
  range: number,
  occupied: Iterable<HexPos>,
): HexPos[] {
  const blocked = blockedSet(layout);
  const occ = new Set(Array.from(occupied, hexKey));
  const seen = new Map<string, number>([[hexKey(from), 0]]);
  const queue: HexPos[] = [from];
  const out: HexPos[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = seen.get(hexKey(cur))!;
    if (d === range) continue;
    for (const n of neighbors(cur)) {
      const k = hexKey(n);
      if (seen.has(k) || !inBounds(layout, n) || blocked.has(k)) continue;
      seen.set(k, d + 1);
      queue.push(n);
      if (!occ.has(k)) out.push(n);
    }
  }
  return out;
}

/** BFS shortest path (waypoints after `from`, through `to`); empty if unreachable. */
export function shortestPath(layout: ArenaLayout, from: HexPos, to: HexPos): HexPos[] {
  if (sameHex(from, to)) return [];
  const blocked = blockedSet(layout);
  const prev = new Map<string, HexPos | null>([[hexKey(from), null]]);
  const queue: HexPos[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (sameHex(cur, to)) break;
    for (const n of neighbors(cur)) {
      const k = hexKey(n);
      if (prev.has(k) || !inBounds(layout, n) || blocked.has(k)) continue;
      prev.set(k, cur);
      queue.push(n);
    }
  }
  if (!prev.has(hexKey(to))) return [];
  const path: HexPos[] = [];
  for (let cur: HexPos | null = to; cur && !sameHex(cur, from); cur = prev.get(hexKey(cur)) ?? null) path.push(cur);
  return path.reverse();
}

/** True when every open cell can reach every other (single connected component). */
export function allOpenCellsConnected(layout: ArenaLayout): boolean {
  const blocked = blockedSet(layout);
  let start: HexPos | null = null;
  let open = 0;
  for (let r = 0; r < layout.rows; r++)
    for (let c = 0; c < layout.cols; c++) {
      if (blocked.has(hexKey({ col: c, row: r }))) continue;
      open++;
      if (!start) start = { col: c, row: r };
    }
  if (!start) return false;
  const seen = new Set([hexKey(start)]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const n of neighbors(cur)) {
      const k = hexKey(n);
      if (seen.has(k) || !inBounds(layout, n) || blocked.has(k)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return seen.size === open;
}

/** Standard spawns: Team A column 0 rows 1–3, Team B last column rows 1–3. */
export function defaultSpawns(cols = BOARD_COLS, rows = BOARD_ROWS): Pick<ArenaLayout, 'teamASpawns' | 'teamBSpawns'> {
  const mid = Math.floor(rows / 2);
  const rowsUsed = [mid - 1, mid, mid + 1];
  return {
    teamASpawns: rowsUsed.map(row => ({ col: 0, row })),
    teamBSpawns: rowsUsed.map(row => ({ col: cols - 1, row })),
  };
}
