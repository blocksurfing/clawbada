/**
 * Bucket abstraction for the V3 S1 Power Matchmaker.
 *
 * Re-exports the pure helpers from `@clawbada/game-logic/matchmaker` and adds
 * the sharding seam — a pure function from `PoolKey → shard index` so the
 * matchmaker logic never reaches into the sharding strategy directly.
 *
 * At S1 launch we run single-process / single-shard. The seam exists so
 * future sharding (when concurrent queue depth justifies it) is a one-file
 * change here, not a matchmaker rewrite. If/when we shard:
 *   - Each shard owns the queue rows for some subset of bucket keys
 *   - `bucketShardKey()` becomes the partition function (e.g. consistent hash)
 *   - The DB connection becomes shard-aware (multiple Postgres instances or
 *     a logical shard column on `matchmakingQueue`)
 *   - The ticker fans out per-shard work
 *
 * Until then, all operations use shard 0.
 */

import {
  computeTeamPower,
  getCurrentRadius,
  makePoolKey,
  poolKeyString,
  powerMatchSeverity,
  assertValidStakeBracket,
  assertValidPower,
  MIN_TEAM_POWER,
  MAX_TEAM_POWER,
  NUM_STAKE_BRACKETS,
  type PoolKey,
  type PowerRadius,
  type PowerMatchSeverity,
} from '@clawbada/game-logic';

export {
  computeTeamPower,
  getCurrentRadius,
  makePoolKey,
  poolKeyString,
  powerMatchSeverity,
  assertValidStakeBracket,
  assertValidPower,
  MIN_TEAM_POWER,
  MAX_TEAM_POWER,
  NUM_STAKE_BRACKETS,
};
export type { PoolKey, PowerRadius, PowerMatchSeverity };

/** Number of matchmaker shards. Single-process / single-shard at S1 launch. */
export const SHARD_COUNT = 1;

/** Pure function: PoolKey → shard index in [0, SHARD_COUNT). At S1 always 0.
 *  When we shard horizontally, replace the body with a stable hash like
 *  `(stakeBracket * 31 + powerScore) % SHARD_COUNT`. */
export function bucketShardKey(_key: PoolKey): number {
  return 0;
}

/** Returns true if a candidate's power lies within the seeker's match radius. */
export function powerInRadius(candidatePower: number, radius: PowerRadius): boolean {
  return candidatePower >= radius.low && candidatePower <= radius.high;
}
