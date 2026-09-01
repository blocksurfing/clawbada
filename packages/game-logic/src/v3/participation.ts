/**
 * Participation equilibrium: battle vs mining.
 *
 * Each team-hour can either mine (guaranteed emission income) or battle
 * (zero-sum stakes minus fee and repairs — negative-sum for the average
 * player). An agent battles only while their expected $CLAW/hour in the
 * CURRENT battle pool beats mining. But win rates are relative: when weak
 * players exit, mid players become the new bottom — the pool "unravels" from
 * below until the marginal battler is indifferent. This module computes that
 * fixed point.
 *
 * Deliberately assumption-light and fully deterministic:
 *  - skill is Elo-like; win prob vs an opponent is logistic (400-point scale)
 *  - matchmaking is uniform within the pool (matches S1: random within bucket)
 *  - risk-neutral agents, no queue friction, one bracket/tier at a time
 */
import { battleEV, type BracketEconomics } from './economy';

/** Logistic (Elo) win probability of skill a vs skill b. */
export function eloWinProb(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/** Deterministic skill population: N quantiles of a normal with the given Elo spread. */
export function skillPopulation(n: number, sigma: number): number[] {
  // Acklam's inverse-normal approximation on evenly spaced quantiles.
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const inv = (p: number): number => {
    const pl = 0.02425;
    if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) return -inv(1 - p);
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  };
  return Array.from({ length: n }, (_, k) => sigma * inv((k + 0.5) / n));
}

export interface ParticipationConfig {
  /** Elo-like skills, one per agent/team. */
  skills: number[];
  /** Battles a battling team completes per hour (matchmaking + play). */
  battlesPerHour: number;
  /** Guaranteed mining income per team-hour at the comparable tier. */
  miningPerHour: number;
  econ: BracketEconomics;
  /** Positive-sum reward paid to EACH participant per battle (leaderboard/emission recycling). */
  subsidyPerBattle?: number;
}

export interface ParticipationResult {
  /** Indices of agents who battle at equilibrium (sorted by skill asc). */
  pool: number[];
  poolShare: number;
  /** Within-pool win rate of the weakest remaining battler. */
  marginalWinRate: number;
  /** Skill percentile (0-1) of the weakest remaining battler; 1 = pool empty. */
  thresholdPercentile: number;
  /** Per-battle protocol burn (fee + both repairs) × battles happening per hour per agent in the population. */
  burnPerAgentHour: number;
  /** Battles per hour across the whole population (pairs). */
  battlesPerHourTotal: number;
}

/**
 * Unravel from below: repeatedly remove the weakest battler whose expected
 * $CLAW/hour in the current pool is below mining, until the weakest remaining
 * is indifferent-or-better (or fewer than 2 battlers remain).
 */
export function participationEquilibrium(cfg: ParticipationConfig): ParticipationResult {
  const order = [...cfg.skills.keys()].sort((x, y) => cfg.skills[x] - cfg.skills[y]);
  let lo = 0; // pool = order[lo..]
  const n = order.length;
  const winRate = (idx: number, from: number): number => {
    let s = 0, m = 0;
    for (let j = from; j < n; j++) { if (order[j] === idx) continue; s += eloWinProb(cfg.skills[idx], cfg.skills[order[j]]); m++; }
    return m === 0 ? 0.5 : s / m;
  };
  while (n - lo >= 2) {
    const weakest = order[lo];
    const p = winRate(weakest, lo);
    const evHour = cfg.battlesPerHour * (battleEV(p, cfg.econ) + (cfg.subsidyPerBattle ?? 0));
    if (evHour >= cfg.miningPerHour) break;
    lo++;
  }
  const poolIdx = order.slice(lo);
  const poolSize = n - lo >= 2 ? n - lo : 0;
  const pool = poolSize ? poolIdx : [];
  const marginal = poolSize ? winRate(order[lo], lo) : 0;
  const fee = (2 * cfg.econ.stake * cfg.econ.feeBps) / 10_000;
  const burnPerBattle = fee + cfg.econ.repairWinner + cfg.econ.repairLoser;
  const battlesTotal = (poolSize / 2) * cfg.battlesPerHour; // pairs
  return {
    pool,
    poolShare: poolSize / n,
    marginalWinRate: marginal,
    thresholdPercentile: poolSize ? lo / n : 1,
    burnPerAgentHour: (battlesTotal * burnPerBattle) / n,
    battlesPerHourTotal: battlesTotal,
  };
}

/**
 * Subsidy per battle (paid to each participant) required to sustain a battle
 * pool of `targetShare` of the population: makes the weakest member of that
 * pool indifferent between battling and mining. The pool is then stable —
 * everyone stronger strictly prefers battling, everyone weaker stays out.
 */
export function requiredSubsidy(cfg: Omit<ParticipationConfig, 'subsidyPerBattle'>, targetShare: number): { subsidy: number; marginalWinRate: number } {
  const order = [...cfg.skills.keys()].sort((x, y) => cfg.skills[x] - cfg.skills[y]);
  const n = order.length;
  const lo = Math.min(n - 2, Math.max(0, Math.round(n * (1 - targetShare))));
  const weakest = order[lo];
  let s = 0, m = 0;
  for (let j = lo; j < n; j++) { if (order[j] === weakest) continue; s += eloWinProb(cfg.skills[weakest], cfg.skills[order[j]]); m++; }
  const p = m ? s / m : 0.5;
  const subsidy = Math.max(0, cfg.miningPerHour / cfg.battlesPerHour - battleEV(p, cfg.econ));
  return { subsidy, marginalWinRate: p };
}
