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
export class SeasonManager {
  /**
   * Get current season info from DB/chain.
   *
   * TODO: Implement:
   * 1. Read current season from DB (synced by indexer)
   * 2. Return season number, emission budget, amount minted, base reward
   */
  async getCurrentSeason(): Promise<{
    season: number;
    totalEmission: bigint;
    totalMinted: bigint;
    baseReward: bigint;
    startTime: number;
  }> {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  /**
   * Check if current season budget is nearing exhaustion.
   * Used to warn admins and prepare for season transition.
   */
  async checkBudget(): Promise<{
    remainingBudget: bigint;
    percentUsed: number;
    estimatedDaysRemaining: number;
  }> {
    // TODO: Implement
    throw new Error('Not implemented');
  }
}
