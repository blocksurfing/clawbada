/**
 * Season lifecycle monitoring.
 *
 * Tracks the current season, monitors emission budget usage, and makes sure the next season is
 * started on time — by the governance SAFE, not by the engine (owner decision D-25, 2026-10-01).
 * After the governance handoff no engine key holds MiningPool's SEASON_ADMIN_ROLE, and none must:
 * a hot key that can choose season numbers could print the mining allocation. So instead of
 * calling `startSeason`, the engine alarms ahead of time with the exact transaction the Safe
 * should submit:
 *   - `season_not_started`      — the contracts answer but `currentSeason()` is 0 and the indexer
 *                                 never saw a `SeasonStarted`: Configure.s.sol has not run (or ran
 *                                 against another deploy); repeats daily
 *   - `season_rollover_due`     — from ROLLOVER_DUE_AHEAD_MS before the season ends; repeats daily
 *   - `season_rollover_overdue` — the season gap: the season has ended and no new one started;
 *                                 repeats hourly (startExpedition and repeg revert SeasonNotActive
 *                                 until the Safe acts; claimExpedition still pays)
 * Runbook: docs/runbooks/season-rollover.md.
 *
 * The season is read from the chain first (`currentSeason()` + `getSeasonConfig()`), so the
 * monitor is not blind when the indexer has no `seasons` row (C-L3); the indexer's row is the
 * fallback when the RPC is down.
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
import type { Logger } from '@clawbada/logger';

/// The subset of the logger the manager uses — injectable so tests can capture alarms without
/// a process-wide module mock (bun's `mock.module` leaks into every other test file).
export type SeasonLog = Pick<Logger, 'info' | 'warn' | 'error'>;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEI = 10n ** 18n;
/** The lifetime mining allocation (MiningPool.MINING_ALLOCATION). */
export const MINING_ALLOCATION = 705_000_000n * WEI;
/** Season 1's emission (contracts/script/DeployHelpers.s.sol S1_EMISSION). */
export const S1_EMISSION = 352_500_000n * WEI;
/** Season 7's emission; from season 8 on, the schedule asks for whatever allocation is left. */
export const S7_EMISSION = 7_050_000n * WEI;
/**
 * Season 1's launch base reward (DeployHelpers S1_BASE_REWARD): the genesis rate. It caps every
 * later season's launch rate (D-B) and is the fallback when the chain is unreadable.
 */
export const S1_LAUNCH_BASE_REWARD = 1_250n * WEI;
/** The rule behind the proposed launch rate, stated in every alarm so the signer can check it. */
export const BASE_REWARD_RULE = '2× the closing rate, capped at the genesis 1,250';

/** How far ahead of the season's end the Safe is told to prepare the next one. */
export const ROLLOVER_DUE_AHEAD_MS = 3 * DAY_MS;
const DUE_REPEAT_MS = DAY_MS;
const OVERDUE_REPEAT_MS = 60 * 60 * 1000;
const NOT_STARTED_REPEAT_MS = DAY_MS;
const UNREADABLE_REPEAT_MS = DAY_MS;

