/**
 * V3 ATB battle constants. Source of truth: docs/gitbook/battle.md and
 * .claude/CLAUDE.md § Battle Mode (ATB initiative bar). Damage/crit/class/VRF
 * constants are shared with the resolver in ../constants.ts.
 */
import { LobsterClass } from '../types';

// ──────────── Board ────────────
export const BOARD_COLS = 6;
export const BOARD_ROWS = 5;
/** ~20% of 30 hexes blocked → ~24 playable (gitbook). Designer layouts use 4–5. */
export const DEFAULT_BLOCKED_MIN = 5;
export const DEFAULT_BLOCKED_MAX = 6;

// ──────────── ATB ────────────
/** Tick resolution: next = prev + TICK_SCALE / effectiveSpeed (integer math). */
export const TICK_SCALE = 1_000_000n;
/** Effective Speed clamp as ×1000 of base. */
export const SPEED_CLAMP_MIN = 500n;
export const SPEED_CLAMP_MAX = 1500n;
/** Turns of the affected lobster that are stun-immune after a stun expires. */
export const STUN_IMMUNITY_TURNS = 2;
/** Griefer cutoff — HP% tiebreak once reached. */
export const MAX_TURNS = 100;
/** Upcoming-turn preview length shown on the HUD bar. */
export const BAR_PREVIEW_LENGTH = 8;

// ──────────── Turn economy ────────────
export const CHARGE_PER_TURN = 1;
export const DEFEND_BONUS_CHARGE = 1;
export const CHARGE_CAP = 3;
export const SPECIAL_COST = 3;

// ──────────── Ranges ────────────
export const ATTACK_MAX_RANGE = 3;
/** Attack damage multiplier by hex distance (×1000). 4+ = out of range. */
export const DISTANCE_MULT: Readonly<Record<number, bigint>> = { 1: 1000n, 2: 750n, 3: 500n };

/** Movement range per class (hexes per turn). */
export const MOVE_RANGE: Readonly<Record<LobsterClass, number>> = {
  [LobsterClass.Bulwark]: 1,
  [LobsterClass.Leviathan]: 1,
  [LobsterClass.Sentinel]: 2,
  [LobsterClass.Abyss]: 2,
  [LobsterClass.Kraken]: 2,
  [LobsterClass.Reaver]: 2,
  [LobsterClass.Mantis]: 3,
  [LobsterClass.Tempest]: 3,
  [LobsterClass.Specter]: 3,
  [LobsterClass.Ember]: 3,
};

/**
 * Special range per class (hex distance to target; 0 = self/any for team-wide).
 * Maelstrom is a radius around the caster; Rally targets an ally (self allowed).
 */
export const SPECIAL_RANGE: Readonly<Record<LobsterClass, number>> = {
  [LobsterClass.Bulwark]: 0, // Fortify — team-wide, no target
  [LobsterClass.Mantis]: 1, // Ambush — adjacent
  [LobsterClass.Leviathan]: 1, // Crush — adjacent
  [LobsterClass.Tempest]: 3, // Maelstrom — 3-hex radius AoE
  [LobsterClass.Specter]: 3, // Haunt
  [LobsterClass.Sentinel]: 2, // Rally — ally within 2
  [LobsterClass.Reaver]: 1, // Rend — adjacent
  [LobsterClass.Abyss]: 1, // Devour — adjacent
  [LobsterClass.Kraken]: 2, // Bind
  [LobsterClass.Ember]: 4, // Inferno
};

// ──────────── Special effect tuning (durations in turns of the affected lobster) ────────────
export const FORTIFY_REDUCTION = 400n; // -40% incoming (×1000)
export const FORTIFY_TURNS = 2;
export const FORTIFY_REFLECT_BASE = 0n; // spec: no reflect unless enhanced (×1000)
export const FORTIFY_ENHANCED_REFLECT = 200n; // 20% of blocked damage reflected (×1000)
export const HAUNT_REDUCTION = 200n; // -20% Atk/Armor (×1000)
export const HAUNT_ENHANCED_REDUCTION = 300n;
export const HAUNT_TURNS = 4;
export const HAUNT_ENHANCED_TURNS = 6;
export const RALLY_HEAL_PCT = 250n; // 25% of max HP (×1000) — 30%→25% (2026-08-31: Sentinel pub-stomp fix; marginal at top play)
/** Damage multiplier for attacks at distance 4+ when a class's range allows it. */
export const DISTANCE_MULT_LONG = 400n;
// ── Specter kit (2026-08-31, user-approved; confirmed by full-sampling meta run) ──
/** Specter's unique long poke: attack range 4 (at DISTANCE_MULT_LONG damage). */
export const SPECTER_ATTACK_RANGE = 4;
/** Spectral dodge: the first direct hit Specter takes each turn window is reduced (×1000). */
export const SPECTER_FIRST_HIT_REDUCTION = 300n;
export const RALLY_SHIELD_REDUCTION = 300n; // enhanced: -30% incoming for 1 turn
export const RALLY_SHIELD_TURNS = 1;
export const REND_BLEED_PER_TURN = 55n; // 40→55 (2026-08-30 weak-Specials sweep); total = 70 hit + 6×55 bleed
export const REND_TURNS = 6;
export const MAELSTROM_SLOW = 200n; // enhanced: -20% speed (×1000)
export const MAELSTROM_SLOW_TURNS = 2;
export const BIND_STUN_TURNS = 1;
export const INFERNO_SELF_DAMAGE = 250n; // 25% of damage dealt (×1000)
export const INFERNO_SELF_DAMAGE_ENHANCED = 150n;
export const MANTIS_ARMOR_PIERCE = 500n; // ignores 50% armor (×1000)
export const CRUSH_ENHANCED_BONUS = 1500n; // ×1.5 when target < 50% HP
