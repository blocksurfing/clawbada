/**
 * RepairShop damage points for a finished V3 battle: winner band 5–15, loser
 * band 20–40 per lobster, VRF-derived from the battle seed — the same bands and
 * roll the V2 sim used, keyed by player slot to match `BattleArena.settle`.
 * A draw has no loser, so both teams roll the winner band.
 */
import { rollTeamDamage } from '../battle-sim';
import { deriveRandom } from '../hash';
import type { AtbBattleState } from './state';

export interface RepairDamage {
  damageA: [number, number, number];
  damageB: [number, number, number];
}

export function repairDamage(state: AtbBattleState): RepairDamage {
  if (!state.finished) throw new Error('repairDamage: battle is not finished');
  const seed = deriveRandom(state.vrfSeed, 'repair');
  const aWon = state.winner === 'A' || state.winner === 'draw';
  const bWon = state.winner === 'B' || state.winner === 'draw';
  return { damageA: rollTeamDamage(seed, 'A', aWon), damageB: rollTeamDamage(seed, 'B', bWon) };
}
