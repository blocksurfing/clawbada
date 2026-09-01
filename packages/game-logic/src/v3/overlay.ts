/**
 * Overlay-pool equilibrium (Option A for battle participation).
 *
 * participation.ts proved two things: a purely negative-sum arena unravels to
 * zero under rational play, and any flat per-battle subsidy big enough to fix
 * that is strictly profitable to farm (pair subsidy > pair drain, so two
 * colluding wallets print money). This module models the surviving shape:
 * a FIXED seasonal prize pool per stake bracket, paid at season end by
 * relative rank — never per battle.
 *
 * Deliberate modeling choices:
 *  - Rank pay means extra battles earn nothing, so rational entrants play the
 *    qualification minimum: `battlesPerSeason` IS the qualification floor and
 *    the bracket's volume knob.
 *  - Rank is ordered by expected win rate within the entrant pool. That is a
 *    win-count-like score proxy, which is PESSIMISTIC about collusion: real
 *    ELO self-corrects (beating a feeder whose rating has collapsed awards
 *    ~nothing), so measured collusion gains are an upper bound.
 *  - Free entry over a skill-ordered candidate population: the equilibrium is
 *    the largest top-k prefix whose weakest member has season EV >= 0. All
 *    stronger agents strictly prefer entering; the next candidate would lose
 *    by entering. Adverse selection is priced in, not assumed away.
 */
import { battleEV, type BracketEconomics } from './economy';
import { eloWinProb } from './participation';

export type PayoutSchedule =
  | { kind: 'flat' }
  | { kind: 'linear' }
  | { kind: 'geometric'; ratio: number };

/** Share of the pool per rank (0 = best). Sums to 1. */
export function payoutShares(n: number, s: PayoutSchedule): number[] {
  if (n <= 0) return [];
  if (n === 1) return [1];
  switch (s.kind) {
    case 'flat':
      return Array(n).fill(1 / n);
    case 'linear': {
      const total = (n * (n + 1)) / 2;
      return Array.from({ length: n }, (_, r) => (n - r) / total);
    }
    case 'geometric': {
      const g = s.ratio;
      const total = (1 - g ** n) / (1 - g);
      return Array.from({ length: n }, (_, r) => g ** r / total);
    }
  }
}

export interface OverlayConfig {
  /** Candidate agents' Elo-like skills (any order). */
  skills: number[];
  /** Seasonal overlay pool for this bracket ($CLAW). */
  pool: number;
  schedule: PayoutSchedule;
  /** Qualification floor: battles each entrant plays over the season. */
  battlesPerSeason: number;
  econ: BracketEconomics;
  /** Mining income the battle team forgoes per battle played ($CLAW). */
  opportunityPerBattle: number;
  /**
   * ELO-banded matchmaking within the entrant pool: everyone's win rate is
   * ~50%, so weak entrants stop being stake-farmed by strong ones (rank is
   * still skill-ordered — ELO measures skill even when pairing equalizes win
   * rates). Default false = S1 random-within-bracket.
   */
  banded?: boolean;
}

export interface OverlayResult {
  /** Number of agents battling at equilibrium (N*). */
  entrants: number;
  entrantShare: number;
  /** Skill percentile (0-1, among candidates) of the weakest entrant. */
  thresholdPercentile: number;
  marginalWinRate: number;
  /** Season EV of the weakest entrant (>= 0 at equilibrium). */
  marginalEV: number;
  topEV: number;
  medianEV: number;
  /** Battles across the bracket over the season (pairs). */
  battlesPerSeasonTotal: number;
  /** Protocol burn those battles generate (85% of fee + repairs). */
  seasonBurn: number;
  /** pool - seasonBurn: net new $CLAW from the battle layer (< 0 = deflationary). */
  netEmission: number;
  costPerEntrant: number;
}

/** Season EV of the k-th strongest candidate if exactly the top k enter. */
export function marginalSeasonEV(cfg: OverlayConfig, k: number, sortedDesc?: number[]): number {
  const s = sortedDesc ?? [...cfg.skills].sort((a, b) => b - a);
  const me = s[k - 1];
  let sum = 0;
  for (let j = 0; j < k - 1; j++) sum += eloWinProb(me, s[j]);
  const w = cfg.banded ? 0.5 : k > 1 ? sum / (k - 1) : 0.5;
  const shares = payoutShares(k, cfg.schedule);
  return cfg.battlesPerSeason * (battleEV(w, cfg.econ) - cfg.opportunityPerBattle) + shares[k - 1] * cfg.pool;
}

