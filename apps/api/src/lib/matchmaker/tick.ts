/**
 * V3 S1 Power Matchmaker — global ticker.
 *
 * Single setInterval running on the API process. On each tick:
 *   1. Pick the N oldest queue rows. Older = wider radius = more likely to
 *      newly match after radius expansion. New joiners are handled by the
 *      synchronous match attempt in POST /queue, so the ticker only needs
 *      to handle "stuck waiting for expansion" cases.
 *   2. For each picked player, run `tryMatchForPlayer(address)` — idempotent,
 *      safely no-ops if the player is already matched / cancelled.
 *   3. Detect when a player's radius has just crossed an expansion threshold
 *      and emit a `search_expanded` WS event with their new bounds.
 *
 * The ticker is process-local. If we ever shard, each shard runs its own
 * ticker over its own bucket subset.
 */

import { asc } from 'drizzle-orm';
import { db, matchmakingQueue } from '@clawbada/db';
import { log as baseLog } from '../../logger';
import { battleWS } from '../ws';
import { getCurrentRadius } from './bucket';
import {
  tryMatchForPlayer,
  logExpansionDecision,
} from './match';

const log = baseLog.child({ module: 'matchmaker:tick' });

// ──────────── Tunables ────────────

/** How often the ticker runs. Faster than the smallest radius-threshold step
 *  (30 s) so expansion notifications are timely. */
const TICK_INTERVAL_MS = 5_000;

/** Maximum players evaluated per tick. At S1 launch this is well above
 *  expected concurrent queue depth. Bound exists to keep tick cost predictable
 *  if the queue ever explodes. */
const MAX_PLAYERS_PER_TICK = 200;

// ──────────── Ticker state ────────────

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/** Tracks the announcement state for each address so we only emit one
 *  `search_expanded` event per threshold crossing.
 *
 *  M-01 fix: keyed by address but tagged with the queue session's `enqueuedAtMs`.
 *  When a player matches and re-queues with a fresh `enqueuedAt`, the recorded
 *  session no longer matches the live row's session, and the entry is treated
 *  as "first sight of a new session" — preventing phantom contraction events
 *  like "halfWidth changed 1 → 0" from leaking across queue cycles. */
interface AnnouncementState {
  halfWidth: number;
  enqueuedAtMs: number;
}
const lastAnnouncedHalfWidth = new Map<string, AnnouncementState>();

// ──────────── Public API ────────────

/** Start the matchmaker ticker. Idempotent — calling twice is a no-op. */
export function startMatchmakerTicker(): void {
  if (intervalHandle !== null) {
    log.warn('startMatchmakerTicker: already running');
    return;
  }
  log.info({ intervalMs: TICK_INTERVAL_MS, maxPerTick: MAX_PLAYERS_PER_TICK }, 'matchmaker ticker started');
  intervalHandle = setInterval(() => {
    void tickMatchmaker().catch((err) => {
      log.error({ err }, 'tickMatchmaker iteration threw');
    });
  }, TICK_INTERVAL_MS);
}

/** Stop the ticker. Used by tests and graceful shutdown. */
export function stopMatchmakerTicker(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    lastAnnouncedHalfWidth.clear();
    log.info('matchmaker ticker stopped');
  }
}

/** One iteration of the ticker. Exported for tests / manual invocation. */
export async function tickMatchmaker(): Promise<void> {
  // 1. Pull the N oldest queue rows. Oldest first because they have the widest
  //    radius and are most likely to find a match this tick.
  const queueRows = await db
    .select({
      // F-Y3: surface row PK as the canonical session id for WS payloads.
      id: matchmakingQueue.id,
      address: matchmakingQueue.address,
      stakeBracket: matchmakingQueue.stakeBracket,
      powerScore: matchmakingQueue.powerScore,
      enqueuedAt: matchmakingQueue.enqueuedAt,
    })
    .from(matchmakingQueue)
    .orderBy(asc(matchmakingQueue.enqueuedAt))
    .limit(MAX_PLAYERS_PER_TICK);

  // GC the announcement map for addresses no longer in queue.
  const liveAddresses = new Set(queueRows.map((r) => r.address));
  for (const addr of lastAnnouncedHalfWidth.keys()) {
    if (!liveAddresses.has(addr)) lastAnnouncedHalfWidth.delete(addr);
  }

  for (const row of queueRows) {
    const enqueuedAtMs = row.enqueuedAt.getTime();
    const elapsedMs = Date.now() - enqueuedAtMs;
    const elapsedSec = Math.floor(elapsedMs / 1000);
    const radius = getCurrentRadius(row.powerScore, elapsedSec);

    // 2. Emit search_expanded if this player just crossed a threshold WITHIN
    //    the current queue session. M-01 fix: a stale state from a prior
    //    session (matched-then-rejoined) is treated as "first sight" via the
    //    enqueuedAtMs tag, never as a phantom transition.
    const last = lastAnnouncedHalfWidth.get(row.address);
    const sameSession = last !== undefined && last.enqueuedAtMs === enqueuedAtMs;

    if (!sameSession) {
      // First time we've seen this queue session (either fresh join or
      // post-restart pickup). Record current half-width without emitting —
      // the queue_joined event from POST /queue already covered the initial
      // state for fresh joins, and post-restart we don't fire a synthetic
      // expansion the player can't act on.
      lastAnnouncedHalfWidth.set(row.address, { halfWidth: radius.halfWidth, enqueuedAtMs });
    } else if (last.halfWidth !== radius.halfWidth) {
      // Threshold crossed inside the live session — emit + update.
      lastAnnouncedHalfWidth.set(row.address, { halfWidth: radius.halfWidth, enqueuedAtMs });
      battleWS.notifyAddress(row.address, 'search_expanded', {
        newRadius: { low: radius.low, high: radius.high },
        halfWidth: radius.halfWidth === Infinity ? 'all' : radius.halfWidth,
        atElapsed: elapsedSec,
        // F-16: tag the queue session this expansion belongs to. Without it,
        // a player who matched and re-queued could see expansion events
        // intended for their PRIOR session and incorrectly mutate their new
        // session's radius display.
        enqueuedAtMs,
        // F-Y3: collision-proof session id (DB row PK).
        queueId: row.id.toString(),
      });
      void logExpansionDecision(
        row.address,
        { stakeBracket: row.stakeBracket, powerScore: row.powerScore },
        elapsedSec,
        radius.halfWidth,
      ).catch((err) => log.warn({ err }, 'logExpansionDecision failed'));
    }

    // 3. Try to match. Idempotent — safe even if the player just got matched
    //    by a concurrent POST /queue from somewhere else.
    try {
      const result = await tryMatchForPlayer(row.address);
      if (result) {
        // Both players are now out of queue; announcement state cleared on
        // next tick when liveAddresses no longer contains them.
        log.debug(
          {
            battleId: result.battleId.toString(),
            playerA: result.playerA,
            playerB: result.playerB,
          },
          'ticker matched a pair',
        );
      }
    } catch (err) {
      log.warn({ err, address: row.address }, 'tryMatchForPlayer failed in tick');
    }
  }
}
