/**
 * Season-burn simulator: how fast a population drains the seasonal emission
 * budget, and what mid-season exhaustion vs an auto-glide baseReward does to
 * agent income and the battle layer.
 *
 * Deterministic day-by-day simulation. Teams arrive on an adoption ramp
 * (faucet window concentrates arrivals), mine full-time, retain a share of
 * income, and upgrade tiers when retained earnings cover the effective
 * upgrade cost (evolution $CLAW + market cost of fuel lobsters — stated
 * assumption, not contract data). Boost: Evolved+ teams participate at 50%
 * with +30% average -> expected +15% income for tier>=1 teams.
 *
 * Modes:
 *  - fixed: baseReward stays at launch value; budget serves demand until it
 *    exhausts mid-season (partial final day), then zero — current contract
 *    semantics (SeasonBudgetExhausted).
 *  - glide: baseReward recomputed daily as
 *      min(launchReward, remainingBudget / (remainingDays x weightUnits/day))
 *    so the budget always lasts the season; crowding shows up as declining
 *    per-team yield instead of a halt.
 * Boost funding: 'same-budget' (spends from the one budget) or 'carve'
 * (20% reserved for boost, mining glides on the other 80%).
 */

export const TIER_WEIGHTS = [1, 3, 10, 25]; // Base, Evolved, Elite, Apex
export const EXPEDITIONS_PER_DAY = 6;
/** Effective $CLAW cost to take a 3-lobster team up one tier (evolution fees + market fuel). Assumption. */
export const UPGRADE_COST = [12_000, 60_000, 300_000];
const BOOST_FACTOR = 1.15; // 50% participation x +30% average, Evolved+ only

export interface SeasonScenario {
  name: string;
  /** Wallets that ever join (1 mining team each). */
  wallets: number;
  /** Days over which arrivals ramp in linearly (faucet window ~7). */
  rampDays: number;
  /** Fraction of joined wallets mining full-time. */
  participation: number;
  /** Share of income retained toward tier upgrades. */
  retention: number;
}

export interface SeasonConfig {
  scenario: SeasonScenario;
  mode: 'fixed' | 'glide';
  boost: 'none' | 'same-budget' | 'carve';
  budget?: number;
  seasonDays?: number;
  launchReward?: number;
  /** Share of budget reserved for boost in 'carve' mode. */
  carveShare?: number;
}

export interface SeasonResult {
  /** Day mining halted (fixed mode), or null if the budget lasted. */
  exhaustionDay: number | null;
  zeroIncomeDays: number;
  /** baseReward on days 1, 30, 60. */
  rewardPath: { day: number; reward: number }[];
  /** Cumulative season earnings of a day-1 team (upgrades included). */
  day1TeamEarnings: number;
  /** Teams per tier at season end. */
  tierMix: number[];
  unspent: number;
  /** Days the carve could not fully fund the boost ('carve' mode). */
  boostUnpaidDays: number;
  /** Battle-layer stress: breakeven base boost (bps) for an Elite team at the final baseReward. */
  finalEliteBreakevenBps: number;
}

