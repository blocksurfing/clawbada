/**
 * Battle-rank mining boost (team-keyed, weekly epochs) — the S1 incentive
 * layer that keeps agent-vs-agent battle rational without touching the
 * zero-sum stakes.
 *
 * Mechanism modeled here:
 *  - Battle ELO attaches to the TEAM (not the wallet). Every mining team that
 *    wants a boost must itself hold rank — no aggregation games, no sybil
 *    advantage, battle volume scales with fleet size by construction.
 *  - Weekly epoch: a team must PLAY >= minBattlesPerEpoch (never "win" — a
 *    win requirement recreates win-count incentives and a market for bought
 *    wins at epoch deadlines). Lapse -> boost 0 next epoch; ELO persists.
 *  - Boost = schedule(percentile among participants) x that team's mining
 *    income. No shared pool: one team's boost never dilutes another's, which
 *    is what makes the design population-proof.
 *  - The base tier (percentile floor 0) is the anti-unravel keystone: it must
 *    cover the qualification battle cost at ~50% win rate, or the bottom of
 *    the participant pool exits and the percentiles cascade exactly like
 *    participation.ts. Banded matchmaking is load-bearing for the same
 *    reason: it caps the marginal team's cost at the structural drain.
 */
import { battleEV, type BracketEconomics } from './economy';
import { eloWinProb } from './participation';

export interface TierEconomy {
  name: string;
  econ: BracketEconomics;
  /** Team mining income per weekly epoch (tierWeight x baseReward x 6/day x 7). */
  miningPerEpochPerTeam: number;
  /** Mining income forgone per battle (team mining/hour x hours per battle). */
  opportunityPerBattle: number;
}

const HOURS_PER_BATTLE = 0.25;
export const EVOLVED_LOW: TierEconomy = {
  name: 'Evolved/Low',
  econ: { stake: 2_500, feeBps: 1000, repairWinner: 150, repairLoser: 450 },
  miningPerEpochPerTeam: 3_750 * 6 * 7,
  opportunityPerBattle: (3_750 * 6 / 24) * HOURS_PER_BATTLE,
};
export const ELITE_MID: TierEconomy = {
  name: 'Elite/Mid',
  econ: { stake: 10_000, feeBps: 1000, repairWinner: 450, repairLoser: 1350 },
  miningPerEpochPerTeam: 12_500 * 6 * 7,
  opportunityPerBattle: (12_500 * 6 / 24) * HOURS_PER_BATTLE,
};
export const APEX_HIGH: TierEconomy = {
  name: 'Apex/High',
  econ: { stake: 50_000, feeBps: 1000, repairWinner: 1_200, repairLoser: 3_600 },
  miningPerEpochPerTeam: 31_250 * 6 * 7,
  opportunityPerBattle: (31_250 * 6 / 24) * HOURS_PER_BATTLE,
};

export type BoostSchedule =
  /** League steps: first tier whose percentile floor the team meets. Include a floor-0 base tier. */
  | { kind: 'stepped'; tiers: { pctlFloor: number; boostBps: number }[] }
  /** Linear in percentile from minBps (worst participant) to maxBps (best). */
  | { kind: 'smooth'; minBps: number; maxBps: number };

/** Boost (bps of mining income) at percentile pctl in [0,1], 1 = best participant. */
export function boostBpsAt(pctl: number, s: BoostSchedule): number {
  if (s.kind === 'smooth') return s.minBps + (s.maxBps - s.minBps) * pctl;
  let best = 0;
  for (const t of s.tiers) if (pctl >= t.pctlFloor && t.boostBps > best) best = t.boostBps;
  return best;
}

export interface BoostConfig {
  /** Candidate teams' Elo-like skills. */
  skills: number[];
  tier: TierEconomy;
  schedule: BoostSchedule;
  /** Qualification floor: battles PLAYED per epoch to hold the boost. */
  minBattlesPerEpoch: number;
  /** ELO-banded matchmaking (everyone ~50% within the pool). */
  banded?: boolean;
}

export interface BoostResult {
  entrants: number;
  entrantShare: number;
  marginalWinRate: number;
  /** Epoch EV of the weakest participant (>= 0 at equilibrium). */
  marginalEV: number;
  topEV: number;
  medianEV: number;
  /** Mean boost bps over participants — spend rate on participating mining. */
  avgBoostBps: number;
  /** Boost spend as share of the WHOLE candidate population's mining income. */
  spendShareOfMining: number;
  /** Battles per epoch across the pool (pairs). */
  battlesPerEpochTotal: number;
}

/** Epoch EV of a participant at percentile pctl with win rate w. */
export function teamEpochEV(cfg: BoostConfig, pctl: number, w: number): number {
  const boost = (boostBpsAt(pctl, cfg.schedule) / 10_000) * cfg.tier.miningPerEpochPerTeam;
  return boost + cfg.minBattlesPerEpoch * (battleEV(w, cfg.tier.econ) - cfg.tier.opportunityPerBattle);
}

