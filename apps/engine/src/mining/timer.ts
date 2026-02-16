import { EXPEDITION_DURATION_SECONDS } from '@clawbada/game-logic';

/**
 * Tracks active mining expeditions and notifies when they complete.
 *
 * Expeditions are 4 hours across all tiers. The timer service:
 * 1. Loads active expeditions from DB on startup
 * 2. Watches for new ExpeditionStarted events
 * 3. Schedules completion checks
 * 4. Notifies agents via WebSocket when expeditions are claimable
 */
export class MiningTimer {
  private timers: Map<string, Timer> = new Map();

  /**
   * Start tracking an expedition.
   *
   * TODO: Implement:
   * 1. Calculate completion time = startTime + EXPEDITION_DURATION_SECONDS
   * 2. Schedule a timer to fire at completion
   * 3. On completion: send WebSocket notification to owner
   */
  trackExpedition(_expeditionId: bigint, _startTime: number, _owner: string): void {
    // TODO: Implement
    const _completionTime = _startTime + EXPEDITION_DURATION_SECONDS;
  }

  /**
   * Stop tracking an expedition (claimed or cancelled).
   */
  untrackExpedition(expeditionId: bigint): void {
    const key = expeditionId.toString();
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  /**
   * Load all active expeditions from DB and start tracking.
   */
  async loadActive(): Promise<void> {
    // TODO: Query DB for unclaimed expeditions, track each
    throw new Error('Not implemented');
  }
}
