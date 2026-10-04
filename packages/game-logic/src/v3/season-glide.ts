/**
 * D-19: the mining-reward glide as the CONTRACT runs it, not the idealised daily re-peg that
 * season.ts validated the design with. The audit named three differences nobody had modelled:
 *   (a) the ±30 % step per epoch (asymmetric in effect: a 30 % drop needs a 43 % rise to undo);
 *   (b) epoch 0 is blind — no re-peg until the first epoch boundary — and every re-peg uses the
 *       PREVIOUS epoch's demand (`trailingWeightServed`), so the rate lags demand by one epoch;
 *   (d) populations of 15,000–30,000 teams were never run.
 *
 * Run on 2026-10-02 (docs/audits/2026-10-02-d19-glide-simulation.md), this showed the daily
 * controller failing above ~6,000 teams, and decided the fix now in MiningPool: an HOURLY
 * re-peg, a per-epoch spend ceiling (no epoch mints more than twice its fair share of what is
 * left, never less than one Apex expedition at +50 %), and a hold whenever less than one Base
 * reward is left. `ONCHAIN` is that controller; `LEGACY_DAILY` is the one it replaced, kept so
 * the comparison can be re-run.
 *
 * The controller here is integer wei math mirroring `contracts/MiningPool.sol::_repegIfNeeded`
 * via the fuzz suite's reference model (`contracts/test/fuzz/FuzzMiningGlide.t.sol::_modelRepeg`,
 * itself fuzz-verified against the contract); `v3-season-glide.test.ts` pins it to the
 * contract's own test vectors. The population dynamics mirror season.ts (arrival ramp, tiers,
 * retention, upgrades, boost on the same budget) plus join / leave events, so a demand step and
 * an exodus can be modelled.
 *
 * `GlideParams` exposes the levers a contract change could pull — epoch length, step sizes,
 * the per-epoch spend ceiling — so any future change is compared on identical populations
 * BEFORE it is deployed (the contracts are not upgradeable).
 */

export const WEI = 10n ** 18n;
const BPS = 10_000n;
export const TIER_WEIGHTS = [1, 3, 10, 25]; // Base, Evolved, Elite, Apex
export const EXPEDITIONS_PER_DAY = 6;
/** Effective $CLAW to take a 3-lobster team up one tier (evolution fees + market fuel). Assumption, as in season.ts. */
export const UPGRADE_COST = [12_000, 60_000, 300_000];
const BOOST_FACTOR = 1.15; // 50 % of Evolved+ teams boosted at +30 % average, as in season.ts
export const SEASON_DAYS = 60;
export const S1_EMISSION_WEI = 352_500_000n * WEI;
export const S1_LAUNCH_WEI = 1_250n * WEI;
export const MINING_ALLOCATION_WEI = 705_000_000n * WEI;

// ──────────── The controller ────────────

export interface GlideParams {
  /** REPEG_EPOCH in hours (1 on-chain since D-19; 24 before). */
  epochHours: number;
  /** Largest upward step per epoch, bps (REPEG_MAX_STEP_BPS = 3,000 on-chain). */
  upStepBps: number;
  /** Largest downward step per epoch, bps (3,000 on-chain). */
  downStepBps: number;
  /** No epoch may mint more than this multiple of its fair share of what is left (left / epochsLeft),
   *  never less than one Apex expedition at +50 % (EPOCH_SPEND_CAP_BPS / 10,000 = 2 on-chain since
   *  D-19; 0 = none, as before). Expeditions past the ceiling cannot start until the next epoch. */
  epochSpendCapX: number;
  /** Review 2026-10-03 D-C: how many of the latest epochs the demand estimate averages over.
   *  1 (default) = as deployed: the last epoch THAT HAD demand, quiet epochs keep it. W > 1 = the
   *  last W epochs with quiet ones counting as zero — phase-invariant over one 4 h expedition
   *  cycle (4) or a day (24). Early in the season the average runs over the epochs seen so far. */
  estimatorWindow?: number;
}

