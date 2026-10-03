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
}

/** The contract as it will deploy (D-19, 2026-10-02): hourly, ±30 %, 2x ceiling. */
export const ONCHAIN: GlideParams = { epochHours: 1, upStepBps: 3_000, downStepBps: 3_000, epochSpendCapX: 2 };
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
  /** Units served in the last completed epoch with demand, as `trailingWeightServed`. */
  trailing: bigint;
}

export function newGlideState(emission: bigint, launch: bigint, lifetimeMintedBefore = 0n): GlideState {
  return { base: launch, launch, emission, minted: 0n, lifetimeMinted: lifetimeMintedBefore, lastEpoch: 0, servedBps: 0n, trailing: 0n };
}

/** `_repegIfNeeded`, exactly. Call at the first touch of each epoch. */
export function repegIfNeeded(s: GlideState, epoch: number, totalEpochs: number, p: GlideParams): void {
  if (epoch === s.lastEpoch) return; // epoch 0 is blind: lastRepegEpoch starts at 0
  if (s.servedBps > 0n) s.trailing = s.servedBps / BPS;
  s.servedBps = 0n;
  s.lastEpoch = epoch;
  const trailing = s.trailing;
  if (trailing === 0n) return;

  const epochsLeft = epoch >= totalEpochs ? 1 : totalEpochs - epoch; // D-18: counts this epoch
  let left = s.emission > s.minted ? s.emission - s.minted : 0n;
  const allocationLeft = MINING_ALLOCATION_WEI > s.lifetimeMinted ? MINING_ALLOCATION_WEI - s.lifetimeMinted : 0n; // D-20
  if (allocationLeft < left) left = allocationLeft;
  if (left < s.base) return; // D-19(c): less than one Base reward left is not a demand signal — hold

  const target = left / (BigInt(epochsLeft) * trailing);
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

export interface GlideScenario {
  name: string;
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
  unspentClaw: number;
  /** Cumulative season earnings (CLAW) of a team that arrived on day 1. */
  day1TeamEarnings: number;
  /** Teams per tier at season end. */
  tierMix: number[];
  /** Battle-layer stress: breakeven base boost (bps) for an Elite team at the final reward (season.ts). */
  finalEliteBreakevenBps: number;
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
  let exhaustionDay: number | null = null;
  let zeroIncomeDays = 0;
  let maxDayOverspendX = 0;
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
      const unitsBps = BigInt(Math.round(units * 10_000));

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
      }

      const demand = (s.base * unitsBps) / BPS;
      let served = 1;
      let mintedNow = demand;
      if (demand > payable) {
        // Only `payable` can be minted; the rest of this epoch's expeditions cannot start. Minting
        // exactly `payable` keeps the budget's remainder exact (0 once exhausted — the case the
        // contract's D-19(c) hold covers; the dust case is probed on the contract itself).
        served = demand > 0n ? Number(payable) / Number(demand) : 0;
        mintedNow = payable;
        if (demand > left && exhaustionDay === null) exhaustionDay = day;
      }
      s.minted += mintedNow;
      s.lifetimeMinted += mintedNow;
      s.servedBps += BigInt(Math.round(Number(unitsBps) * served));

      const perUnit = (Number(s.base) / 1e18) * served;
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

  return {
    exhaustionDay,
    zeroIncomeDays,
    rewardByDay,
    mintedShareByDay,
    maxDayOverspendX,
    unspentClaw: Number(s.emission - s.minted) / 1e18,
    day1TeamEarnings: teams.length ? teams[0].earned : 0,
    tierMix,
    finalEliteBreakevenBps,
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

export const CANDIDATES: { name: string; params: GlideParams }[] = [
  { name: 'before D-19: 24 h epoch, ±30 %, no ceiling', params: LEGACY_DAILY },
  { name: '6 h epoch, ±30 %', params: { ...LEGACY_DAILY, epochHours: 6 } },
  { name: '4 h epoch, ±30 %', params: { ...LEGACY_DAILY, epochHours: 4 } },
  { name: '1 h epoch, ±30 %', params: { ...LEGACY_DAILY, epochHours: 1 } },
  { name: '24 h epoch, down 50 % / up 30 %', params: { ...LEGACY_DAILY, downStepBps: 5_000 } },
  { name: '24 h epoch, ±30 %, 2× epoch spend ceiling', params: { ...LEGACY_DAILY, epochSpendCapX: 2 } },
  { name: '6 h epoch, ±30 %, 2× epoch spend ceiling', params: { ...LEGACY_DAILY, epochHours: 6, epochSpendCapX: 2 } },
  { name: '4 h epoch, down 50 % / up 30 %, 2× ceiling', params: { epochHours: 4, upStepBps: 3_000, downStepBps: 5_000, epochSpendCapX: 2 } },
  { name: 'ON-CHAIN since D-19: 1 h epoch, ±30 %, 2× ceiling', params: ONCHAIN },
];