export interface SeasonInfo {
  season: number;
  totalEmission: bigint;
  totalMinted: bigint;
  baseReward: bigint;
  startTime: Date;
  /** Where the record came from: the contracts, or the indexer's row when the RPC was down. */
  source: 'chain' | 'db';
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

/**
 * D-B: the next season's launch rate comes from the closing one — 2× the rate the glide settled
 * on, capped at the genesis 1,250. The glide (TOK-G1) re-pegs hourly and never above the launch
 * value, so a season that closed compressed (crowded) reopens with room to glide back up, and one
 * that closed at the cap reopens at the cap. A zero closing rate (unreadable, or season 0) is not
 * a rate: the caller falls back to the genesis value.
 */
export function nextLaunchBaseReward(closingBaseReward: bigint): bigint {
  if (closingBaseReward <= 0n) return S1_LAUNCH_BASE_REWARD;
  const doubled = 2n * closingBaseReward;
  return doubled < S1_LAUNCH_BASE_REWARD ? doubled : S1_LAUNCH_BASE_REWARD;
}

export interface RolloverPlan {
  currentSeason: number;
  nextSeason: number;
  seasonEndsAt: Date;
  /** The transaction for the Safe: MiningPool.startSeason(emission, baseReward). */
  target: Address;
  emission: bigint;
  /** How `emission` was derived — the schedule clamped to the allocation left, or the fallback note. */
  emissionRule: string;
  baseReward: bigint;
  /** The rate the glide closed the current season on (null when the chain was unreadable). */
  closingBaseReward: bigint | null;
  /** How `baseReward` was derived — BASE_REWARD_RULE, or the fallback note. */
  baseRewardRule: string;
  calldata: `0x${string}`;
  /** No allocation left: mining has ended for good; nothing to start. */
  allocationExhausted: boolean;
}

export type RolloverHandler = (season: number, emission: bigint, baseReward: bigint) => void;

/** MiningPool.getSeasonConfig, the fields the monitor needs (all wei / unix seconds). */
export interface SeasonChainConfig {
  totalEmission: bigint;
  baseReward: bigint;
  startTime: bigint;
  totalMinted: bigint;
}

/** Reads the chain for the plan; injectable for tests. */
export interface SeasonChainReader {
  lifetimeMinted(): Promise<bigint>;
  /** MiningPool.currentBaseReward(): the glide's live rate, the closing rate once the season has ended. */
  currentBaseReward(): Promise<bigint>;
  /** MiningPool.currentSeason(): 0 before Configure.s.sol / the Safe starts season 1. */
  currentSeason(): Promise<number>;
  getSeasonConfig(season: number): Promise<SeasonChainConfig>;
  /** Chain time (latest block timestamp) in ms — the contracts judge the season by block.timestamp. */
  chainNow(): Promise<number>;
}

function defaultReader(): SeasonChainReader {
  const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
  const client = getPublicClient(isTestnet);
  const pool = getMiningPool(client);
  return {
    lifetimeMinted: () => pool.read.lifetimeMinted() as Promise<bigint>,
    currentBaseReward: () => pool.read.currentBaseReward() as Promise<bigint>,
    currentSeason: async () => Number(await pool.read.currentSeason()),
    getSeasonConfig: async (season: number) => {
      const c = (await pool.read.getSeasonConfig([BigInt(season)])) as SeasonChainConfig;
      return { totalEmission: c.totalEmission, baseReward: c.baseReward, startTime: c.startTime, totalMinted: c.totalMinted };
    },
    chainNow: async () => Number((await client.getBlock({ blockTag: 'latest' })).timestamp) * 1000,
  };
}

export type RolloverAlarm = 'not_started' | 'due' | 'overdue' | 'exhausted';

export class SeasonManager {
  private pollInterval: Timer | null = null;
  private rolloverHandler: RolloverHandler | null = null;
  private lastSeenSeason: number | null = null;
  /** Last time each repeating alarm fired, by alarm name. */
  private lastAlarmAt = new Map<string, number>();

  constructor(
    private readonly reader: SeasonChainReader = defaultReader(),
    private readonly log: SeasonLog = baseLog.child({ module: 'season' }),
  ) {}

  /** Register a callback invoked when a new season shows up (started by the Safe, synced by the indexer). */
  setRolloverHandler(fn: RolloverHandler): void {
    this.rolloverHandler = fn;
  }

  /** True (and remembers `now`) when `name` has not fired in the last `repeatMs`. */
  private alarmDue(name: string, now: number, repeatMs: number): boolean {
    const last = this.lastAlarmAt.get(name) ?? 0;
    if (now - last < repeatMs) return false;
    this.lastAlarmAt.set(name, now);
    return true;
  }

  /** The indexer's latest `seasons` row (mirrored from SeasonStarted), or null before the first one. */
  async getIndexedSeason(): Promise<SeasonInfo | null> {
    const result = await db.select().from(seasons).orderBy(desc(seasons.season)).limit(1);
    if (result.length === 0) return null;
    const s = result[0];
    return {
      season: s.season,
      totalEmission: BigInt(s.totalEmission),
      totalMinted: BigInt(s.totalMinted),
      baseReward: BigInt(s.baseReward),
      startTime: s.startTime,
      source: 'db',
    };
  }