/** The contract as it will deploy (D-19, 2026-10-02): hourly, ±30 %, 2x ceiling. */
export const ONCHAIN: GlideParams = { epochHours: 1, upStepBps: 3_000, downStepBps: 3_000, epochSpendCapX: 2, estimatorWindow: 4 };
/** The controller between D-19 and D-C: the same, pacing against the last epoch that had demand. */
export const D19_SINGLE_EPOCH: GlideParams = { ...ONCHAIN, estimatorWindow: 1 };
/** The controller before D-19: daily, ±30 %, no ceiling — kept for the comparison. */
export const LEGACY_DAILY: GlideParams = { epochHours: 24, upStepBps: 3_000, downStepBps: 3_000, epochSpendCapX: 0 };

export interface GlideState {
  base: bigint;
  launch: bigint;
  emission: bigint;
  minted: bigint;
  lifetimeMinted: bigint;
  lastEpoch: number;
  /** Boost-scaled weight units served this epoch (units × BPS), as `epochWeightServed`. */
  servedBps: bigint;
  /** Units served in the last completed epoch with demand, as `trailingWeightServed` (W = 1), or
   *  the window's per-epoch average (W > 1; for display — the target uses the window sum). */
  trailing: bigint;
  /** W > 1 only: the last W epochs' served units, slot = epoch % W. */
  ring: bigint[];
}

export function newGlideState(emission: bigint, launch: bigint, lifetimeMintedBefore = 0n): GlideState {
  return { base: launch, launch, emission, minted: 0n, lifetimeMinted: lifetimeMintedBefore, lastEpoch: 0, servedBps: 0n, trailing: 0n, ring: [] };
}

/** `_repegIfNeeded`, exactly. Call at the first touch of each epoch. */
export function repegIfNeeded(s: GlideState, epoch: number, totalEpochs: number, p: GlideParams): void {
  if (epoch === s.lastEpoch) return; // epoch 0 is blind: lastRepegEpoch starts at 0
  const W = Math.max(1, p.estimatorWindow ?? 1);
  // `windowSum` units over `filled` epochs is the demand estimate; W = 1 is the deployed rule.
  let windowSum: bigint;
  let filled = 1;
  if (W === 1) {
    if (s.servedBps > 0n) s.trailing = s.servedBps / BPS; // quiet epochs keep the last real signal
    windowSum = s.trailing;
  } else {
    if (s.ring.length !== W) s.ring = new Array<bigint>(W).fill(0n);
    s.ring[s.lastEpoch % W] = s.servedBps / BPS; // the epoch just closed
    // A gap LONGER than the window leaves nothing recent (the epoch just closed is older than the
    // window too); a gap inside it zeroes the skipped epochs — they were quiet. Lazy on-chain, so
    // this is what `_repegIfNeeded` sees on the first touch after a gap.
    if (epoch - s.lastEpoch > W) s.ring.fill(0n);
    else for (let e = s.lastEpoch + 1; e < epoch; e++) s.ring[e % W] = 0n; // skipped = quiet
    windowSum = s.ring.reduce((a, b) => a + b, 0n);
    filled = Math.min(W, epoch); // the season's first epochs: average over what has been seen
    s.trailing = windowSum / BigInt(filled);
  }
  s.servedBps = 0n;
  s.lastEpoch = epoch;
  if (windowSum === 0n) return; // no demand signal: hold

  const epochsLeft = epoch >= totalEpochs ? 1 : totalEpochs - epoch; // D-18: counts this epoch
  let left = s.emission > s.minted ? s.emission - s.minted : 0n;
  const allocationLeft = MINING_ALLOCATION_WEI > s.lifetimeMinted ? MINING_ALLOCATION_WEI - s.lifetimeMinted : 0n; // D-20
  if (allocationLeft < left) left = allocationLeft;
  if (left < s.base) return; // D-19(c): less than one Base reward left is not a demand signal — hold

  // The window SUM over `filled` epochs, not the floored average, so a small population still moves the rate.
  const target = (left * BigInt(filled)) / (BigInt(epochsLeft) * windowSum);
  const lo = (s.base * BigInt(10_000 - p.downStepBps)) / BPS;
  const hi = (s.base * BigInt(10_000 + p.upStepBps)) / BPS;
  let next = target < lo ? lo : target > hi ? hi : target;
  if (next > s.launch) next = s.launch;
  if (next === 0n) next = 1n;
  s.base = next;
}

// ──────────── The population ────────────

export interface DemandEvent {
  day: number;
  /** Fresh Base-tier teams that join on this day (a surge). */
  join?: number;
  /** Share of the active teams that stop mining on this day (an exodus). */
  leaveFraction?: number;
}

