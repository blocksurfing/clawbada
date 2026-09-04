/**
 * V3 S1 Power Matchmaking — pure helpers.
 *
 * Shared between the API matchmaker and the frontend Team Builder so a player
 * can preview their power score before queueing without round-tripping the API.
 *
 * Design (locked in `~/.claude/projects/-Users-alepore-Clawbada/memory/project_battle_v2_redesign.md`):
 *  - Power score = sum of EvolutionTier weights across the 3 lobsters on a team.
 *    Evolved=1, Elite=2, Apex=3. Possible scores: 3..9 (Base=0 lobsters can't enter battle).
 *  - Sub-pools keyed by (stakeBracket, powerScore). Up to 7 powers × 3 stakes = 21 buckets.
 *  - Adaptive radius expansion as a pure function of elapsed time:
 *      0–30 s    → exact power
 *      30–60 s   → ±1 power
 *      60–120 s  → ±2 power
 *      120 s+    → all powers within stake bracket
 */

import { EvolutionTier } from './types';

// ──────────── Constants ────────────

/** Minimum power score for a battle-eligible team (3 × Evolved). */
export const MIN_TEAM_POWER = 3;

/** Maximum power score for a battle-eligible team (3 × Apex). */
export const MAX_TEAM_POWER = 9;

/** Stake bracket index → power-bucket separator. Stake brackets are uint256[3] in the contract. */
export const NUM_STAKE_BRACKETS = 3;

/** Adaptive radius expansion thresholds. Each entry: `[elapsedSec, halfWidth]`.
 *  At elapsedSec t, the matcher accepts opponents within ±halfWidth of the player's power.
 *  Sentinel halfWidth `Infinity` = "any power within stake bracket". */
export const RADIUS_THRESHOLDS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [30, 1],
  [60, 2],
  [120, Infinity],
] as const;

// ──────────── Types ────────────

/** A team's tier-derived weight contribution. Not exported because consumers
 *  should use `computeTeamPower(tiers)` rather than build per-lobster weights. */
type TierWeight = 1 | 2 | 3;

/** Bucket key for (stake, power) sub-pool. Used as a shard key in matchmaker
 *  storage and would be the natural partition if we ever shard horizontally. */
export interface PoolKey {
  /** Stake bracket index, 0=Low / 1=Mid / 2=High. */
  stakeBracket: number;
  /** Team Power score, 3..9. */
  powerScore: number;
}

/** Match-radius descriptor returned by `getCurrentRadius`. Inclusive on both ends. */
export interface PowerRadius {
  /** Lowest acceptable opponent power. */
  low: number;
  /** Highest acceptable opponent power. */
  high: number;
  /** Internal radius half-width applied (Infinity for full bracket). */
  halfWidth: number;
}

// ──────────── Pure functions ────────────

/** Convert an EvolutionTier value to its matchmaking weight. Throws on Base
 *  (Base lobsters cannot enter battle — caller bug if we see one here). */
function tierWeight(tier: EvolutionTier): TierWeight {
  switch (tier) {
    case EvolutionTier.Evolved: return 1;
    case EvolutionTier.Elite: return 2;
    case EvolutionTier.Apex: return 3;
    case EvolutionTier.Base:
      throw new Error('Base-tier lobster cannot enter battle (V3 entry rule)');
    default:
      throw new Error(`Unknown EvolutionTier: ${tier}`);
  }
}

/** Compute the Team Power score for a team given each lobster's tier.
 *  Caller must pass exactly 3 tiers. */
export function computeTeamPower(tiers: readonly EvolutionTier[]): number {
  if (tiers.length !== 3) {
    throw new Error(`Team must have exactly 3 lobsters, got ${tiers.length}`);
  }
  let power = 0;
  for (const t of tiers) power += tierWeight(t);
  return power;
}

/** Validate that a stake-bracket index is in range. */
export function assertValidStakeBracket(idx: number): void {
  if (!Number.isInteger(idx) || idx < 0 || idx >= NUM_STAKE_BRACKETS) {
    throw new Error(`Invalid stake bracket index: ${idx} (expected 0..${NUM_STAKE_BRACKETS - 1})`);
  }
}

/** Validate that a power score is in range. */
export function assertValidPower(power: number): void {
  if (!Number.isInteger(power) || power < MIN_TEAM_POWER || power > MAX_TEAM_POWER) {
    throw new Error(`Invalid team power: ${power} (expected ${MIN_TEAM_POWER}..${MAX_TEAM_POWER})`);
  }
}

/** Build a PoolKey, validating both fields. */
export function makePoolKey(stakeBracket: number, powerScore: number): PoolKey {
  assertValidStakeBracket(stakeBracket);
  assertValidPower(powerScore);
  return { stakeBracket, powerScore };
}

/** Stable string representation of a PoolKey for use as a Map/Redis key.
 *  Format: `s{stake}:p{power}` — easy to grep, parses easily. */
export function poolKeyString(key: PoolKey): string {
  return `s${key.stakeBracket}:p${key.powerScore}`;
}

/** Compute the active match radius for a player at `elapsedSec` queued-time.
 *  Returns the inclusive [low, high] power range. `low`/`high` are clamped to
 *  [MIN_TEAM_POWER, MAX_TEAM_POWER]. */
export function getCurrentRadius(playerPower: number, elapsedSec: number): PowerRadius {
  assertValidPower(playerPower);
  if (elapsedSec < 0) elapsedSec = 0;

  // Find the largest threshold whose elapsed-cutoff is <= elapsedSec.
  let halfWidth = 0;
  for (const [cutoff, hw] of RADIUS_THRESHOLDS) {
    if (elapsedSec >= cutoff) halfWidth = hw;
  }

  let low: number;
  let high: number;
  if (halfWidth === Infinity) {
    // "Any power within stake bracket" — the bracket boundary is enforced by the
    // matchmaker (we still only consider candidates in the same stakeBracket).
    low = MIN_TEAM_POWER;
    high = MAX_TEAM_POWER;
  } else {
    low = Math.max(MIN_TEAM_POWER, playerPower - halfWidth);
    high = Math.min(MAX_TEAM_POWER, playerPower + halfWidth);
  }

  return { low, high, halfWidth };
}

/** Categorical comparison label between two team powers — drives the HUD
 *  match-reveal chrome (green/yellow/orange/grey). */
export type PowerMatchSeverity = 'even' | 'slight-disadvantage' | 'significant-disadvantage' | 'advantage';

/** Classify the matchup from `viewerPower`'s perspective. */
export function powerMatchSeverity(viewerPower: number, opponentPower: number): PowerMatchSeverity {
  const delta = opponentPower - viewerPower;
  if (delta === 0) return 'even';
  if (delta < 0) return 'advantage';            // opponent is weaker
  if (delta === 1) return 'slight-disadvantage';
  return 'significant-disadvantage';            // delta >= 2
}
