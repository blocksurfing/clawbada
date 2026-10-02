/**
 * Season lifecycle monitoring.
 *
 * Tracks the current season, monitors emission budget usage, and makes sure the next season is
 * started on time — by the governance SAFE, not by the engine (owner decision D-25, 2026-10-01).
 * After the governance handoff no engine key holds MiningPool's SEASON_ADMIN_ROLE, and none must:
 * a hot key that can choose season numbers could print the mining allocation. So instead of
 * calling `startSeason`, the engine alarms ahead of time with the exact transaction the Safe
 * should submit:
 *   - `season_rollover_due`     — from ROLLOVER_DUE_AHEAD_MS before the season ends; repeats daily
 *   - `season_rollover_overdue` — once the season has ended and no new one started; repeats hourly
 *                                 (mining pays nothing until the Safe acts)
 * Runbook: docs/runbooks/season-rollover.md.
 *
 * Schedule (TOK-M1, 705M hard cap): S1 352.5M, halving each 60-day season through S6, S7 7.05M,
 * then whatever is left of the 705M allocation (MiningPool.startSeason clamps the emission to the
 * allocation left, D-20). The prepared transaction already applies that clamp from chain state.
 */
import { desc } from 'drizzle-orm';
import { encodeFunctionData, type Address } from 'viem';
import { SEASON_DURATION_DAYS } from '@clawbada/game-logic';
import { addresses, getPublicClient, getMiningPool, MiningPoolAbi } from '@clawbada/chain';
import { db, seasons } from '@clawbada/db';
import { log as baseLog } from '../logger';

const log = baseLog.child({ module: 'season' });

const DAY_MS = 24 * 60 * 60 * 1000;
const WEI = 10n ** 18n;
/** The lifetime mining allocation (MiningPool.MINING_ALLOCATION). */
export const MINING_ALLOCATION = 705_000_000n * WEI;
/** Season 1's emission (contracts/script/DeployHelpers.s.sol S1_EMISSION). */
export const S1_EMISSION = 352_500_000n * WEI;
/** Season 7's emission; from season 8 on, the schedule asks for whatever allocation is left. */
export const S7_EMISSION = 7_050_000n * WEI;
/** Season 1's launch base reward (DeployHelpers S1_BASE_REWARD) — the fallback when chain is unreadable. */
export const S1_LAUNCH_BASE_REWARD = 1_250n * WEI;

/** How far ahead of the season's end the Safe is told to prepare the next one. */
export const ROLLOVER_DUE_AHEAD_MS = 3 * DAY_MS;
const DUE_REPEAT_MS = DAY_MS;
const OVERDUE_REPEAT_MS = 60 * 60 * 1000;

export interface SeasonInfo {
  season: number;
  totalEmission: bigint;
  totalMinted: bigint;
  baseReward: bigint;
  startTime: Date;
}

/** The schedule's nominal emission for a season, in wei (before the allocation clamp). */
export function scheduledEmission(season: number): bigint {
  if (season < 1) throw new Error('Season must be >= 1');
  if (season <= 6) return S1_EMISSION / 2n ** BigInt(season - 1);
  if (season === 7) return S7_EMISSION;
  return MINING_ALLOCATION; // S8+: the rest of the allocation (clamped below)
}

/** What the next season's startSeason call should carry, given what is left of the allocation. */
export function nextSeasonEmission(season: number, lifetimeMinted: bigint): bigint {
  const left = MINING_ALLOCATION > lifetimeMinted ? MINING_ALLOCATION - lifetimeMinted : 0n;
  const nominal = scheduledEmission(season);
  return nominal < left ? nominal : left;
}

export interface RolloverPlan {
  currentSeason: number;
  nextSeason: number;
  seasonEndsAt: Date;
  /** The transaction for the Safe: MiningPool.startSeason(emission, baseReward). */
  target: Address;
  emission: bigint;
  baseReward: bigint;
  calldata: `0x${string}`;
  /** No allocation left: mining has ended for good; nothing to start. */
  allocationExhausted: boolean;
}

export type RolloverHandler = (season: number, emission: bigint, baseReward: bigint) => void;

/** Reads the chain for the plan; injectable for tests. */
export interface SeasonChainReader {
  lifetimeMinted(): Promise<bigint>;
  launchBaseReward(season: number): Promise<bigint>;
}

function defaultReader(): SeasonChainReader {
  const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
  const pool = getMiningPool(getPublicClient(isTestnet));
  return {
    lifetimeMinted: () => pool.read.lifetimeMinted() as Promise<bigint>,
    launchBaseReward: async (season: number) =>
      ((await pool.read.getSeasonConfig([BigInt(season)])) as { launchBaseReward: bigint }).launchBaseReward,
  };
}

export class SeasonManager {
  private pollInterval: Timer | null = null;
  private rolloverHandler: RolloverHandler | null = null;
  private lastSeenSeason: number | null = null;
  private lastDueAlarmAt = 0;
  private lastOverdueAlarmAt = 0;

  constructor(private readonly reader: SeasonChainReader = defaultReader()) {}

  /** Register a callback invoked when a new season shows up (started by the Safe, synced by the indexer). */
  setRolloverHandler(fn: RolloverHandler): void {
    this.rolloverHandler = fn;
  }