/**
 * How a day's starts are spread over its hourly epochs (review 2026-10-03 D-C). A 4 h expedition is
 * exactly four epochs, so a cohort that starts on the same hour hits the glide every 4th epoch.
 * `phaseLocked`: `share` of the population starts only on hours ≡ 0 (mod 4); the rest is smooth.
 * `daily`: `peakShare` of all starts land inside the first `peakHours` of each day.
 */
export type DemandShape =
  | { kind: 'smooth' }
  | { kind: 'phaseLocked'; share: number }
  | { kind: 'daily'; peakShare: number; peakHours: number };

/** Per-epoch multipliers for the two cohorts (each integrates to its cohort's share over a day). */
export function shapeFactors(shape: DemandShape, hour: number, epochsPerDay: number): { locked: number; spread: number } {
  if (epochsPerDay !== 24 || shape.kind === 'smooth') return { locked: 0, spread: 1 };
  if (shape.kind === 'phaseLocked') return { locked: hour % 4 === 0 ? 4 * shape.share : 0, spread: 1 - shape.share };
  const peak = hour < shape.peakHours;
  return {
    locked: peak ? (shape.peakShare * 24) / shape.peakHours : 0,
    spread: peak ? 0 : ((1 - shape.peakShare) * 24) / (24 - shape.peakHours),
  };
}

export interface GlideScenario {
  name: string;
  /** Demand shape over the day; smooth when omitted. */
  shape?: DemandShape;
  /** Participating teams that arrive on the ramp (1 mining team each, full time). */
  teams: number;
  /** Days over which arrivals ramp in linearly (the faucet window ≈ 7; 1 = everyone on day 1). */
  rampDays: number;
  /** Share of income retained toward tier upgrades. */
  retention: number;
  events?: DemandEvent[];
}

export interface GlideRunConfig {
  scenario: GlideScenario;
  /** 'onchain' = the contract's controller under `params`; 'ideal' = season.ts's daily exact re-peg (no lag, no clamp, no blind epoch). */
  mode: 'onchain' | 'ideal';
  params?: GlideParams;
  /** Boost on the same budget (season.ts 'same-budget'). */
  boost?: boolean;
  emission?: bigint;
  launch?: bigint;
  days?: number;
}

export interface GlideRunResult {
  /** First day on which some expedition could not be paid; null if the budget lasted. */
  exhaustionDay: number | null;
  /** Days on which active teams earned nothing at all. */
  zeroIncomeDays: number;
  /** Reward per Base expedition (CLAW) at the end of each day, index day-1. */
  rewardByDay: number[];
  /** Cumulative share of the season budget minted by the end of each day. */
  mintedShareByDay: number[];
  /** Largest single-day spend as a multiple of the fair daily share (budget / days). */
  maxDayOverspendX: number;
  /** Largest single-day spend as a share of the SUM of that day's epoch ceilings: ≤ 1 by construction
   *  (the ceiling is per epoch, 2× the fair share of what is left, floored at one Apex expedition). */
  maxDayVsCapX: number;
  unspentClaw: number;
  /** Cumulative season earnings (CLAW) of a team that arrived on day 1. */
  day1TeamEarnings: number;
  /** Teams per tier at season end. */
  tierMix: number[];
  /** Battle-layer stress: breakeven base boost (bps) for an Elite team at the final reward (season.ts). */
  finalEliteBreakevenBps: number;
  /** D-C: CLAW earned per unit demanded by the shape's two cohorts (locked / peak vs spread / off-peak),
   *  and their ratio — 1.0 is fair; refused starts retry next epoch, so this is the time-of-day premium. */
  cohortPerUnit: { locked: number; spread: number; ratio: number };
  /** Share of all starts refused by the ceiling at least once (they retried next epoch). */
  refusedShare: number;
}

interface Team { tier: number; retained: number; earned: number; active: boolean }