  /**
   * The current season from the contracts: `undefined` when the RPC is unreadable, `null` when
   * `currentSeason()` is 0 (nothing started yet), the config otherwise.
   */
  async getChainSeason(): Promise<SeasonInfo | null | undefined> {
    let season: number;
    try {
      season = await this.reader.currentSeason();
    } catch (err) {
      this.log.warn({ err }, 'season: currentSeason() unreadable — falling back to the indexer row');
      return undefined;
    }
    if (season === 0) return null;
    try {
      const c = await this.reader.getSeasonConfig(season);
      return {
        season,
        totalEmission: c.totalEmission,
        totalMinted: c.totalMinted,
        baseReward: c.baseReward,
        startTime: new Date(Number(c.startTime) * 1000),
        source: 'chain',
      };
    } catch (err) {
      this.log.warn({ err, season }, 'season: getSeasonConfig() unreadable — falling back to the indexer row');
      return undefined;
    }
  }

  /**
   * Current season info: the chain first (so a missing indexer row cannot blind the monitor),
   * the indexer's DB row when the chain is unreadable. Null when nothing has started anywhere.
   */
  async getCurrentSeason(): Promise<SeasonInfo | null> {
    const chain = await this.getChainSeason();
    if (chain !== undefined) return chain;
    return this.getIndexedSeason();
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
    let emission: bigint;
    let emissionRule = 'TOK-M1 schedule, clamped to the allocation left (MINING_ALLOCATION − lifetimeMinted)';
    try {
      emission = nextSeasonEmission(nextSeason, await this.reader.lifetimeMinted());
    } catch (err) {
      // The alarm must still fire during an RPC outage. The contract applies the same clamp
      // (D-20), so an unclamped proposal is safe to sign; the signer is told it is unclamped.
      emission = scheduledEmission(nextSeason);
      emissionRule = 'lifetimeMinted unreadable — TOK-M1 schedule NOT clamped to the allocation left (startSeason clamps it on-chain, D-20)';
      this.log.warn({ err }, 'season plan: lifetimeMinted unreadable — proposing the unclamped schedule');
    }
    // D-B: the launch rate is 2× the rate the glide closed on, capped at the genesis 1,250 (see
    // nextLaunchBaseReward). The glide re-pegs it hourly from there, never above it. The base
    // reward is still a governance choice: the Safe may change it before signing.
    let closingBaseReward: bigint | null = null;
    let baseReward = S1_LAUNCH_BASE_REWARD;
    let baseRewardRule = BASE_REWARD_RULE;
    try {
      closingBaseReward = await this.reader.currentBaseReward();
      baseReward = nextLaunchBaseReward(closingBaseReward);
      if (closingBaseReward <= 0n) baseRewardRule = `closing rate is 0 — proposing the genesis 1,250 (rule: ${BASE_REWARD_RULE})`;
    } catch (err) {
      baseRewardRule = `closing rate unreadable — proposing the genesis 1,250 (rule: ${BASE_REWARD_RULE})`;
      this.log.warn({ err }, 'season plan: closing base reward unreadable — proposing the genesis 1,250');
    }
    const calldata = encodeFunctionData({ abi: MiningPoolAbi, functionName: 'startSeason', args: [emission, baseReward] });
    return {
      currentSeason: current.season,
      nextSeason,
      seasonEndsAt: new Date(current.startTime.getTime() + SEASON_DURATION_DAYS * DAY_MS),
      target: addresses.miningPool,
      emission,
      emissionRule,
      baseReward,
      closingBaseReward,
      baseRewardRule,
      calldata,
      allocationExhausted: emission === 0n,
    };
  }

  /** Chain time if the RPC answers, else the wall clock (they agree within seconds on a live chain). */
  private async readNow(): Promise<number> {
    try {
      return await this.reader.chainNow();
    } catch {
      return Date.now();
    }
  }