/** Free-entry equilibrium: largest top-k prefix whose weakest member has epoch EV >= 0. */
export function boostParticipation(cfg: BoostConfig): BoostResult {
  const sorted = [...cfg.skills].sort((a, b) => b - a);
  const n = sorted.length;
  const winRate = (r: number, k: number): number => {
    if (cfg.banded) return 0.5;
    if (k < 2) return 0.5;
    let s = 0;
    for (let j = 0; j < k; j++) { if (j === r) continue; s += eloWinProb(sorted[r], sorted[j]); }
    return s / (k - 1);
  };
  const pctlOf = (r: number, k: number): number => (k > 1 ? (k - 1 - r) / (k - 1) : 1);
  let kStar = 0;
  for (let k = 2; k <= n; k++) {
    if (teamEpochEV(cfg, pctlOf(k - 1, k), winRate(k - 1, k)) >= 0) kStar = k;
  }
  if (kStar === 0) {
    return { entrants: 0, entrantShare: 0, marginalWinRate: 0, marginalEV: 0, topEV: 0, medianEV: 0, avgBoostBps: 0, spendShareOfMining: 0, battlesPerEpochTotal: 0 };
  }
  const evAt = (r: number) => teamEpochEV(cfg, pctlOf(r, kStar), winRate(r, kStar));
  let boostSum = 0;
  for (let r = 0; r < kStar; r++) boostSum += boostBpsAt(pctlOf(r, kStar), cfg.schedule);
  return {
    entrants: kStar,
    entrantShare: kStar / n,
    marginalWinRate: winRate(kStar - 1, kStar),
    marginalEV: evAt(kStar - 1),
    topEV: evAt(0),
    medianEV: evAt(Math.floor((kStar - 1) / 2)),
    avgBoostBps: boostSum / kStar,
    spendShareOfMining: (boostSum / 10_000) / n,
    battlesPerEpochTotal: (kStar * cfg.minBattlesPerEpoch) / 2,
  };
}

export interface BoostCollusion {
  gain: number;
  mainPctlFrom: number;
  mainPctlTo: number;
  feederPctlTo: number;
}

/**
 * Wallet-internal win-trading: a fleet owner's feeder team throws fraction q
 * of its battles to a flagship at the same skill, both sitting at rankPctl.
 * Conditions on the FULL candidate pool (the healthy-pool case the base tier
 * plus banding create) and uses random-mode win rates for both rank scores
 * and stake EV — a pessimistic upper bound: real ELO pays ~nothing for
 * farming a collapsed-rating feeder, and banded queues get harder to snipe
 * as the two ratings are pushed apart. Stake transfers inside the wallet
 * cancel, so throwing costs only the ordinary drain; the entire gain is
 * schedule shape.
 */
export function boostCollusionGain(cfg: BoostConfig, q: number, rankPctl: number): BoostCollusion | null {
  const sorted = [...cfg.skills].sort((a, b) => b - a);
  const k = sorted.length;
  if (k < 4) return null;
  const ws: number[] = [];
  for (let r = 0; r < k; r++) {
    let s = 0;
    for (let j = 0; j < k; j++) { if (j === r) continue; s += eloWinProb(sorted[r], sorted[j]); }
    ws.push(s / (k - 1));
  }
  const rank = Math.min(k - 1, Math.max(0, Math.round((1 - rankPctl) * (k - 1))));
  const w = ws[rank];
  const pctlOf = (r: number): number => (k - 1 - r) / (k - 1);
  const boostAt = (r: number): number => (boostBpsAt(pctlOf(r), cfg.schedule) / 10_000) * cfg.tier.miningPerEpochPerTeam;
  const B = cfg.minBattlesPerEpoch;
  const honest = boostAt(rank) + B * (battleEV(w, cfg.tier.econ) - cfg.tier.opportunityPerBattle);
  const rankOf = (score: number): number => {
    let r = 0;
    for (let j = 0; j < k; j++) { if (j === rank) continue; if (ws[j] > score) r++; }
    return Math.min(k - 1, r);
  };
  const mainRank = rankOf(q + (1 - q) * w);
  const feederRank = rankOf((1 - q) * w);
  const winnerNet = battleEV(1, cfg.tier.econ);
  const loserNet = battleEV(0, cfg.tier.econ);
  const mainEV = boostAt(mainRank) + B * (q * winnerNet + (1 - q) * battleEV(w, cfg.tier.econ) - cfg.tier.opportunityPerBattle);
  const feederEV = boostAt(feederRank) + B * (q * loserNet + (1 - q) * battleEV(w, cfg.tier.econ) - cfg.tier.opportunityPerBattle);
  return { gain: mainEV + feederEV - 2 * honest, mainPctlFrom: pctlOf(rank), mainPctlTo: pctlOf(mainRank), feederPctlTo: pctlOf(feederRank) };
}

export function breakevenBaseBps(tier: TierEconomy, minBattles: number): number {
  const costPerBattle = -battleEV(0.5, tier.econ) + tier.opportunityPerBattle;
  return (10_000 * minBattles * costPerBattle) / tier.miningPerEpochPerTeam;
}