export function runGlideSeason(cfg: GlideRunConfig): GlideRunResult {
  const days = cfg.days ?? SEASON_DAYS;
  const p = cfg.params ?? ONCHAIN;
  const epochHours = cfg.mode === 'ideal' ? 24 : p.epochHours;
  const epochsPerDay = 24 / epochHours;
  const totalEpochs = days * epochsPerDay;
  const emission = cfg.emission ?? S1_EMISSION_WEI;
  const s = newGlideState(emission, cfg.launch ?? S1_LAUNCH_WEI);
  const sc = cfg.scenario;
  const boost = cfg.boost ?? true;

  const teams: Team[] = [];
  let arrived = 0;
  let backlog = { locked: 0, spread: 0 };
  const cohort = { lockedDemanded: 0, spreadDemanded: 0, lockedEarned: 0, spreadEarned: 0 };
  let refusedUnits = 0;
  let exhaustionDay: number | null = null;
  let zeroIncomeDays = 0;
  let maxDayOverspendX = 0;
  let maxDayVsCapX = 0;
  const rewardByDay: number[] = [];
  const mintedShareByDay: number[] = [];
  const fairDay = Number(emission) / days;

  for (let day = 1; day <= days; day++) {
    const target = Math.round((Math.min(day, sc.rampDays) / sc.rampDays) * sc.teams);
    for (; arrived < target; arrived++) teams.push({ tier: 0, retained: 0, earned: 0, active: true });
    for (const ev of sc.events ?? []) {
      if (ev.day !== day) continue;
      for (let i = 0; i < (ev.join ?? 0); i++) teams.push({ tier: 0, retained: 0, earned: 0, active: true });
      if (ev.leaveFraction) {
        const active = teams.filter((t) => t.active);
        const leaving = Math.round(active.length * ev.leaveFraction);
        for (let i = 0; i < leaving; i++) active[i].active = false;
      }
    }

    const mintedAtDayStart = s.minted;
    let capToday = 0;
    let incomeToday = 0;
    let unitsToday = 0;

    for (let k = 0; k < epochsPerDay; k++) {
      const epoch = (day - 1) * epochsPerDay + k;
      // Boost-scaled weight units demanded this epoch (the contract tracks units × BPS).
      let units = 0;
      for (const t of teams) {
        if (!t.active) continue;
        units += (TIER_WEIGHTS[t.tier] * EXPEDITIONS_PER_DAY * (boost && t.tier >= 1 ? BOOST_FACTOR : 1)) / epochsPerDay;
      }
      unitsToday += units;
      // D-C: the day's starts spread per the shape, plus what the ceiling refused last epoch.
      const f = shapeFactors(sc.shape ?? { kind: 'smooth' }, k, epochsPerDay);
      const newLocked = units * f.locked;
      const newSpread = units * f.spread;
      cohort.lockedDemanded += newLocked;
      cohort.spreadDemanded += newSpread;
      const wantLocked = newLocked + backlog.locked;
      const wantSpread = newSpread + backlog.spread;
      const want = wantLocked + wantSpread;
      const unitsBps = BigInt(Math.round(want * 10_000));

      let left = s.emission > s.minted ? s.emission - s.minted : 0n;
      if (cfg.mode === 'ideal') {
        // season.ts: exact re-peg from THIS epoch's demand, no clamp, no lag, capped at launch.
        const epochsLeft = totalEpochs - epoch;
        if (unitsBps > 0n && left > 0n) {
          const ideal = (left * BPS) / (BigInt(epochsLeft) * unitsBps);
          s.base = ideal > s.launch ? s.launch : ideal === 0n ? 1n : ideal;
        }
      } else {
        repegIfNeeded(s, epoch, totalEpochs, p);
      }

      // The ceiling: this epoch may mint at most X × its fair share of what is left, never less
      // than one Apex expedition at +50 % (MiningPool._epochSpendCapFrom).
      let payable = left;
      if (cfg.mode === 'onchain' && p.epochSpendCapX > 0) {
        const epochsLeft = totalEpochs - epoch;
        let cap = (left * BigInt(Math.round(p.epochSpendCapX * 1000))) / (BigInt(epochsLeft) * 1000n);
        const oneMaxExpedition = ((s.base * 15_000n) / BPS) * BigInt(TIER_WEIGHTS[3]);
        if (cap < oneMaxExpedition) cap = oneMaxExpedition;
        if (cap < payable) payable = cap;
        capToday += Number(cap);
      }

      const demand = (s.base * unitsBps) / BPS;
      let served = 1;
      let mintedNow = demand;
      if (demand > payable) {
        // Only `payable` can be minted; the rest of this epoch's starts retry next epoch (backlog).
        // Minting exactly `payable` keeps the budget's remainder exact (0 once exhausted — the case
        // the contract's D-19(c) hold covers; the dust case is probed on the contract itself).
        served = demand > 0n ? Number(payable) / Number(demand) : 0;
        mintedNow = payable;
        if (demand > left && exhaustionDay === null) exhaustionDay = day;
      }
      s.minted += mintedNow;
      s.lifetimeMinted += mintedNow;
      s.servedBps += BigInt(Math.round(Number(unitsBps) * served));
      const rateNow = Number(s.base) / 1e18;
      cohort.lockedEarned += wantLocked * served * rateNow;
      cohort.spreadEarned += wantSpread * served * rateNow;
      refusedUnits += want * (1 - served);
      backlog = { locked: wantLocked * (1 - served), spread: wantSpread * (1 - served) };

      const perUnit = rateNow * served;
      for (const t of teams) {
        if (!t.active) continue;
        const income = (perUnit * TIER_WEIGHTS[t.tier] * EXPEDITIONS_PER_DAY * (boost && t.tier >= 1 ? BOOST_FACTOR : 1)) / epochsPerDay;
        t.earned += income;
        t.retained += income * sc.retention;
        incomeToday += income;
      }
    }

    if (unitsToday > 0 && incomeToday === 0) zeroIncomeDays++;
    const spentToday = Number(s.minted - mintedAtDayStart);
    maxDayOverspendX = Math.max(maxDayOverspendX, spentToday / fairDay);
    if (capToday > 0) maxDayVsCapX = Math.max(maxDayVsCapX, spentToday / capToday);
    rewardByDay.push(Number(s.base) / 1e18);
    mintedShareByDay.push(Number(s.minted) / Number(emission));

    // Upgrades, once a day, as in season.ts.
    for (const t of teams) {
      if (!t.active) continue;
      while (t.tier < 3 && t.retained >= UPGRADE_COST[t.tier]) {
        t.retained -= UPGRADE_COST[t.tier];
        t.tier++;
      }
    }
  }

  const tierMix = [0, 0, 0, 0];
  for (const t of teams) tierMix[t.tier]++;
  const finalReward = rewardByDay[days - 1];
  const eliteMiningPerEpoch = finalReward * TIER_WEIGHTS[2] * EXPEDITIONS_PER_DAY * 7;
  const opp = ((finalReward * TIER_WEIGHTS[2] * EXPEDITIONS_PER_DAY) / 24) * 0.25;
  const finalEliteBreakevenBps = eliteMiningPerEpoch > 0 ? (10_000 * 14 * (1_900 + opp)) / eliteMiningPerEpoch : Infinity;

  const lockedPerUnit = cohort.lockedDemanded > 0 ? cohort.lockedEarned / cohort.lockedDemanded : 0;
  const spreadPerUnit = cohort.spreadDemanded > 0 ? cohort.spreadEarned / cohort.spreadDemanded : 0;
  const totalDemanded = cohort.lockedDemanded + cohort.spreadDemanded;
  return {
    exhaustionDay,
    zeroIncomeDays,
    rewardByDay,
    mintedShareByDay,
    maxDayOverspendX,
    maxDayVsCapX,
    unspentClaw: Number(s.emission - s.minted) / 1e18,
    day1TeamEarnings: teams.length ? teams[0].earned : 0,
    tierMix,
    finalEliteBreakevenBps,
    cohortPerUnit: {
      locked: lockedPerUnit,
      spread: spreadPerUnit,
      ratio: lockedPerUnit > 0 && spreadPerUnit > 0 ? lockedPerUnit / spreadPerUnit : 1,
    },
    refusedShare: totalDemanded > 0 ? refusedUnits / totalDemanded : 0,
  };
}

