/**
 * Boost epoch clock — the engine's view of the weekly grid.
 *
 * Thin wrapper over the pure `epochIdAt` / `epochWindow` functions in game-logic so the
 * epoch job takes an injected clock (tests pick any anchor) while production resolves
 * the anchor once via `getBoostEpochAnchorMs` (BOOST_EPOCH_ANCHOR_TS, else the indexed
 * season-1 start). Window E is [anchor + 7d*E, anchor + 7d*(E+1)); boosts earned in
 * window E post as chain epoch E+1.
 */
import { epochIdAt, epochWindow } from '@clawbada/game-logic';
import { getBoostEpochAnchorMs, type DbExecutor } from '@clawbada/db';

export class EpochClock {
  constructor(readonly anchorMs: number) {
    if (!Number.isFinite(anchorMs)) throw new Error(`EpochClock anchor must be a finite ms timestamp, got ${anchorMs}`);
  }

  /** Resolve the anchor from env / DB. Throws when neither source is available yet
   *  (season-1 start not indexed) — callers retry on the next tick. */
  static async fromDb(dbx: DbExecutor): Promise<EpochClock> {
    return new EpochClock(await getBoostEpochAnchorMs(dbx));
  }

  /** Window index containing `t` (negative before the anchor). */
  epochIdAt(t: Date | number): number {
    return epochIdAt(typeof t === 'number' ? t : t.getTime(), this.anchorMs);
  }

  /** Half-open window bounds of an epoch index. */
  windowOf(epochId: number): { startsAt: Date; endsAt: Date } {
    return epochWindow(epochId, this.anchorMs);
  }

  /** Window index for `now` (default: wall clock). */
  current(now: Date | number = Date.now()): number {
    return this.epochIdAt(now);
  }
}
