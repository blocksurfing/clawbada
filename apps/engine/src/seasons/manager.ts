/**
 * Season lifecycle management.
 *
 * Tracks the current season, monitors emission budget usage,
 * and handles season transitions.
 *
 * Season schedule:
 * - 60-day seasons with halving
 * - S1: 387.5M, S2: 193.75M, ... S7+: 7.75M floor
 * - Admin starts each season via MiningPool.startSeason()
 */
import { desc } from 'drizzle-orm';
import { SEASON_DURATION_DAYS, EXPEDITIONS_PER_DAY } from '@clawbada/game-logic';
import { db, seasons } from '@clawbada/db';

export interface SeasonInfo {
  season: number;
  totalEmission: bigint;
  totalMinted: bigint;
  baseReward: bigint;
  startTime: Date;
}

export class SeasonManager {
  private pollInterval: Timer | null = null;

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
   * Start periodic budget monitoring (every 5 minutes).
   * Logs warnings when budget is running low.
   */
  startMonitor(): void {
    this.pollInterval = setInterval(async () => {
      try {
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

    console.log('Season monitor started');
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
