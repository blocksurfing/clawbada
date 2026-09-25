/**
 * Rolled practice rosters. `random_<tier>` draws three distinct classes from all ten;
 * `trio_<class>` fields three of one class; `team_<class>_<class>_<class>` fields a named
 * composition; `specials` fields one of each class whose Special VFX is finished. All use
 * real random genetics (randomDNA), so Unity rigs and HUD portraits composite mixed-class
 * body parts.
 */
import { v3, EvolutionTier, LobsterClass, randomDNA, randomDNAWithPurity, calculatePurity } from '@clawbada/game-logic';

/**
 * Purity when a caller does not ask for one. 3 of 6 is a typical BRED lobster, so a Special
 * reads the way it does in a real battle rather than at its ceiling. The dojo asks for 6.
 */
export const DEFAULT_PRACTICE_PURITY = 3;

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
/** `team_<class>_<class>_<class>[_<tier>]`: a named three-class composition (default Elite) — the fixed teams the picker offers, e.g. `team_kraken_ember_abyss_apex`. */
export const TEAM_PRESET_RE = /^team_(bulwark|mantis|leviathan|tempest|specter|sentinel|reaver|abyss|kraken|ember)_(bulwark|mantis|leviathan|tempest|specter|sentinel|reaver|abyss|kraken|ember)_(bulwark|mantis|leviathan|tempest|specter|sentinel|reaver|abyss|kraken|ember)(?:_(evolved|elite|apex))?$/;
const CLASS_BY_NAME: Record<string, LobsterClass> = {
  bulwark: LobsterClass.Bulwark, mantis: LobsterClass.Mantis, leviathan: LobsterClass.Leviathan, tempest: LobsterClass.Tempest, specter: LobsterClass.Specter,
  sentinel: LobsterClass.Sentinel, reaver: LobsterClass.Reaver, abyss: LobsterClass.Abyss, kraken: LobsterClass.Kraken, ember: LobsterClass.Ember,
};

/**
 * One lobster of each VFX-ready class (Ember, Tempest, Specter) with random genetics and
 * purity 3, so a single practice battle shows every Special whose art is finished. Mirrored
 * by default, so both sides cast them.
 */
export function rollSpecialsRoster(tierName = 'elite', rng: () => number = Math.random, purity = DEFAULT_PRACTICE_PURITY): RandomRoster {
  const tier = RANDOM_TIERS[tierName];
  if (tier === undefined) throw new Error(`unknown specials tier ${tierName}`);
  const classes = VFX_READY_CLASSES.map((name) => CLASS_BY_NAME[name]);
  return rosterOf(classes, tier, purity, rng);
}

/** Three of one class with random genetics at the requested purity (default 3, a typical bred lobster). */
export function rollTrioRoster(className: string, tierName = 'elite', rng: () => number = Math.random, purity = DEFAULT_PRACTICE_PURITY): RandomRoster {
  const cls = CLASS_BY_NAME[className];
  const tier = RANDOM_TIERS[tierName];
  if (cls === undefined || tier === undefined) throw new Error(`unknown trio preset ${className}/${tierName}`);
  return rosterOf([cls, cls, cls], tier, purity, rng);
}
/** A named three-class composition with random genetics at the requested purity (default 3, like the trio). */
export function rollTeamRoster(classNames: readonly string[], tierName = 'elite', rng: () => number = Math.random, purity = DEFAULT_PRACTICE_PURITY): RandomRoster {
  const tier = RANDOM_TIERS[tierName];
  const classes = classNames.map((n) => CLASS_BY_NAME[n]);
  if (classes.length !== 3 || classes.some((c) => c === undefined) || tier === undefined) throw new Error(`unknown team preset ${classNames.join('/')}/${tierName}`);
  return rosterOf(classes, tier, purity, rng);
}

/**
 * A roster whose genes really carry the requested purity, rather than random genes with a
 * purity number stapled on. That was the old behaviour and it made "Pure" unreachable: the
 * number said 3 while the body parts said whatever the draw gave, so a pure lobster never
 * looked pure on the board.
 */
function rosterOf(classes: LobsterClass[], tier: EvolutionTier, purity: number, rng: () => number): RandomRoster {
  const dna = classes.map((c) => randomDNAWithPurity(c, purity, rng));
  return { tier, classes, purity: dna.map((d) => calculatePurity(d)), partClassIds: dna.map((d) => v3.partClassIds(d)), dna };
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

/** Three distinct random classes. Purity is whatever the draw gives unless the caller asks for one. */
export function rollRandomRoster(tierName: string, rng: () => number = Math.random, purity?: number): RandomRoster {
  const tier = RANDOM_TIERS[tierName];
  if (tier === undefined) throw new Error(`unknown random tier ${tierName}`);
  const pool = [...ALL_CLASSES];
  const classes: LobsterClass[] = [];
  while (classes.length < 3 && pool.length) classes.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  if (purity !== undefined) return rosterOf(classes, tier, purity, rng);
  const dna = classes.map((cls) => randomDNA(cls, rng));
  return { tier, classes, purity: dna.map((d) => calculatePurity(d)), partClassIds: dna.map((d) => v3.partClassIds(d)), dna };
}