/** Win rate and season EV per entrant rank when exactly the top k enter. */
export function entrantSeasonEVs(cfg: OverlayConfig, k: number, sortedDesc?: number[]): { winRate: number; ev: number }[] {
  const s = sortedDesc ?? [...cfg.skills].sort((a, b) => b - a);
  const shares = payoutShares(k, cfg.schedule);
  return Array.from({ length: k }, (_, r) => {
    let sum = 0;
    for (let j = 0; j < k; j++) { if (j === r) continue; sum += eloWinProb(s[r], s[j]); }
    const w = cfg.banded ? 0.5 : k > 1 ? sum / (k - 1) : 0.5;
    return { winRate: w, ev: cfg.battlesPerSeason * (battleEV(w, cfg.econ) - cfg.opportunityPerBattle) + shares[r] * cfg.pool };
  });
}

export function overlayEquilibrium(cfg: OverlayConfig): OverlayResult {
  const sorted = [...cfg.skills].sort((a, b) => b - a);
  const n = sorted.length;
  let kStar = 0;
  for (let k = 2; k <= n; k++) if (marginalSeasonEV(cfg, k, sorted) >= 0) kStar = k;
  if (kStar === 0) {
    return { entrants: 0, entrantShare: 0, thresholdPercentile: 1, marginalWinRate: 0, marginalEV: 0, topEV: 0, medianEV: 0, battlesPerSeasonTotal: 0, seasonBurn: 0, netEmission: 0, costPerEntrant: 0 };
  }
  const evs = entrantSeasonEVs(cfg, kStar, sorted);
  const drainPerBattle = (2 * cfg.econ.stake * cfg.econ.feeBps) / 10_000 + cfg.econ.repairWinner + cfg.econ.repairLoser;
  const totalBattles = (kStar * cfg.battlesPerSeason) / 2;
  const seasonBurn = 0.85 * drainPerBattle * totalBattles;
  return {
    entrants: kStar,
    entrantShare: kStar / n,
    thresholdPercentile: (n - kStar) / n,
    marginalWinRate: evs[kStar - 1].winRate,
    marginalEV: evs[kStar - 1].ev,
    topEV: evs[0].ev,
    medianEV: evs[Math.floor((kStar - 1) / 2)].ev,
    battlesPerSeasonTotal: totalBattles,
    seasonBurn,
    netEmission: cfg.pool - seasonBurn,
    costPerEntrant: cfg.pool / kStar,
  };
}

export interface CollusionOutcome {
  honestPairEV: number;
  colludePairEV: number;
  gain: number;
  mainRankFrom: number;
  mainRankTo: number;
  feederRankTo: number;
}

/**
 * Two colluding wallets at the skill of entrant rank `round(pct*(k-1))` in the
 * equilibrium pool schedule fraction q of their battles against each other
 * (queue-sniping); main wins all of those, the feeder throws. Ranks re-derived
 * from expected-win-rate scores. Throwing costs the pair nothing extra beyond
 * the ordinary drain (internal stake transfers cancel), so the entire question
 * is whether the schedule pays main's rank climb more than the feeder's fall.
 * Returns null when the pool is too small to host the pair.
 */
export function collusionGain(cfg: OverlayConfig, q: number, rankPercentile: number): CollusionOutcome | null {
  const sorted = [...cfg.skills].sort((a, b) => b - a);
  const eq = overlayEquilibrium(cfg);
  const k = eq.entrants;
  if (k < 4) return null;
  const shares = payoutShares(k, cfg.schedule);
  const info = entrantSeasonEVs(cfg, k, sorted);
  const ws = info.map(e => e.winRate);
  const rank = Math.min(k - 1, Math.max(0, Math.round(rankPercentile * (k - 1))));
  const w = ws[rank];
  const B = cfg.battlesPerSeason, opp = cfg.opportunityPerBattle;
  const honest = B * (battleEV(w, cfg.econ) - opp) + shares[rank] * cfg.pool;
  const winnerNet = battleEV(1, cfg.econ);
  const loserNet = battleEV(0, cfg.econ);
  const rankOf = (score: number): number => {
    let r = 0;
    for (let j = 0; j < k; j++) { if (j === rank) continue; if (ws[j] > score) r++; }
    return Math.min(k - 1, r);
  };
  const mainRank = rankOf(q + (1 - q) * w);
  const feederRank = rankOf((1 - q) * w);
  const mainEV = B * (q * winnerNet + (1 - q) * battleEV(w, cfg.econ) - opp) + shares[mainRank] * cfg.pool;
  const feederEV = B * (q * loserNet + (1 - q) * battleEV(w, cfg.econ) - opp) + shares[feederRank] * cfg.pool;
  return { honestPairEV: 2 * honest, colludePairEV: mainEV + feederEV, gain: mainEV + feederEV - 2 * honest, mainRankFrom: rank, mainRankTo: mainRank, feederRankTo: feederRank };
}
