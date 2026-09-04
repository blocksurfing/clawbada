/**
 * Deterministic arena layout generation. Same (seed, tier) → same board on
 * every server, client, and on-chain replay. Randomness goes through the
 * keccak-based helpers so it can be reproduced in Solidity.
 *
 * Rules (mirroring the designer's hand-authored layouts):
 *   • blocked cells only in interior columns — spawn columns stay open
 *   • never on a spawn cell
 *   • every open cell stays reachable from every other (no walled-in lobsters)
 */
import { deriveRandom } from '../hash';
import { BOARD_COLS, BOARD_ROWS, DEFAULT_BLOCKED_MAX, DEFAULT_BLOCKED_MIN } from './constants';
import { allOpenCellsConnected, defaultSpawns, hexKey, type ArenaLayout, type HexPos } from './board';

export interface LayoutOptions {
  cols?: number;
  rows?: number;
  minBlocked?: number;
  maxBlocked?: number;
  layoutId?: string;
}

export function generateLayout(vrfSeed: bigint, tier: ArenaLayout['tier'], opts: LayoutOptions = {}): ArenaLayout {
  const cols = opts.cols ?? BOARD_COLS;
  const rows = opts.rows ?? BOARD_ROWS;
  const minBlocked = opts.minBlocked ?? DEFAULT_BLOCKED_MIN;
  const maxBlocked = Math.max(minBlocked, opts.maxBlocked ?? DEFAULT_BLOCKED_MAX);
  const layoutId = opts.layoutId ?? `gen_${tier}_${(vrfSeed & 0xffffffffn).toString(16)}`;
  const spawns = defaultSpawns(cols, rows);
  const layout: ArenaLayout = { layoutId, cols, rows, blockedHexes: [], tier, ...spawns };

  const seed = deriveRandom(vrfSeed, `layout|${tier}`);
  const span = BigInt(maxBlocked - minBlocked + 1);
  const target = minBlocked + Number(deriveRandom(seed, 'count') % span);

  const reserved = new Set([...spawns.teamASpawns, ...spawns.teamBSpawns].map(hexKey));
  const candidates: HexPos[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 1; c < cols - 1; c++) {
      const p = { col: c, row: r };
      if (!reserved.has(hexKey(p))) candidates.push(p);
    }
  // Fisher–Yates with keccak-derived indices.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Number(deriveRandom(seed, `shuffle_${i}`) % BigInt(i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (const cell of candidates) {
    if (layout.blockedHexes.length >= target) break;
    layout.blockedHexes.push(cell);
    if (!allOpenCellsConnected(layout)) layout.blockedHexes.pop();
  }
  layout.blockedHexes.sort((a, b) => (a.row - b.row) || (a.col - b.col));
  return layout;
}
