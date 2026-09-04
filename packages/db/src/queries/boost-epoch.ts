/**
 * Boost epoch clock — shared by the API (queue join), the indexer (participation) and the
 * engine (weekly job), so all three agree on which weekly window "now" belongs to.
 *
 * Anchor precedence:
 *   1. `BOOST_EPOCH_ANCHOR_TS` (unix seconds) — set at deploy to the season-1 start time.
 *   2. The `seasons` row for season 1 (`start_time`), mirrored from `SeasonStarted`.
 * Windows are `[anchor + E·7d, anchor + (E+1)·7d)`; index 0 is launch week.
 */

import { asc } from 'drizzle-orm';
import { epochIdAt, epochWindow } from '@clawbada/game-logic';
import { seasons } from '../schema/index';
import type { DbExecutor } from './team-ratings';

let cachedAnchorMs: number | null = null;

/** Resolve (and cache) the epoch anchor in ms. Throws if neither source is available. */
export async function getBoostEpochAnchorMs(dbx: DbExecutor): Promise<number> {
  if (cachedAnchorMs !== null) return cachedAnchorMs;
  const env = process.env.BOOST_EPOCH_ANCHOR_TS;
  if (env && env.trim() !== '' && env !== '0') {
    const secs = Number(env);
    if (!Number.isFinite(secs) || secs <= 0) throw new Error(`BOOST_EPOCH_ANCHOR_TS is not a positive unix timestamp: ${env}`);
    cachedAnchorMs = Math.floor(secs) * 1000;
    return cachedAnchorMs;
  }
  const [first] = await dbx.select({ startTime: seasons.startTime }).from(seasons).orderBy(asc(seasons.season)).limit(1);
  if (!first) {
    throw new Error('Boost epoch anchor unavailable: set BOOST_EPOCH_ANCHOR_TS or index the SeasonStarted event first');
  }
  cachedAnchorMs = first.startTime.getTime();
  return cachedAnchorMs;
}

/** Test hook: clear the cached anchor. */
export function resetBoostEpochAnchorCache(): void {
  cachedAnchorMs = null;
}

/** Window index for a moment (default now). */
export async function currentBoostEpochId(dbx: DbExecutor, atMs: number = Date.now()): Promise<number> {
  return epochIdAt(atMs, await getBoostEpochAnchorMs(dbx));
}

/** Window bounds for an epoch index. */
export async function boostEpochWindow(dbx: DbExecutor, epochId: number): Promise<{ startsAt: Date; endsAt: Date }> {
  return epochWindow(epochId, await getBoostEpochAnchorMs(dbx));
}
