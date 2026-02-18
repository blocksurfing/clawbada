/**
 * Repair cost calculations for damaged lobsters.
 *
 * After battle, all participating lobsters accumulate damage points.
 * Lobsters with >=80 damage cannot enter battle until repaired.
 * Repair costs scale by evolution tier.
 */

import { DAMAGE_THRESHOLD, REPAIR_RATES } from './constants';
import type { EvolutionTier } from './types';

/**
 * Calculate the $CLAW cost to repair a given number of damage points.
 *
 * @param tier The lobster's evolution tier (Base=0, Evolved=1, Elite=2, Apex=3)
 * @param damagePoints Number of damage points to repair
 * @returns Cost in $CLAW (bigint)
 */
export function repairCost(tier: EvolutionTier, damagePoints: number): bigint {
  if (damagePoints <= 0) return 0n;
  return BigInt(damagePoints) * REPAIR_RATES[tier];
}

/**
 * Calculate total repair cost for a team of lobsters.
 *
 * @param lobsters Array of lobsters with their tier and current damage
 * @returns Total cost in $CLAW (bigint)
 */
export function teamRepairCost(lobsters: { tier: EvolutionTier; damage: number }[]): bigint {
  let total = 0n;
  for (const l of lobsters) {
    total += repairCost(l.tier, l.damage);
  }
  return total;
}

/**
 * Check whether a lobster can enter battle based on its damage.
 *
 * @param damage Current damage points (0-100)
 * @returns true if damage is below the threshold (80)
 */
export function canEnterBattle(damage: number): boolean {
  return damage < DAMAGE_THRESHOLD;
}
