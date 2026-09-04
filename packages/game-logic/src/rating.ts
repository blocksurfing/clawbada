/**
 * Battle-rank rating + weekly boost ladder — pure functions (S1, locked 2026-09-02).
 *
 * This is the single source of truth the server (rating updates, weekly epoch job) and
 * the API (ladder previews) share. Nothing here touches a database or the chain.
 *
 * Decisions encoded (user-approved 2026-09-02/03 — do not tune silently, announce a week
 * ahead when you do):
 *  - Rating is TEAM-keyed (teamId), starts at RATING_BASELINE, moves by the standard
 *    K=32 ELO step in `./elo`.
 *  - Ladder = ONE global list of all qualified teams (not per Power bucket, not per stake
 *    bracket): population-proof, and a lone team in an odd Power bucket cannot be "top"
 *    by default.
 *  - Boost = smooth linear +10% → +50% in closed-interval percentile (`pctlOf` from
 *    `./v3/boost`): bottom of the qualified ladder earns minBps, top earns maxBps.
 *  - Qualification = battles PLAYED per weekly epoch (never won); floor ramps 7 → 14.
 *  - Lapse → boost 0 next epoch; rating persists with IDLE_DECAY_PER_EPOCH toward baseline
 *    (15%: a month away costs ~half the climb; a returning strong team stays near its band
 *    and does not farm weaker opponents on the way back).
 *  - Roster binding: same-tier lobster swap → rating regresses 1/3 toward baseline per
 *    lobster swapped (disband + recreate is the only "swap" on chain, so lineage is
 *    resolved by lobster overlap); Team Power change → full re-qualification.
 */

import { calculateNewElo } from './elo';
import { boostBpsAt, pctlOf, type BoostSchedule } from './v3/boost';

// ──────────── Constants (tunable, announce changes a week ahead) ────────────

/** Starting rating and the anchor every decay rule regresses toward. */
export const RATING_BASELINE = 1200;
/** Standard ELO step; identical to `./elo`'s K_FACTOR. */
export const RATING_K_FACTOR = 32;
/** Fraction of the gap to baseline removed per NON-qualifying epoch. */
export const IDLE_DECAY_PER_EPOCH = 0.15;
/** Fraction of the gap to baseline removed per lobster that differs from the parent roster. */
export const SWAP_REGRESSION_PER_LOBSTER = 1 / 3;

/** Weekly epochs on a fixed grid anchored at the season-1 start. */
export const BOOST_EPOCH_SECONDS = 7 * 24 * 60 * 60;
export const BOOST_EPOCH_MS = BOOST_EPOCH_SECONDS * 1000;

/** The locked S1 schedule: +10% at percentile 0 → +50% at percentile 1. */
export const BOOST_SCHEDULE: BoostSchedule = { kind: 'smooth', minBps: 1_000, maxBps: 5_000 };
export const BOOST_MIN_BPS = 1_000;
/** Mirrors MiningPool.MAX_BOOST_BPS — the contract rejects anything above this. */
export const BOOST_MAX_BPS = 5_000;
/** Mirrors MiningPool.MAX_BOOST_BATCH — rows per setTeamBoosts tx. */
export const BOOST_ENTRIES_PER_TX = 200;
/** Mirrors MiningPool.BOOST_EPOCH_TTL — the server alarms well before this. */
export const BOOST_EPOCH_TTL_SECONDS = 10 * 24 * 60 * 60;

/** Below this many qualified teams, everyone gets BOOST_MIN_BPS instead of a percentile
 *  spread. 1 = spec behaviour (a lone qualified team is "top" and earns +50%); raise it
 *  post-launch if the thin-ladder edge proves gameable. */
export const BOOST_MIN_LADDER_SIZE = 1;

/** Qualification floor by epoch: 7 battles/week at launch, 14 once ELO bands are liquid.
 *  `fromEpoch` is the first window index the floor applies to. The weekly job persists
 *  the floor per epoch row and NEVER rewrites an existing row, so ops can override the
 *  schedule for a specific week by editing that row a week ahead. */
export interface FloorStep {
  fromEpoch: number;
  floorPlayed: number;
}
export const BOOST_FLOOR_SCHEDULE: readonly FloorStep[] = [
  { fromEpoch: 0, floorPlayed: 7 },
  { fromEpoch: 4, floorPlayed: 14 },
] as const;

// ──────────── Rating arithmetic ────────────

/** Move `rating` a `fraction` of the way toward `baseline` (rounded to the nearest point).
 *  fraction 0 → unchanged; 1 → baseline. Works from above and below baseline. */
export function regressTowardBaseline(rating: number, fraction: number, baseline = RATING_BASELINE): number {
  if (!(fraction >= 0 && fraction <= 1)) throw new Error(`fraction must be in [0,1], got ${fraction}`);
  return Math.round(rating + (baseline - rating) * fraction);
}

/** One non-qualifying epoch of decay. */
export function idleDecay(rating: number): number {
  return regressTowardBaseline(rating, IDLE_DECAY_PER_EPOCH);
}

/** Standard K=32 result. Re-exported here so rating consumers import one module. */
export function eloUpdate(winnerRating: number, loserRating: number): { winner: number; loser: number } {
  const { newWinnerElo, newLoserElo } = calculateNewElo(winnerRating, loserRating);
  return { winner: newWinnerElo, loser: newLoserElo };
}

// ──────────── Roster lineage ────────────