// ──────────── What to run ────────────

export const D19_SCENARIOS: GlideScenario[] = [
  { name: 'Design rate: 800 teams, 7-day ramp', teams: 800, rampDays: 7, retention: 0.5 },
  { name: 'Faucet scale: 6,000 teams, 7-day ramp', teams: 6_000, rampDays: 7, retention: 0.5 },
  { name: '15,000 teams, 7-day ramp', teams: 15_000, rampDays: 7, retention: 0.5 },
  { name: '20,000 teams, 7-day ramp', teams: 20_000, rampDays: 7, retention: 0.5 },
  { name: '30,000 teams, 7-day ramp', teams: 30_000, rampDays: 7, retention: 0.5 },
  { name: 'Surge: 20,000 teams all on day 1', teams: 20_000, rampDays: 1, retention: 0.5 },
  { name: 'Surge: 30,000 teams all on day 1', teams: 30_000, rampDays: 1, retention: 0.5 },
  { name: 'Step: 5,000 teams, then 20,000 more join on day 20', teams: 5_000, rampDays: 7, retention: 0.5, events: [{ day: 20, join: 20_000 }] },
  { name: 'Exodus: 20,000 teams, 70 % leave on day 30', teams: 20_000, rampDays: 7, retention: 0.5, events: [{ day: 30, leaveFraction: 0.7 }] },
];

