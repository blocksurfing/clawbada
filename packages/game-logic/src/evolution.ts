/**
 * Evolution requirement checks and stat preview.
 *
 * Evolution transforms lobsters into more powerful versions:
 *   Base → Evolved (2 Base fuel + 2,000 $CLAW)
 *   Evolved → Elite (2 Evolved fuel + 10,000 $CLAW)
 *   Elite → Apex (2 Elite fuel + 50,000 $CLAW)
 *
 * Fuel lobsters are burned permanently. Evolution gates mining tiers and battle access.
 */

import { EVOLUTION_COSTS, EVOLUTION_FUEL_COUNT } from './constants';
import { getBaseStats, scaleStats } from './battle-resolver';
import type { Stats, Lobster } from './types';
import { EvolutionTier, LegendStatus } from './types';

export interface EvolutionRequirements {
  fuelCount: number;
  fuelTier: EvolutionTier;
  clawCost: bigint;
}

/**
 * Get the requirements for evolving to the next tier.
 *
 * @param currentTier The lobster's current evolution tier
 * @returns Requirements for the next evolution, or null if already Apex
 */
export function evolutionRequirements(currentTier: EvolutionTier): EvolutionRequirements | null {
  if (currentTier === EvolutionTier.Apex) return null;

  const nextTier = currentTier + 1;
  return {
    fuelCount: EVOLUTION_FUEL_COUNT,
    fuelTier: currentTier as EvolutionTier,
    clawCost: EVOLUTION_COSTS[nextTier],
  };
}

/**
 * Validate whether a lobster can be evolved with the given fuel lobsters.
 *
 * @param lobster The lobster to evolve
 * @param fuelLobsters Array of fuel lobsters to burn
 * @returns Validation result with reason on failure
 */
export function canEvolve(
  lobster: Lobster,
  fuelLobsters: Lobster[],
): { valid: boolean; reason?: string } {
  if (lobster.evolutionTier === EvolutionTier.Apex) {
    return { valid: false, reason: 'Already at Apex tier' };
  }

  if (lobster.locked) {
    return { valid: false, reason: 'Lobster is locked (in team, mining, or battle)' };
  }

  const reqs = evolutionRequirements(lobster.evolutionTier)!;

  if (fuelLobsters.length !== reqs.fuelCount) {
    return { valid: false, reason: `Need exactly ${reqs.fuelCount} fuel lobsters, got ${fuelLobsters.length}` };
  }

  for (let i = 0; i < fuelLobsters.length; i++) {
    const fuel = fuelLobsters[i];
    if (fuel.tokenId === lobster.tokenId) {
      return { valid: false, reason: 'Cannot use the target lobster as fuel' };
    }
    if (fuel.locked) {
      return { valid: false, reason: `Fuel lobster #${fuel.tokenId} is locked` };
    }
    if (fuel.evolutionTier < reqs.fuelTier) {
      return { valid: false, reason: `Fuel lobster #${fuel.tokenId} must be at least ${EvolutionTier[reqs.fuelTier]} tier` };
    }
  }

  return { valid: true };
}

/**
 * Preview stats after evolution (without actually evolving).
 *
 * @param classId The lobster's class
 * @param targetTier The target evolution tier
 * @param isLegend Whether the lobster is a legend
 * @returns The scaled stats at the target tier (including HP × HP_BATTLE_SCALE battle scaling)
 */
export function previewEvolvedStats(
  classId: number,
  targetTier: EvolutionTier,
  isLegend: boolean,
): Stats {
  const base = getBaseStats(classId);
  return scaleStats(base, targetTier, isLegend);
}
