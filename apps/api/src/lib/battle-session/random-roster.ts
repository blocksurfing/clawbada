/**
 * Random practice rosters (`random_<tier>` presets): three distinct classes drawn from all
 * ten, each with real random genetics (randomDNA) so Unity rigs and HUD portraits composite
 * mixed-class body parts and purity follows from the DNA.
 */
import { v3, EvolutionTier, LobsterClass, randomDNA, calculatePurity } from '@clawbada/game-logic';

export const RANDOM_PRESET_RE = /^random_(evolved|elite|apex)$/;
/** `trio_<class>[_<tier>]`: three lobsters of one class (default Elite) — for exercising one Special on demand. */
export const TRIO_PRESET_RE = /^trio_(bulwark|mantis|leviathan|tempest|specter|sentinel|reaver|abyss|kraken|ember)(?:_(evolved|elite|apex))?$/;
const CLASS_BY_NAME: Record<string, LobsterClass> = {
  bulwark: LobsterClass.Bulwark, mantis: LobsterClass.Mantis, leviathan: LobsterClass.Leviathan, tempest: LobsterClass.Tempest, specter: LobsterClass.Specter,
  sentinel: LobsterClass.Sentinel, reaver: LobsterClass.Reaver, abyss: LobsterClass.Abyss, kraken: LobsterClass.Kraken, ember: LobsterClass.Ember,
};

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
