/**
 * Random practice rosters (`random_<tier>` presets): three distinct classes drawn from all
 * ten, each with real random genetics (randomDNA) so Unity rigs and HUD portraits composite
 * mixed-class body parts and purity follows from the DNA.
 */
import { v3, EvolutionTier, LobsterClass, randomDNA, calculatePurity } from '@clawbada/game-logic';

export const RANDOM_PRESET_RE = /^random_(evolved|elite|apex)$/;
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
