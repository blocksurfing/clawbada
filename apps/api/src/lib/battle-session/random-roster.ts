/**
 * Rolled practice rosters. `random_<tier>` draws three distinct classes from all ten;
 * `trio_<class>` fields three of one class; `specials` fields one of each class whose Special
 * VFX is finished. All three use real random genetics (randomDNA), so Unity rigs and HUD
 * portraits composite mixed-class body parts.
 */
import { v3, EvolutionTier, LobsterClass, randomDNA, calculatePurity } from '@clawbada/game-logic';

export const RANDOM_PRESET_RE = /^random_(evolved|elite|apex)$/;
/**
 * Classes whose Special VFX are finished and bound in the battle engine — Tempest Maelstrom,
 * Specter Haunt, Ember Inferno. Append a class here as its drop lands; the `specials` preset
 * and the picker entry follow automatically.
 */
export const VFX_READY_CLASSES = ['bulwark', 'tempest', 'specter'] as const;
/** `specials[_<tier>]`: one lobster of each VFX-ready class — every finished Special in one battle. */
export const SPECIALS_PRESET_RE = /^specials(?:_(evolved|elite|apex))?$/;
/** `trio_<class>[_<tier>]`: three lobsters of one class (default Elite) — for exercising one Special on demand. */
export const TRIO_PRESET_RE = /^trio_(bulwark|mantis|leviathan|tempest|specter|sentinel|reaver|abyss|kraken|ember)(?:_(evolved|elite|apex))?$/;
const CLASS_BY_NAME: Record<string, LobsterClass> = {
  bulwark: LobsterClass.Bulwark, mantis: LobsterClass.Mantis, leviathan: LobsterClass.Leviathan, tempest: LobsterClass.Tempest, specter: LobsterClass.Specter,
  sentinel: LobsterClass.Sentinel, reaver: LobsterClass.Reaver, abyss: LobsterClass.Abyss, kraken: LobsterClass.Kraken, ember: LobsterClass.Ember,
};

/**
 * One lobster of each VFX-ready class (Ember, Tempest, Specter) with random genetics and
 * purity 3, so a single practice battle shows every Special whose art is finished. Mirrored
 * by default, so both sides cast them.
 */
export function rollSpecialsRoster(tierName = 'elite', rng: () => number = Math.random): RandomRoster {
  const tier = RANDOM_TIERS[tierName];
  if (tier === undefined) throw new Error(`unknown specials tier ${tierName}`);
  const classes = VFX_READY_CLASSES.map((name) => CLASS_BY_NAME[name]);
  const dna = classes.map((c) => randomDNA(c, rng));
  return { tier, classes, purity: dna.map(() => 3), partClassIds: dna.map((d) => v3.partClassIds(d)), dna };
}

/** Three of one class with random genetics; purity is forced to 3 so the Special is a typical bred one. */
export function rollTrioRoster(className: string, tierName = 'elite', rng: () => number = Math.random): RandomRoster {
  const cls = CLASS_BY_NAME[className];
  const tier = RANDOM_TIERS[tierName];
  if (cls === undefined || tier === undefined) throw new Error(`unknown trio preset ${className}/${tierName}`);
  const classes = [cls, cls, cls];
  const dna = classes.map((c) => randomDNA(c, rng));
  return { tier, classes, purity: dna.map(() => 3), partClassIds: dna.map((d) => v3.partClassIds(d)), dna };
}
const RANDOM_TIERS: Record<string, EvolutionTier> = { evolved: EvolutionTier.Evolved, elite: EvolutionTier.Elite, apex: EvolutionTier.Apex };
const ALL_CLASSES: LobsterClass[] = Object.values(LobsterClass).filter((v): v is LobsterClass => typeof v === 'number');

export interface RandomRoster {
  tier: EvolutionTier;
  classes: LobsterClass[];
  purity: number[];
  partClassIds: number[][];
  dna: bigint[];
}

export function rollRandomRoster(tierName: string, rng: () => number = Math.random): RandomRoster {
  const tier = RANDOM_TIERS[tierName];
  if (tier === undefined) throw new Error(`unknown random tier ${tierName}`);
  const pool = [...ALL_CLASSES];
  const classes: LobsterClass[] = [];
  while (classes.length < 3 && pool.length) classes.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  const dna = classes.map((cls) => randomDNA(cls, rng));
  const purity = dna.map((d) => calculatePurity(d));
  const partClassIds = dna.map((d) => v3.partClassIds(d));
  return { tier, classes, purity, partClassIds, dna };
}