/** D-C: the demand shapes the hourly controller was never modelled against (20,000 teams from day 1). */
export const SHAPE_SCENARIOS: GlideScenario[] = [
  { name: 'smooth', teams: 20_000, rampDays: 1, retention: 0.5, shape: { kind: 'smooth' } },
  { name: 'phase-locked 25 % (one hour in four)', teams: 20_000, rampDays: 1, retention: 0.5, shape: { kind: 'phaseLocked', share: 0.25 } },
  { name: 'phase-locked 50 %', teams: 20_000, rampDays: 1, retention: 0.5, shape: { kind: 'phaseLocked', share: 0.5 } },
  { name: 'phase-locked 90 %', teams: 20_000, rampDays: 1, retention: 0.5, shape: { kind: 'phaseLocked', share: 0.9 } },
  { name: 'phase-locked 100 %', teams: 20_000, rampDays: 1, retention: 0.5, shape: { kind: 'phaseLocked', share: 1 } },
  { name: 'daily rhythm: 60 % of starts in 8 of 24 h', teams: 20_000, rampDays: 1, retention: 0.5, shape: { kind: 'daily', peakShare: 0.6, peakHours: 8 } },
  { name: 'daily rhythm: 80 % of starts in 6 of 24 h', teams: 20_000, rampDays: 1, retention: 0.5, shape: { kind: 'daily', peakShare: 0.8, peakHours: 6 } },
];

/** D-C: the estimator windows under comparison, on the deployed controller. */
export const ESTIMATORS: { name: string; params: GlideParams }[] = [
  { name: 'last epoch with demand (D-19 as first shipped)', params: D19_SINGLE_EPOCH },
  { name: 'last 4 epochs (one expedition cycle) — ON-CHAIN since D-C', params: ONCHAIN },
  { name: 'last 24 epochs (a day)', params: { ...ONCHAIN, estimatorWindow: 24 } },
];

export const CANDIDATES: { name: string; params: GlideParams }[] = [
  { name: 'before D-19: 24 h epoch, ±30 %, no ceiling', params: LEGACY_DAILY },
  { name: '6 h epoch, ±30 %', params: { ...LEGACY_DAILY, epochHours: 6 } },
  { name: '4 h epoch, ±30 %', params: { ...LEGACY_DAILY, epochHours: 4 } },
  { name: '1 h epoch, ±30 %', params: { ...LEGACY_DAILY, epochHours: 1 } },
  { name: '24 h epoch, down 50 % / up 30 %', params: { ...LEGACY_DAILY, downStepBps: 5_000 } },
  { name: '24 h epoch, ±30 %, 2× epoch spend ceiling', params: { ...LEGACY_DAILY, epochSpendCapX: 2 } },
  { name: '6 h epoch, ±30 %, 2× epoch spend ceiling', params: { ...LEGACY_DAILY, epochHours: 6, epochSpendCapX: 2 } },
  { name: '4 h epoch, down 50 % / up 30 %, 2× ceiling', params: { epochHours: 4, upStepBps: 3_000, downStepBps: 5_000, epochSpendCapX: 2 } },
  { name: 'D-19 as first shipped: 1 h epoch, ±30 %, 2× ceiling, last epoch with demand', params: D19_SINGLE_EPOCH },
  { name: 'ON-CHAIN since D-C: D-19 + 4-epoch demand window', params: ONCHAIN },
  { name: 'D-19 + 24-epoch demand window (D-C runner-up)', params: { ...ONCHAIN, estimatorWindow: 24 } },
];