  /** Get current season info from DB (synced by indexer). */
  async getCurrentSeason(): Promise<SeasonInfo | null> {
    const result = await db.select().from(seasons).orderBy(desc(seasons.season)).limit(1);
    if (result.length === 0) return null;
    const s = result[0];
    return {
      season: s.season,
      totalEmission: BigInt(s.totalEmission),
      totalMinted: BigInt(s.totalMinted),
      baseReward: BigInt(s.baseReward),
      startTime: s.startTime,
    };
  }

  /** Check if current season budget is nearing exhaustion. */
  async checkBudget(): Promise<{ remainingBudget: bigint; percentUsed: number; estimatedDaysRemaining: number } | null> {
    const season = await this.getCurrentSeason();
    if (!season) return null;
    const remainingBudget = season.totalEmission - season.totalMinted;
    const percentUsed =
      season.totalEmission > 0n ? Number((season.totalMinted * 10000n) / season.totalEmission) / 100 : 0;
    const elapsedDays = (Date.now() - season.startTime.getTime()) / DAY_MS;
    const dailyRate = elapsedDays > 0 ? Number(season.totalMinted) / elapsedDays : 0;
    const estimatedDaysRemaining = dailyRate > 0 ? Number(remainingBudget) / dailyRate : SEASON_DURATION_DAYS;
    return { remainingBudget, percentUsed, estimatedDaysRemaining: Math.max(0, Math.round(estimatedDaysRemaining)) };
  }

  /** The transaction the Safe should submit to start the season after `current`. */
  async buildRolloverPlan(current: SeasonInfo): Promise<RolloverPlan> {
    const nextSeason = current.season + 1;
    const minted = await this.reader.lifetimeMinted();
    const emission = nextSeasonEmission(nextSeason, minted);
    // The base reward is a governance choice; the plan proposes the current season's launch reward
    // (the glide re-pegs it down daily anyway, and never above it). The Safe may change it.
    let baseReward = S1_LAUNCH_BASE_REWARD;
    try {
      const launch = await this.reader.launchBaseReward(current.season);
      if (launch > 0n) baseReward = launch;
    } catch (err) {
      log.warn({ err }, 'season plan: launch base reward unreadable — proposing the S1 value');
    }
    const calldata = encodeFunctionData({ abi: MiningPoolAbi, functionName: 'startSeason', args: [emission, baseReward] });
    return {
      currentSeason: current.season,
      nextSeason,
      seasonEndsAt: new Date(current.startTime.getTime() + SEASON_DURATION_DAYS * DAY_MS),
      target: addresses.miningPool,
      emission,
      baseReward,
      calldata,
      allocationExhausted: emission === 0n,
    };
  }

  /**
   * One monitoring tick: notice a newly started season, and alarm when the next one is due or
   * overdue. Returns which alarm fired (if any). Never sends a transaction.
   */
  async checkRollover(now: number = Date.now()): Promise<'due' | 'overdue' | 'exhausted' | null> {
    const current = await this.getCurrentSeason();
    if (!current) return null; // No season yet — S1 is started by Configure.s.sol

    if (this.lastSeenSeason !== null && current.season > this.lastSeenSeason) {
      log.info({ season: current.season }, 'New season started');
      this.lastDueAlarmAt = 0;
      this.lastOverdueAlarmAt = 0;
      this.rolloverHandler?.(current.season, current.totalEmission, current.baseReward);
    }
    this.lastSeenSeason = current.season;

    const endsAt = current.startTime.getTime() + SEASON_DURATION_DAYS * DAY_MS;
    if (now < endsAt - ROLLOVER_DUE_AHEAD_MS) return null;

    const overdue = now >= endsAt;
    const lastAt = overdue ? this.lastOverdueAlarmAt : this.lastDueAlarmAt;
    if (now - lastAt < (overdue ? OVERDUE_REPEAT_MS : DUE_REPEAT_MS)) return null;

    const plan = await this.buildRolloverPlan(current);
    if (overdue) this.lastOverdueAlarmAt = now;
    else this.lastDueAlarmAt = now;

    const fields = {
      currentSeason: plan.currentSeason,
      nextSeason: plan.nextSeason,
      seasonEndsAt: plan.seasonEndsAt.toISOString(),
      hoursUntilEnd: Number(((endsAt - now) / 3_600_000).toFixed(1)),
      safeTx: {
        to: plan.target,
        value: '0',
        data: plan.calldata,
        call: `MiningPool.startSeason(${plan.emission}, ${plan.baseReward})`,
      },
    };
    if (plan.allocationExhausted) {
      log.info(fields, 'season_allocation_exhausted — mining emissions have ended; no season to start');
      return 'exhausted';
    }
    if (overdue) {
      log.error(fields, 'season_rollover_overdue');
      return 'overdue';
    }
    log.error(fields, 'season_rollover_due');
    return 'due';
  }

  /** Start periodic monitoring (every 5 minutes). */
  startMonitor(): void {
    this.pollInterval = setInterval(async () => {
      try {
        await this.checkRollover();
        const budget = await this.checkBudget();
        if (budget && budget.percentUsed >= 90) {
          log.warn(
            { percentUsed: budget.percentUsed.toFixed(1), estimatedDaysRemaining: budget.estimatedDaysRemaining, remainingBudget: budget.remainingBudget.toString() },
            'Season budget warning',
          );
        }
      } catch (err) {
        log.error({ err }, 'Season monitor error');
      }
    }, 5 * 60 * 1000);
    log.info('Season monitor started (alerts the Safe; never starts a season itself)');
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