  /**
   * One monitoring tick: notice a newly started season, and alarm when season 1 has never been
   * started, when the next season is due, or when the season has ended and the next has not
   * started (the season gap). Returns which alarm fired (if any). Never sends a transaction.
   * `now` is chain time (ms); it defaults to the latest block's timestamp.
   */
  async checkRollover(now?: number): Promise<RolloverAlarm | null> {
    const t = now ?? (await this.readNow());
    const chain = await this.getChainSeason();
    const indexed = chain === undefined || chain === null ? await this.getIndexedSeason() : null;

    if (chain === null) {
      // The contracts answer and no season exists. Configure.s.sol starts S1; until it runs,
      // mining cannot start at all. A row in the indexer means it mirrors another deploy.
      if (indexed) {
        if (this.alarmDue('season_chain_db_mismatch', t, NOT_STARTED_REPEAT_MS)) {
          this.log.warn(
            { indexedSeason: indexed.season, miningPool: addresses.miningPool },
            'season_chain_db_mismatch — currentSeason() is 0 but the indexer holds a season row (stale DB, or the wrong MiningPool address)',
          );
        }
        return null;
      }
      if (!this.alarmDue('season_not_started', t, NOT_STARTED_REPEAT_MS)) return null;
      this.log.error(
        { miningPool: addresses.miningPool, chainTime: new Date(t).toISOString() },
        'season_not_started — currentSeason() is 0 and no SeasonStarted was ever indexed: mining cannot start until startSeason runs (Configure.s.sol / the Safe)',
      );
      return 'not_started';
    }

    const current = chain ?? indexed;
    if (!current) {
      if (this.alarmDue('season_unreadable', t, UNREADABLE_REPEAT_MS)) {
        this.log.warn('season: neither the chain nor the indexer knows a season — the monitor is blind until one answers');
      }
      return null;
    }

    if (this.lastSeenSeason !== null && current.season > this.lastSeenSeason) {
      this.log.info({ season: current.season, source: current.source }, 'New season started');
      this.lastAlarmAt.clear();
      this.rolloverHandler?.(current.season, current.totalEmission, current.baseReward);
    }
    this.lastSeenSeason = current.season;

    const endsAt = current.startTime.getTime() + SEASON_DURATION_DAYS * DAY_MS;
    if (t < endsAt - ROLLOVER_DUE_AHEAD_MS) return null;

    const overdue = t >= endsAt;
    if (!this.alarmDue(overdue ? 'season_rollover_overdue' : 'season_rollover_due', t, overdue ? OVERDUE_REPEAT_MS : DUE_REPEAT_MS)) {
      return null;
    }

    const plan = await this.buildRolloverPlan(current);

    const fields = {
      currentSeason: plan.currentSeason,
      nextSeason: plan.nextSeason,
      seasonSource: current.source,
      seasonEndsAt: plan.seasonEndsAt.toISOString(),
      hoursUntilEnd: Number(((endsAt - t) / 3_600_000).toFixed(1)),
      emissionRule: plan.emissionRule,
      closingBaseReward: plan.closingBaseReward?.toString() ?? null,
      baseRewardRule: plan.baseRewardRule,
      safeTx: {
        to: plan.target,
        value: '0',
        data: plan.calldata,
        call: `MiningPool.startSeason(${plan.emission}, ${plan.baseReward})`,
      },
    };
    if (plan.allocationExhausted) {
      this.log.info(fields, 'season_allocation_exhausted — mining emissions have ended; no season to start');
      return 'exhausted';
    }
    if (overdue) {
      this.log.error(
        {
          ...fields,
          seasonGap: {
            since: plan.seasonEndsAt.toISOString(),
            hours: Number(((t - endsAt) / 3_600_000).toFixed(1)),
            effect: 'startExpedition and repeg revert SeasonNotActive; claimExpedition still pays in-flight expeditions',
          },
        },
        `season_rollover_overdue — season gap: the Safe has not started season ${plan.nextSeason}; mining pays nothing until it does (baseReward = ${BASE_REWARD_RULE})`,
      );
      return 'overdue';
    }
    this.log.error(fields, `season_rollover_due — prepare startSeason for season ${plan.nextSeason} (baseReward = ${BASE_REWARD_RULE})`);
    return 'due';
  }

  /** Start periodic monitoring (every 5 minutes). */
  startMonitor(): void {
    this.pollInterval = setInterval(async () => {
      try {
        await this.checkRollover();
        const budget = await this.checkBudget();
        if (budget && budget.percentUsed >= 90) {
          this.log.warn(
            { percentUsed: budget.percentUsed.toFixed(1), estimatedDaysRemaining: budget.estimatedDaysRemaining, remainingBudget: budget.remainingBudget.toString() },
            'Season budget warning',
          );
        }
      } catch (err) {
        this.log.error({ err }, 'Season monitor error');
      }
    }, 5 * 60 * 1000);
    this.log.info('Season monitor started (alerts the Safe; never starts a season itself)');
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