export interface LineageParent {
  rating: number;
  power: number;
  /** Battles the parent had played in `epochId`. */
  gamesPlayedEpoch: number;
  epochId: number;
}

export type LineageReason = 'fresh' | 'inherited' | 'power_changed';

export interface LineageDecision {
  rating: number;
  gamesPlayedEpoch: number;
  reason: LineageReason;
}

/** Decide a newly created team's starting state from the disbanded team it descends from.
 *  - no parent or no shared lobster → fresh (baseline, 0 played)
 *  - parent Power ≠ child Power → full re-qualification (baseline, 0 played)
 *  - otherwise regress SWAP_REGRESSION_PER_LOBSTER per non-shared lobster; the played
 *    count carries over only if the parent's counter refers to the current epoch. */
export function lineageDecision(input: {
  parent: LineageParent | null;
  shared: number;
  childPower: number;
  currentEpochId: number;
}): LineageDecision {
  const { parent, shared, childPower, currentEpochId } = input;
  if (!Number.isInteger(shared) || shared < 0 || shared > 3) {
    throw new Error(`shared lobster count must be 0..3, got ${shared}`);
  }
  if (parent === null || shared === 0) {
    return { rating: RATING_BASELINE, gamesPlayedEpoch: 0, reason: 'fresh' };
  }
  if (parent.power !== childPower) {
    return { rating: RATING_BASELINE, gamesPlayedEpoch: 0, reason: 'power_changed' };
  }
  const swapped = 3 - shared;
  const fraction = Math.min(1, swapped * SWAP_REGRESSION_PER_LOBSTER);
  return {
    rating: regressTowardBaseline(parent.rating, fraction),
    gamesPlayedEpoch: parent.epochId === currentEpochId ? parent.gamesPlayedEpoch : 0,
    reason: 'inherited',
  };
}

// ──────────── Epoch clock ────────────

/** Window index containing time `tMs` on the weekly grid anchored at `anchorMs`.
 *  Negative before the anchor. */
export function epochIdAt(tMs: number, anchorMs: number): number {
  return Math.floor((tMs - anchorMs) / BOOST_EPOCH_MS);
}

/** Half-open window [startsAt, endsAt) of an epoch. */
export function epochWindow(epochId: number, anchorMs: number): { startsAt: Date; endsAt: Date } {
  const start = anchorMs + epochId * BOOST_EPOCH_MS;
  return { startsAt: new Date(start), endsAt: new Date(start + BOOST_EPOCH_MS) };
}

/** Qualification floor for a window per the ramp schedule (last step whose fromEpoch ≤ epochId). */
export function floorPlayedForEpoch(epochId: number, schedule: readonly FloorStep[] = BOOST_FLOOR_SCHEDULE): number {
  let floor = schedule[0].floorPlayed;
  for (const step of schedule) {
    if (epochId >= step.fromEpoch) floor = step.floorPlayed;
  }
  return floor;
}

// ──────────── Weekly ladder ────────────

export interface LadderInput {
  teamId: bigint;
  rating: number;
}

export interface LadderRow extends LadderInput {
  /** 1-based competition rank: equal ratings share the best rank of their group. */
  rank: number;
  /** Closed-interval percentile from `pctlOf` (1 = top, 0 = bottom). */
  percentile: number;
  /** Integer bps in [BOOST_MIN_BPS, BOOST_MAX_BPS]. */
  boostBps: number;
}

/** Integer boost for a percentile under a schedule, clamped to the contract cap. */
export function boostBpsForPercentile(percentile: number, schedule: BoostSchedule = BOOST_SCHEDULE): number {
  const raw = Math.round(boostBpsAt(percentile, schedule));
  return Math.max(BOOST_MIN_BPS, Math.min(BOOST_MAX_BPS, raw));
}

/** Rank qualified teams on one global ladder and assign each its boost.
 *  Sorted by rating desc; ties share a rank (and therefore a boost) — teamId is never a
 *  tie-breaker, so equal play earns equal pay. Below `minLadderSize` qualified teams the
 *  percentile spread is disabled and everyone earns BOOST_MIN_BPS. */
export function rankQualified(
  teams: readonly LadderInput[],
  opts: { schedule?: BoostSchedule; minLadderSize?: number } = {},
): LadderRow[] {
  const schedule = opts.schedule ?? BOOST_SCHEDULE;
  const minLadderSize = opts.minLadderSize ?? BOOST_MIN_LADDER_SIZE;
  const k = teams.length;
  if (k === 0) return [];
  const sorted = [...teams].sort((a, b) => b.rating - a.rating);
  const rows: LadderRow[] = [];
  let groupStart = 0; // 0-based index of the first team in the current tie group
  for (let i = 0; i < k; i++) {
    if (i > 0 && sorted[i].rating !== sorted[i - 1].rating) groupStart = i;
    const percentile = k < minLadderSize ? 0 : pctlOf(groupStart, k);
    rows.push({
      teamId: sorted[i].teamId,
      rating: sorted[i].rating,
      rank: groupStart + 1,
      percentile,
      boostBps: boostBpsForPercentile(percentile, schedule),
    });
  }
  return rows;
}

/** Split ladder rows into contract-sized batches (MiningPool.MAX_BOOST_BATCH). */
export function batchLadder<T>(rows: readonly T[], size: number = BOOST_ENTRIES_PER_TX): T[][] {
  if (!Number.isInteger(size) || size <= 0) throw new Error(`batch size must be a positive integer, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
