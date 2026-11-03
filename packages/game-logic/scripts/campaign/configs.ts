/**
 * Named rule packages for the strong-play balance campaign (2026-11-02). A config is a Partial<BattleRules> on top
 * of DEFAULT_RULES; the optional campaign instruments (statMult, focusOnWait, stunImmunityTurns, maxTurns,
 * damageRamp) are absent in today's game. `bun scripts/strong-balance.ts --config a,b` runs them.
 */
import type { v3 } from '../../src/index';
import { LobsterClass as C } from '../../src/types';

export const CONFIGS: Record<string, Partial<v3.BattleRules>> = {
  baseline: {},
  focus40: { focusOnWait: { bonusBps: 4000n, bonusCharge: 1 } },
  focus50: { focusOnWait: { bonusBps: 5000n, bonusCharge: 1 } },

  // ── Round 2: one lever at a time (round 1: Mantis / Kraken / Specter over; Leviathan / Ember / Bulwark /
  //    Sentinel / Reaver under; 10–25 % of strong battles reach the 100-turn cap as slow grinds) ──
  // Kraken: 3.1 stuns a battle, survives 60 %.
  'kraken-immunity3': { stunImmunityTurns: 3 },
  'kraken-speed-10': { statMult: { [C.Kraken]: { speed: 900n } } },
  'kraken-hp-10': { statMult: { [C.Kraken]: { hp: 900n } } },
  // Mantis: fastest (Speed 130), crits most; wins 67 % while surviving 23 % — tempo.
  'mantis-speed-8': { statMult: { [C.Mantis]: { speed: 920n } } },
  'mantis-crit-25': { statMult: { [C.Mantis]: { critical: 750n } } },
  // Specter: takes the least damage (spectral dodge 30 % on the first hit each window) and pokes from range 4.
  'specter-dodge20': { firstHitReduction: { [C.Specter]: 200n } },
  'specter-dodge10': { firstHitReduction: { [C.Specter]: 100n } },
  // Leviathan: slowest, 1-hex move, takes the most damage.
  'levi-move2': { moveRange: { [C.Leviathan]: 2 } },
  'levi-speed+15': { statMult: { [C.Leviathan]: { speed: 1150n } } },
  'levi-hp+15': { statMult: { [C.Leviathan]: { hp: 1150n } } },
  // Ember: 4.8 turns and survives 6 % — dies before it acts.
  'ember-hp+20': { statMult: { [C.Ember]: { hp: 1200n } } },
  'ember-armor+25': { statMult: { [C.Ember]: { armor: 1250n } } },
  // Bulwark: low damage.
  'bulwark-atk+15': { statMult: { [C.Bulwark]: { attack: 1150n } } },
  'bulwark-hp+10': { statMult: { [C.Bulwark]: { hp: 1100n } } },
  // Sentinel: lowest damage, the healer.
  'sentinel-rally30': { rallyHealPct: 300n },
  'sentinel-atk+15': { statMult: { [C.Sentinel]: { attack: 1150n } } },
  // Reaver.
  'reaver-bleed65': { rendBleedPerTurn: 65n },
  'reaver-hp+10': { statMult: { [C.Reaver]: { hp: 1100n } } },
  // Pacing: capped battles are grinds (damage until the last turn, leader ~32 HP points ahead), not standoffs.
  'cap80': { maxTurns: 80 },
  'ramp50x2': { damageRamp: { fromTurn: 50, bpsPerTurn: 200n } },
  'ramp40x3': { damageRamp: { fromTurn: 40, bpsPerTurn: 300n } },
  // ── Round 2b: Mantis did not move with Speed or Crit — its edge is elsewhere ──
  'mantis-ambush120': { specialPower: { [C.Mantis]: 120n } },
  'mantis-move2': { moveRange: { [C.Mantis]: 2 } },
  'mantis-hp-10': { statMult: { [C.Mantis]: { hp: 900n } } },
  // ── Packages: the round-2 levers that moved their class ≥ 6 points, plus the ramp that fixes pacing ──
  pkgA: {
    statMult: { [C.Kraken]: { speed: 900n }, [C.Leviathan]: { speed: 1150n }, [C.Ember]: { hp: 1200n }, [C.Bulwark]: { attack: 1150n }, [C.Sentinel]: { attack: 1150n } },
    firstHitReduction: { [C.Specter]: 100n },
    damageRamp: { fromTurn: 40, bpsPerTurn: 300n },
  },
  pkgB: {   // milder on the strong classes
    statMult: { [C.Kraken]: { speed: 920n }, [C.Leviathan]: { speed: 1100n, hp: 1100n }, [C.Ember]: { hp: 1150n }, [C.Bulwark]: { attack: 1100n }, [C.Sentinel]: { attack: 1100n } },
    firstHitReduction: { [C.Specter]: 200n },
    damageRamp: { fromTurn: 40, bpsPerTurn: 300n },
  },
};
// Round 3 variants on pkgB (the round-2 winner): Focus, and an earlier ramp for battle length.
CONFIGS.pkgB_focus40 = { ...CONFIGS.pkgB, focusOnWait: { bonusBps: 4000n, bonusCharge: 1 } };
CONFIGS.pkgB_focus50 = { ...CONFIGS.pkgB, focusOnWait: { bonusBps: 5000n, bonusCharge: 1 } };
CONFIGS.pkgB_ramp30 = { ...CONFIGS.pkgB, damageRamp: { fromTurn: 30, bpsPerTurn: 300n } };

// Round 4 (pkgB confirmed at Elite; Apex Kraken 59.7 / Ember 43.7 and Evolved Sentinel 42.8 still out; under the
// weaker pilots Leviathan overshoots ~59 and Mantis undershoots ~39): Leviathan Speed only (drop its HP), Kraken
// and Ember a step further, Sentinel a step further, Mantis keeps a little more.
CONFIGS.pkgC = {
  statMult: { [C.Kraken]: { speed: 900n }, [C.Leviathan]: { speed: 1100n }, [C.Ember]: { hp: 1200n }, [C.Bulwark]: { attack: 1100n }, [C.Sentinel]: { attack: 1150n } },
  firstHitReduction: { [C.Specter]: 200n },
  damageRamp: { fromTurn: 40, bpsPerTurn: 300n },
};

/** Round-2 single levers, in report order. */
export const ROUND2 = Object.keys(CONFIGS).filter((k) => !['baseline', 'focus40', 'focus50'].includes(k) && !k.startsWith('pkg') && !k.startsWith('mantis-ambush') && k !== 'mantis-move2' && k !== 'mantis-hp-10');
