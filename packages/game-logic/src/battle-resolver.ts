/**
 * TypeScript port of BattleResolver.sol — pure combat math.
 *
 * All calculations use bigint with ×1000 fixed-point to match Solidity precision.
 */

import {
  ATTACK_BASE_POWER,
  BASE_STATS,
  CLASS_ADV_MULT,
  CLASS_DISADV_MULT,
  CLASS_NEUTRAL_MULT,
  CRIT_DENOM,
  CRIT_MULT,
  DEFEND_COUNTER_BASE,
  HP_BATTLE_SCALE,
  LEGEND_MULT,
  MULT_DENOM,
  NUM_CLASSES,
  PURITY_ENHANCED_BASE_BPS,
  PURITY_ENHANCED_PER_BPS,
  PURITY_POTENCY_PER,
  STAT_RATIO_CAP,
  TIER_MULT_APEX,
  TIER_MULT_BASE,
  TIER_MULT_ELITE,
  TIER_MULT_EVOLVED,
} from './constants';
import type { Stats } from './types';
import { EvolutionTier, LobsterClass } from './types';

/** Calculate atk/armor ratio capped at 2.2× (STAT_RATIO_CAP), scaled ×1000. */
function cappedRatio(atk: bigint, armor: bigint): bigint {
  // S-03 parity with BattleResolver.sol: armor == 0 returns the cap rather than dividing
  // by zero (which throws in bigint). (R-03's overflow guard is Solidity-only — bigint is
  // arbitrary-precision, so the large-atk path simply computes the real ratio and caps.)
  if (armor === 0n) return STAT_RATIO_CAP;
  const ratio = (atk * MULT_DENOM) / armor;
  return ratio > STAT_RATIO_CAP ? STAT_RATIO_CAP : ratio;
}

/** Returns the base stats for a class (before evolution, legend, body part modifiers). */
export function getBaseStats(classId: LobsterClass): Stats {
  if (classId < 0 || classId >= NUM_CLASSES) {
    throw new Error(`Invalid class ID: ${classId}`);
  }
  const [hp, attack, armor, speed, critical] = BASE_STATS[classId];
  return { hp, attack, armor, speed, critical };
}

/**
 * Apply evolution tier multiplier, legend bonus, and HP battle scaling.
 *
 * @param base The base stats from getBaseStats
 * @param tier 0=Base, 1=Evolved, 2=Elite, 3=Apex
 * @param legend Whether this lobster is a legend
 */
export function scaleStats(base: Stats, tier: EvolutionTier, legend: boolean): Stats {
  let tierMult: bigint;
  switch (tier) {
    case EvolutionTier.Base:
      tierMult = TIER_MULT_BASE;
      break;
    case EvolutionTier.Evolved:
      tierMult = TIER_MULT_EVOLVED;
      break;
    case EvolutionTier.Elite:
      tierMult = TIER_MULT_ELITE;
      break;
    case EvolutionTier.Apex:
      tierMult = TIER_MULT_APEX;
      break;
    default:
      // F5-04 parity with BattleResolver.sol: reject out-of-range tiers (fail closed)
      // rather than silently clamping to Apex — both implementations now agree.
      throw new Error(`Invalid tier: ${tier}`);
  }

  const legendMult = legend ? LEGEND_MULT : MULT_DENOM;
  const denom = MULT_DENOM * MULT_DENOM;

  return {
    hp: (base.hp * tierMult * legendMult * HP_BATTLE_SCALE) / denom,
    attack: (base.attack * tierMult * legendMult) / denom,
    armor: (base.armor * tierMult * legendMult) / denom,
    speed: (base.speed * tierMult * legendMult) / denom,
    critical: (base.critical * tierMult * legendMult) / denom,
  };
}

/**
 * Returns the class advantage multiplier (×1000).
 *
 * Circulant graph: class i beats (i+1..i+4)%10, neutral with self and (i+5)%10, loses to rest.
 */
export function getClassAdvantage(atkClass: LobsterClass, defClass: LobsterClass): bigint {
  if (atkClass < 0 || atkClass >= NUM_CLASSES) throw new Error(`Invalid attacker class: ${atkClass}`);
  if (defClass < 0 || defClass >= NUM_CLASSES) throw new Error(`Invalid defender class: ${defClass}`);

  if (atkClass === defClass) return CLASS_NEUTRAL_MULT;

  const diff = (defClass + NUM_CLASSES - atkClass) % NUM_CLASSES;
  if (diff >= 1 && diff <= 4) return CLASS_ADV_MULT;
  if (diff === 5) return CLASS_NEUTRAL_MULT;
  return CLASS_DISADV_MULT;
}

/**
 * Calculate attack move damage.
 *
 * damage = 100 × min(Atk/Armor, 2.2) × classMult × critMult × vrfRoll / (1000^4)
 */
export function calculateAttackDamage(
  atk: bigint,
  armor: bigint,
  classMult: bigint,
  isCrit: boolean,
  vrfRoll: bigint,
): bigint {
  const ratio = cappedRatio(atk, armor);
  const critMult = isCrit ? CRIT_MULT : MULT_DENOM;
  const denom = MULT_DENOM * MULT_DENOM * MULT_DENOM * MULT_DENOM;

  return (ATTACK_BASE_POWER * ratio * classMult * critMult * vrfRoll) / denom;
}

/**
 * Calculate defend counter damage (no crit possible).
 *
 * counter = 30 × min(Atk/Armor, 2.2) × classMult × vrfRoll / (1000^3)
 */
export function calculateDefendCounter(
  atk: bigint,
  armor: bigint,
  classMult: bigint,
  vrfRoll: bigint,
): bigint {
  const ratio = cappedRatio(atk, armor);
  const denom = MULT_DENOM * MULT_DENOM * MULT_DENOM;

  return (DEFEND_COUNTER_BASE * ratio * classMult * vrfRoll) / denom;
}

/**
 * Calculate special move damage.
 *
 * damage = basePower × min(Atk/Armor, 2.2) × classMult × purityMult × vrfRoll / (1000^4)
 */
export function calculateSpecialDamage(
  basePower: bigint,
  atk: bigint,
  armor: bigint,
  classMult: bigint,
  purity: number,
  vrfRoll: bigint,
): bigint {
  const ratio = cappedRatio(atk, armor);
  const purityMult = MULT_DENOM + BigInt(purity) * PURITY_POTENCY_PER;
  const denom = MULT_DENOM * MULT_DENOM * MULT_DENOM * MULT_DENOM;

  return (basePower * ratio * classMult * purityMult * vrfRoll) / denom;
}

/**
 * Returns the critical hit chance in BPS (×10000).
 *
 * critChance = critStat × 10000 / (critStat + 200)
 */
export function critChance(critStat: bigint): bigint {
  return (critStat * 10_000n) / (critStat + CRIT_DENOM);
}

/**
 * Returns the enhanced Special proc chance in BPS (×10000).
 *
 * enhancedChance = min(500 + purity × 500, 10000) in BPS.
 *
 * R-06 parity with BattleResolver.sol: the raw formula exceeds 10000 BPS at purity > 19,
 * which would break the "BPS is a probability" contract (proc becomes unconditional).
 * Capped here to match Solidity.
 */
export function enhancedProcChance(purity: number): bigint {
  const raw = PURITY_ENHANCED_BASE_BPS + BigInt(purity) * PURITY_ENHANCED_PER_BPS;
  return raw > 10_000n ? 10_000n : raw;
}
