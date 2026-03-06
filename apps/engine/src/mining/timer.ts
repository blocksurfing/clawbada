/**
 * Tracks active mining expeditions and notifies when they complete.
 *
 * Expeditions are 4 hours across all tiers. The timer service:
 * 1. Loads active expeditions from DB on startup
 * 2. Watches for new ExpeditionStarted events (via indexer)
 * 3. Schedules completion checks
 * 4. Notifies agents via WebSocket when expeditions are claimable
 */
import { eq, and } from 'drizzle-orm';
import { EXPEDITION_DURATION_SECONDS } from '@clawbada/game-logic';
import { db, expeditions } from '@clawbada/db';
import { log as baseLog } from '../logger';

const log = baseLog.child({ module: 'mining' });

export class MiningTimer {
  private timers: Map<string, Timer> = new Map();
  private onExpeditionComplete: ((expeditionId: bigint, owner: string) => void) | null = null;

  /** Register a callback for when an expedition completes. */
  setCompletionHandler(fn: (expeditionId: bigint, owner: string) => void): void {
    this.onExpeditionComplete = fn;
  }

  /**
   * Start tracking an expedition.
   */
  trackExpedition(expeditionId: bigint, startTime: number, owner: string): void {
    const key = expeditionId.toString();

    // Don't double-track
    if (this.timers.has(key)) return;

    const completionTime = startTime + EXPEDITION_DURATION_SECONDS;
    const now = Math.floor(Date.now() / 1000);
    const delayMs = Math.max(0, (completionTime - now) * 1000);

    const timer = setTimeout(() => {
      this.timers.delete(key);
      if (this.onExpeditionComplete) {
        this.onExpeditionComplete(expeditionId, owner);
      }
      log.info({ expeditionId: expeditionId.toString(), owner }, 'Expedition complete');
    }, delayMs);

    this.timers.set(key, timer);
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
   * Load all active (unclaimed) expeditions from DB and start tracking.
   */
  async loadActive(): Promise<number> {
    const active = await db
      .select()
      .from(expeditions)
      .where(eq(expeditions.claimed, false));

    for (const exp of active) {
      this.trackExpedition(
        exp.expeditionId,
        Number(exp.startTime),
        exp.owner,
      );
    }

    log.info({ count: active.length }, 'Mining timer loaded active expeditions');
    return active.length;
  }

  /** Get count of currently tracked expeditions. */
  get activeCount(): number {
    return this.timers.size;
  }

  /** Stop all timers on shutdown. */
  stopAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