export function runSeason(cfg: SeasonConfig): SeasonResult {
  const days = cfg.seasonDays ?? 60;
  const launch = cfg.launchReward ?? 1_250;
  const totalBudget = cfg.budget ?? 352_500_000;
  const carve = cfg.boost === 'carve' ? (cfg.carveShare ?? 0.2) * totalBudget : 0;
  let mineBudget = totalBudget - carve;
  let boostBudget = carve;
  const sc = cfg.scenario;
  const totalTeams = Math.round(sc.wallets * sc.participation);

  const teams: { tier: number; retained: number; earned: number }[] = [];
  let arrived = 0;
  let exhaustionDay: number | null = null;
  let zeroIncomeDays = 0;
  let boostUnpaidDays = 0;
  const rewardPath: { day: number; reward: number }[] = [];
  let reward = launch;

  for (let day = 1; day <= days; day++) {
    const target = Math.round(Math.min(day, sc.rampDays) / sc.rampDays * totalTeams);
    for (; arrived < target; arrived++) teams.push({ tier: 0, retained: 0, earned: 0 });

    // Weight units demanded today (boost factor on Evolved+ when boost shares the budget).
    let units = 0;
    let boostUnits = 0;
    for (const t of teams) {
      const u = TIER_WEIGHTS[t.tier] * EXPEDITIONS_PER_DAY;
      units += u;
      if (t.tier >= 1 && cfg.boost !== 'none') boostUnits += u * (BOOST_FACTOR - 1);
    }
    const budgetUnits = cfg.boost === 'same-budget' ? units + boostUnits : units;

    if (cfg.mode === 'glide') {
      reward = budgetUnits > 0 ? Math.min(launch, mineBudget / ((days - day + 1) * budgetUnits)) : launch;
    }

    let served = 1; // fraction of today's mining demand the budget can pay
    const demand = reward * budgetUnits;
    if (demand > mineBudget) {
      served = demand > 0 ? mineBudget / demand : 0;
      if (exhaustionDay === null && served < 1) exhaustionDay = day;
    }
    mineBudget -= demand * served;
    if (served === 0) zeroIncomeDays++;

    // Boost from carve pool.
    let boostServed = cfg.boost === 'same-budget' ? served : 0;
    if (cfg.boost === 'carve') {
      const boostDemand = reward * boostUnits * served;
      boostServed = boostDemand > 0 ? Math.min(1, boostBudget / boostDemand) : 1;
      boostBudget -= boostDemand * boostServed;
      if (boostServed < 1) boostUnpaidDays++;
    }

    for (const t of teams) {
      let income = reward * TIER_WEIGHTS[t.tier] * EXPEDITIONS_PER_DAY * served;
      if (t.tier >= 1 && cfg.boost !== 'none') income *= 1 + (BOOST_FACTOR - 1) * boostServed;
      t.earned += income;
      t.retained += income * sc.retention;
      while (t.tier < 3 && t.retained >= UPGRADE_COST[t.tier]) {
        t.retained -= UPGRADE_COST[t.tier];
        t.tier++;
      }
    }
    if (day === 1 || day === 30 || day === days) rewardPath.push({ day, reward: served > 0 ? reward * served : 0 });
  }

  const tierMix = [0, 0, 0, 0];
  for (const t of teams) tierMix[t.tier]++;
  // Battle-layer stress at the final reward: Elite team, Mid drain 1,900/battle, 14 battles/epoch.
  const finalReward = cfg.mode === 'glide' ? reward : exhaustionDay === null ? launch : 0;
  const eliteMiningPerEpoch = finalReward * TIER_WEIGHTS[2] * EXPEDITIONS_PER_DAY * 7;
  const opp = (finalReward * TIER_WEIGHTS[2] * EXPEDITIONS_PER_DAY / 24) * 0.25;
  const finalEliteBreakevenBps = eliteMiningPerEpoch > 0 ? (10_000 * 14 * (1_900 + opp)) / eliteMiningPerEpoch : Infinity;

  return {
    exhaustionDay,
    zeroIncomeDays,
    rewardPath,
    day1TeamEarnings: teams.length ? teams[0].earned : 0,
    tierMix,
    unspent: mineBudget + boostBudget,
    boostUnpaidDays,
    finalEliteBreakevenBps,
  };
}

export const SCENARIOS: SeasonScenario[] = [
  { name: 'Design-rate (800 wallets)', wallets: 800, rampDays: 7, participation: 1, retention: 0.5 },
  { name: 'Moderate (3,000 wallets)', wallets: 3_000, rampDays: 14, participation: 0.6, retention: 0.5 },
  { name: 'Faucet-scale (10,000 wallets)', wallets: 10_000, rampDays: 7, participation: 0.6, retention: 0.5 },
];
