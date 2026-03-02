/**
 * Season lifecycle management.
 *
 * Tracks the current season, monitors emission budget usage,
 * and handles automatic season rollover.
 *
 * Season schedule:
 * - 60-day seasons with halving
 * - S1: 387.5M, S2: 193.75M, ... S7+: 7.75M floor
 * - Engine auto-rolls via MiningPool.startSeason() when season expires
 */
import { desc } from 'drizzle-orm';
import {
  SEASON_DURATION_DAYS,
  EXPEDITIONS_PER_DAY,
  S1_BASE_REWARD,
  getSeasonEmission,
} from '@clawbada/game-logic';
import { getOperatorClient, getPublicClient, getMiningPool } from '@clawbada/chain';
import { db, seasons } from '@clawbada/db';

export interface SeasonInfo {
  season: number;
  totalEmission: bigint;
  totalMinted: bigint;
  baseReward: bigint;
  startTime: Date;
}

export type RolloverHandler = (season: number, emission: bigint, baseReward: bigint) => void;

export class SeasonManager {
  private pollInterval: Timer | null = null;
  private rolloverHandler: RolloverHandler | null = null;

  /**
   * Register a callback invoked after a successful season rollover.
   */
  setRolloverHandler(fn: RolloverHandler): void {
    this.rolloverHandler = fn;
  }

  /**
   * Get current season info from DB (synced by indexer).
   */
  async getCurrentSeason(): Promise<SeasonInfo | null> {
    const result = await db
      .select()
      .from(seasons)
      .orderBy(desc(seasons.season))
      .limit(1);

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

  /**
   * Check if current season budget is nearing exhaustion.
   */
  async checkBudget(): Promise<{
    remainingBudget: bigint;
    percentUsed: number;
    estimatedDaysRemaining: number;
  } | null> {
    const season = await this.getCurrentSeason();
    if (!season) return null;

    const remainingBudget = season.totalEmission - season.totalMinted;
    const percentUsed =
      season.totalEmission > 0n
        ? Number((season.totalMinted * 10000n) / season.totalEmission) / 100
        : 0;

    // Estimate days remaining based on current mint rate
    const elapsedMs = Date.now() - season.startTime.getTime();
    const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
    const dailyRate = elapsedDays > 0 ? Number(season.totalMinted) / elapsedDays : 0;
    const estimatedDaysRemaining =
      dailyRate > 0 ? Number(remainingBudget) / dailyRate : SEASON_DURATION_DAYS;

    return {
      remainingBudget,
      percentUsed,
      estimatedDaysRemaining: Math.max(0, Math.round(estimatedDaysRemaining)),
    };
  }

  /**
   * Check if the current season has ended and start the next one on-chain.
   * Returns true if a rollover was executed, false otherwise.
   * Safe to call repeatedly — contract reverts with SeasonStillActive if already started.
   */
  async checkAndRollover(): Promise<boolean> {
    const current = await this.getCurrentSeason();
    if (!current) return false; // No season in DB — S1 started by Configure.s.sol

    const seasonEndMs =
      current.startTime.getTime() + SEASON_DURATION_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() < seasonEndMs) return false; // Season still active

    const nextSeason = current.season + 1;
    const emission = getSeasonEmission(nextSeason);
    const baseReward = S1_BASE_REWARD; // Admin tunes mid-season via setBaseReward()

    console.log(
      `Season ${current.season} ended. Starting season ${nextSeason} ` +
        `(emission=${emission}, baseReward=${baseReward})...`,
    );

    try {
      const txHash = await this.executeStartSeason(emission, baseReward);
      console.log(`Season ${nextSeason} started on-chain: tx=${txHash}`);

      if (this.rolloverHandler) {
        this.rolloverHandler(nextSeason, emission, baseReward);
      }

      return true;
    } catch (err) {
      console.error(`Season rollover failed:`, err);
      return false;
    }
  }

  /**
   * Execute MiningPool.startSeason() on-chain via the operator wallet.
   */
  private async executeStartSeason(
    totalEmission: bigint,
    baseReward: bigint,
  ): Promise<string> {
    const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
    const walletClient = getOperatorClient(isTestnet);
    const publicClient = getPublicClient(isTestnet);
    const pool = getMiningPool(publicClient);

    const { request } = await pool.simulate.startSeason([totalEmission, baseReward], {
      account: walletClient.account,
    });
    const txHash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    return txHash;
  }

  /**
   * Start periodic monitoring (every 5 minutes).
   * Checks for season rollover first, then budget warnings.
   */
  startMonitor(): void {
    this.pollInterval = setInterval(async () => {
      try {
        // Check rollover before budget — if season ended, start new one
        await this.checkAndRollover();

        const budget = await this.checkBudget();
        if (!budget) return;

        if (budget.percentUsed >= 90) {
          console.warn(
            `SEASON BUDGET WARNING: ${budget.percentUsed.toFixed(1)}% used, ` +
              `~${budget.estimatedDaysRemaining} days remaining, ` +
              `${budget.remainingBudget} $CLAW left`,
          );
        }
      } catch (err) {
        console.error('Season monitor error:', err);
      }
    }, 5 * 60 * 1000); // Every 5 minutes

    console.log('Season monitor started (with auto-rollover)');
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
