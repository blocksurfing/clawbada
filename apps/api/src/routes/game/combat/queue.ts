/**
 * V3 S1 Power Matchmaker — queue endpoints.
 *
 * POST   /api/game/combat/queue         — join queue (computes Team Power, attempts match)
 * GET    /api/game/combat/queue/status  — current queue status + active radius
 * DELETE /api/game/combat/queue         — leave queue
 * GET    /api/game/combat/pool-depth    — bucket counts for Team Builder UI
 *
 * The match-on-join is synchronous (UX win — instant match if opponent already
 * waiting). The global ticker (`startMatchmakerTicker`) handles "stuck waiting
 * for radius expansion" cases for players already in queue.
 */

import { Hono } from 'hono';
import { and, desc, eq, or, sql, count } from 'drizzle-orm';
import {
  STAKE_BRACKETS,
  EvolutionTier,
  DAMAGE_THRESHOLD,
  BattlePhase,
  computeTeamPower,
} from '@clawbada/game-logic';
import {
  db,
  battles,
  matchmakingQueue,
  ensureTeamRating,
  currentBoostEpochId,
} from '@clawbada/db';
import { walletAuth } from '../../../middleware/auth';
import { catchErrors, ApiError } from '../../../lib/errors';
import { readTeam, readLobster, serializeBigInts } from '../../../lib/chain';
import { battleWS } from '../../../lib/ws';
import {
  computePowerForTeam,
  tryMatchForPlayer,
  logJoinDecision,
  logCancelDecision,
} from '../../../lib/matchmaker/match';
import {
  getCurrentRadius,
  getCurrentRatingRadius,
  makePoolKey,
  MIN_TEAM_POWER,
  MAX_TEAM_POWER,
} from '../../../lib/matchmaker/bucket';

export const queueRoutes = new Hono();

// ──────────── POST /queue ────────────

queueRoutes.post(
  '/queue',
  walletAuth,
  catchErrors(async (c) => {
    const address = (c.get('address') as string).toLowerCase();
    const body = await c.req.json<{ teamId: string; stakeAmount: string }>();

    if (!body.teamId || !body.stakeAmount) {
      throw new ApiError('INVALID_INPUT', 'teamId and stakeAmount required');
    }

    const teamId = BigInt(body.teamId);
    const stakeAmount = BigInt(body.stakeAmount);

    // Resolve stake bracket index.
    const bracketIndex = STAKE_BRACKETS.findIndex((b) => b === stakeAmount);
    if (bracketIndex === -1) {
      throw new ApiError(
        'INVALID_INPUT',
        `stakeAmount must be one of: ${STAKE_BRACKETS.map(String).join(', ')}`,
      );
    }

    // Validate team ownership.
    const team = await readTeam(teamId);
    if (team.owner.toLowerCase() !== address) {
      throw new ApiError('INVALID_INPUT', 'Not the team owner');
    }
    // F-02: TeamManager.sol's `active` flag means the team is currently busy
    // (mining or in a battle), set/unset by MiningPool/BattleArena via
    // ACTIVITY_ROLE. Idle teams have active=false. The previous gate inverted
    // the check — only busy teams passed, then reverted on-chain at reveal.
    if (team.active) {
      throw new ApiError('INVALID_INPUT', 'Team is busy in another activity (mining or battle)');
    }

    // Validate every lobster: Evolved+, damage < 80.
    const lobsters = await Promise.all(team.lobsterIds.map((id) => readLobster(id)));
    for (const l of lobsters) {
      if (l.evolutionTier < EvolutionTier.Evolved) {
        throw new ApiError(
          'INSUFFICIENT_TIER',
          `Lobster #${l.tokenId} is ${EvolutionTier[l.evolutionTier]} tier, battle requires Evolved+`,
        );
      }
      if (l.damage >= DAMAGE_THRESHOLD) {
        throw new ApiError(
          'INVALID_INPUT',
          `Lobster #${l.tokenId} has ${l.damage} damage (>= ${DAMAGE_THRESHOLD}), must repair first`,
        );
      }
    }

    // M-03 fix: use the canonical computeTeamPower from @clawbada/game-logic.
    // Single source of truth — future tier additions (e.g., Mythic in S2) will
    // either be handled correctly or throw, instead of the prior inline reducer
    // silently miscounting unknown tiers as Apex.
    const powerScore = computeTeamPower(
      lobsters.map((l): EvolutionTier => l.evolutionTier),
    );

    if (powerScore < MIN_TEAM_POWER || powerScore > MAX_TEAM_POWER) {
      throw new ApiError('INVALID_INPUT', `Computed power ${powerScore} outside valid range`);
    }

    // S1 rating band (locked 2026-09-02): the queue row carries the TEAM's rating,
    // not the wallet ELO. `ensureTeamRating` is the lazy lineage safety net for a
    // team the indexer has not rated yet (fresh / inherited from the disbanded
    // roster it descends from) and forces a full re-qualification when the
    // stored Power no longer matches. Snapshotted at join so a rating change
    // mid-queue cannot shift the band under the matcher.
    let epochId: number;
    try {
      epochId = await currentBoostEpochId(db);
    } catch (err) {
      // Anchor missing = deploy misconfiguration (BOOST_EPOCH_ANCHOR_TS unset and
      // SeasonStarted not indexed). Surface it instead of a generic 500.
      const msg = err instanceof Error ? err.message : String(err);
      throw new ApiError('INTERNAL_ERROR', `Boost epoch clock unavailable: ${msg}`);
    }
    const ratingResult = await ensureTeamRating(db, {
      teamId,
      owner: address,
      lobsterIds: team.lobsterIds,
      power: powerScore,
      epochId,
    });
    const elo = ratingResult.rating;
    const requalified = ratingResult.reset;

    // F-16 / F-3K: let Postgres assign `enqueuedAt` via `defaultNow()` and
    // read it back with `RETURNING`. The previous code set the value from
    // `new Date()` on the API host, which mixed clocks with `battles.createdAt`
    // (also `defaultNow()`) and broke F-3D's `created_at > entry.enqueuedAt`
    // race-detection filter under any API/DB clock skew. Reading the
    // DB-assigned value back keeps every downstream timestamp comparison on
    // the same clock.
    // F-Y3: also surface the row's primary key `id` as the canonical queue
    // session id. Used in WS payloads + client reducer for collision-proof
    // session matching (vs `enqueuedAtMs` which can theoretically collide
    // on rapid requeue if JS-ms + Postgres-timestamp collapse).
    let enqueuedAt: Date;
    let queueId: bigint;
    try {
      const [inserted] = await db
        .insert(matchmakingQueue)
        .values({
          address,
          teamId,
          stakeBracket: bracketIndex,
          powerScore,
          elo,
        })
        .returning({
          id: matchmakingQueue.id,
          enqueuedAt: matchmakingQueue.enqueuedAt,
        });
      enqueuedAt = inserted.enqueuedAt;
      queueId = inserted.id;
    } catch (err: any) {
      // F-18: detect Postgres unique-violation via the canonical SQLSTATE
      // code (23505) plus the constraint name. Magic-string matching on
      // `err.message` was fragile — the message wording varies between
      // node-postgres versions and a future index rename would silently
      // turn the conflict into a 500 instead of a 400 "already in queue".
      const code = err?.code ?? err?.cause?.code;
      const constraint =
        err?.constraint ?? err?.constraint_name ?? err?.cause?.constraint;
      if (
        code === '23505' &&
        (constraint === 'matchmaking_queue_address_uniq' ||
          // Defensive fallback: some pg drivers omit the constraint field
          // and only put the name in the error message. Keep the legacy
          // string check as a safety net for those.
          String(err?.message ?? '').includes('matchmaking_queue_address_uniq'))
      ) {
        throw new ApiError('INVALID_INPUT', 'Already in matchmaking queue');
      }
      throw err;
    }

    const bucket = makePoolKey(bracketIndex, powerScore);

    // Push queue_joined to the player's address room (if a WS is subscribed).
    // Includes initial radius so the client can render the bucket bar.
    // F-16: `enqueuedAtMs` tags this queue session so subsequent WS events
    // (search_expanded, match_cancelled, match_found) can be matched against
    // the client's current session and stale-session events dropped.
    const initialRadius = getCurrentRadius(powerScore, 0);
    const initialRatingRadius = getCurrentRatingRadius(0);
    battleWS.notifyAddress(address, 'queue_joined', {
      bracket: bracketIndex,
      power: powerScore,
      initialRadius: { low: initialRadius.low, high: initialRadius.high },
      // `elo` kept for the existing client reducer; `rating` is the same TEAM
      // rating under its S1 name. `requalified` = the roster's Power changed and
      // the rating was reset to baseline on this join.
      elo,
      rating: elo,
      requalified,
      initialRatingRadius,
      enqueuedAtMs: enqueuedAt.getTime(),
      // F-Y3: collision-proof session id. Client reducer prefers this over
      // enqueuedAtMs for the stale-event filter.
      queueId: queueId.toString(),
    });

    // Telemetry — fire-and-forget.
    void logJoinDecision(address, bucket).catch(() => {});

    // Synchronous match attempt — if an opponent is already waiting in radius
    // they're paired immediately and both get `match_found` via WS.
    const match = await tryMatchForPlayer(address);

    if (match) {
      // B-01 fix: include `bracket` in the matched response. The client's
      // useQueueState reducer requires it to populate `MatchedState`; without
      // it the immediate-match path always trips the "incomplete payload"
      // error and dumps the user into `errored` instead of `matched`.
      return c.json(
        serializeBigInts({
          status: 'matched',
          battleId: match.battleId,
          bracket: bracketIndex,
          opponent: match.playerA === address ? match.playerB : match.playerA,
          yourPower: powerScore,
          opponentPower: match.playerA === address ? match.powerB : match.powerA,
          rating: elo,
          requalified,
        }),
      );
    }

    return c.json({
      status: 'queued',
      bracket: bracketIndex,
      power: powerScore,
      initialRadius: { low: initialRadius.low, high: initialRadius.high },
      rating: elo,
      requalified,
      initialRatingRadius,
      // F-16-a: return the server's authoritative session id. The client
      // uses this for `state.since` so stale-event filtering (which keys
      // off `enqueuedAtMs`) compares like-clocks. A client-derived
      // `Date.now()` here would diverge from the server's stored value by
      // network RTT + DB write latency, breaking the filter for normal flows.
      enqueuedAtMs: enqueuedAt.getTime(),
      // F-Y3: queue row PK as collision-proof session id. Client prefers
      // this over enqueuedAtMs when both are present.
      queueId: queueId.toString(),
    });
  }),
);

// ──────────── GET /queue/status ────────────

queueRoutes.get(
  '/queue/status',
  walletAuth,
  catchErrors(async (c) => {
    const address = (c.get('address') as string).toLowerCase();

    const [entry] = await db
      .select()
      .from(matchmakingQueue)
      .where(eq(matchmakingQueue.address, address))
      .limit(1);

    if (entry) {
      const elapsedMs = Date.now() - entry.enqueuedAt.getTime();
      const elapsedSec = Math.floor(elapsedMs / 1000);
      const radius = getCurrentRadius(entry.powerScore, elapsedSec);
      const ratingRadius = getCurrentRatingRadius(elapsedSec);
      return c.json(
        serializeBigInts({
          inQueue: true,
          bracket: entry.stakeBracket,
          power: entry.powerScore,
          // `elo` kept for the existing client reducer; `rating` is the TEAM rating.
          elo: entry.elo,
          rating: entry.elo,
          ratingRadius,
          teamId: entry.teamId,
          enqueuedAt: entry.enqueuedAt,
          // F-Y3: collision-proof session id for rehydration. Client populates
          // `state.queueId` from this so subsequent WS events compare against
          // the canonical PK rather than only the timestamp.
          queueId: entry.id,
          waitingSeconds: elapsedSec,
          radius: {
            low: radius.low,
            high: radius.high,
            halfWidth: radius.halfWidth === Infinity ? 'all' : radius.halfWidth,
          },
        }),
      );
    }

    // F-X1 (PR 6): when the player isn't queued, report any recent matched
    // battle they're a participant in so the client can rehydrate after a
    // WS reconnect that missed the original `match_found` event.
    //
    // F-Z1 (partial): the phase=Deposit filter is unreliable because the
    // indexer doesn't advance phase past Deposit (per F-3D). To minimize
    // the false-positive surface, additionally:
    // - tighten the window to 2 minutes (matches the contract's
    //   DEPOSIT_WINDOW; battles older than this either already cancelled
    //   on-chain or are progressing post-deposit)
    // - require `winner IS NULL AND settled_at IS NULL` (catches the
    //   settled case independent of phase)
    // The remaining gap (battle progressed to TeamCommit/Active within
    // 2min) is acceptable for this rehydration endpoint — the client
    // transitions to `matched` and the next user interaction with the
    // active battle screen reconciles. Full fix requires the F-3D
    // indexer phase-advance work and is tracked separately.
    // Codex PR-B FU2-M2 (MEDIUM): pick the LATEST matched-window battle
    // for this address regardless of status, then branch on its status.
    // The earlier two-query design queried `status != 4` first and only
    // looked at status=4 when no non-failed row existed → a stale
    // status=1 row would mask a newer status=4 row from a re-queue
    // attempt, and the queued UI would rehydrate to the OLD battle
    // instead of surfacing the failed-create error.
    const matchedWindowSec = 2 * 60;
    const [latest] = await db
      .select({
        battleId: battles.battleId,
        playerA: battles.playerA,
        playerB: battles.playerB,
        stakeBracket: battles.stakeBracket,
        powerA: battles.powerA,
        powerB: battles.powerB,
        status: battles.status,
      })
      .from(battles)
      .where(
        and(
          or(eq(battles.playerA, address), eq(battles.playerB, address)),
          sql`${battles.createdAt} > now() - interval '${sql.raw(String(matchedWindowSec))} seconds'`,
          eq(battles.phase, BattlePhase.Deposit),
          sql`${battles.winner} IS NULL`,
          sql`${battles.settledAt} IS NULL`,
        ),
      )
      .orderBy(desc(battles.createdAt))
      .limit(1);

    if (latest && latest.status === 4) {
      // Latest decision was a failed create — surface the explicit signal
      // so the queued reducer transitions to errored, not matched.
      return c.json(
        serializeBigInts({
          inQueue: false,
          failedRecentBattle: {
            battleId: latest.battleId,
            bracket: latest.stakeBracket,
          },
        }),
      );
    }

    if (latest) {
      // status NULL (pre-PR-B) / 0 (pending_create) / 1 (created) → matched.
      const isA = latest.playerA === address;
      return c.json(
        serializeBigInts({
          inQueue: false,
          recentBattle: {
            battleId: latest.battleId,
            bracket: latest.stakeBracket,
            opponent: isA ? latest.playerB : latest.playerA,
            yourPower: isA ? latest.powerA : latest.powerB,
            opponentPower: isA ? latest.powerB : latest.powerA,
            status: latest.status,
          },
        }),
      );
    }

    return c.json({ inQueue: false });
  }),
);

// ──────────── DELETE /queue ────────────

queueRoutes.delete(
  '/queue',
  walletAuth,
  catchErrors(async (c) => {
    const address = (c.get('address') as string).toLowerCase();

    // Capture entry before delete so we can log the elapsed wait time + push
    // a match_cancelled WS event with the right bucket info.
    const [entry] = await db
      .select()
      .from(matchmakingQueue)
      .where(eq(matchmakingQueue.address, address))
      .limit(1);

    await db.delete(matchmakingQueue).where(eq(matchmakingQueue.address, address));

    // F-15: detect cancel-vs-match race. The matchmaker may have matched this
    // player and deleted their queue row between the SELECT and DELETE above
    // (or just before either, if the user clicked Cancel right as a match was
    // forming). Without this check the API returns `removed: true` while the
    // player is now in a battle — a confusing UX where the cancel "succeeds"
    // but the player still owes a deposit.
    //
    // F-3F: cutoff uses Postgres `now()` rather than the API's `Date.now()` —
    // both `created_at` defaults to db `now()` and our cutoff are then on
    // the same clock, so API/DB clock skew can't shift the window.
    //
    // F-3D: also require `created_at > entry.enqueuedAt` when entry was
    // present. The previous phase-filter relied on the indexer advancing
    // `phase` past StakeDeposit, but the StakeDeposited handler reads a
    // non-existent `args.bothDeposited` and never advances. Without this
    // tighter filter, a player in an older active battle who queued a
    // different team would see DELETE return `matched: true` for the old
    // battle. When `entry` is null (matchmaker won the race), only the time
    // window applies — the battle MUST be very recent in that case.
    const cutoffSinceLastJoin = entry
      ? sql`${battles.createdAt} > ${entry.enqueuedAt}`
      : sql`true`;
    const [recent] = await db
      .select({
        battleId: battles.battleId,
        playerA: battles.playerA,
        playerB: battles.playerB,
        stakeBracket: battles.stakeBracket,
        powerA: battles.powerA,
        powerB: battles.powerB,
      })
      .from(battles)
      .where(
        and(
          or(eq(battles.playerA, address), eq(battles.playerB, address)),
          sql`${battles.createdAt} > now() - interval '10 seconds'`,
          cutoffSinceLastJoin,
        ),
      )
      .orderBy(desc(battles.createdAt))
      .limit(1);

    if (recent) {
      const isA = recent.playerA === address;
      return c.json({
        removed: false,
        matched: true,
        battleId: recent.battleId.toString(),
        bracket: recent.stakeBracket,
        opponent: isA ? recent.playerB : recent.playerA,
        yourPower: isA ? recent.powerA : recent.powerB,
        opponentPower: isA ? recent.powerB : recent.powerA,
      });
    }

    if (entry) {
      const elapsedSec = Math.max(0, Math.floor((Date.now() - entry.enqueuedAt.getTime()) / 1000));
      battleWS.notifyAddress(address, 'match_cancelled', {
        reason: 'self_cancel',
        elapsedSec,
        // F-16: tag with the session id this cancel was issued for; stale
        // events from a re-queued session must be ignored client-side.
        enqueuedAtMs: entry.enqueuedAt.getTime(),
        // F-Y3: collision-proof session id (DB row PK).
        queueId: entry.id.toString(),
      });
      void logCancelDecision(
        address,
        makePoolKey(entry.stakeBracket, entry.powerScore),
        elapsedSec,
      ).catch(() => {});
    }

    return c.json({ removed: true });
  }),
);

// ──────────── GET /pool-depth ────────────

/** Returns active player counts per (stake, power) sub-pool. Used by the Team
 *  Builder UI to render expected-wait-time hints before queuing. Public — no
 *  auth required (counts are not sensitive). */
queueRoutes.get(
  '/pool-depth',
  catchErrors(async (c) => {
    const bracketParam = c.req.query('bracket');
    const powerParam = c.req.query('power');

    if (bracketParam !== undefined && powerParam !== undefined) {
      // Single-bucket query.
      const bracket = Number(bracketParam);
      const power = Number(powerParam);
      const [{ value }] = await db
        .select({ value: count() })
        .from(matchmakingQueue)
        .where(
          and(
            eq(matchmakingQueue.stakeBracket, bracket),
            eq(matchmakingQueue.powerScore, power),
          ),
        );
      return c.json({ bracket, power, depth: Number(value) });
    }

    // Full table — one row per non-empty bucket.
    const rows = await db
      .select({
        bracket: matchmakingQueue.stakeBracket,
        power: matchmakingQueue.powerScore,
        depth: count(),
      })
      .from(matchmakingQueue)
      .groupBy(matchmakingQueue.stakeBracket, matchmakingQueue.powerScore);

    return c.json({
      pools: rows.map((r) => ({
        bracket: r.bracket,
        power: r.power,
        depth: Number(r.depth),
      })),
    });
  }),
);

// computePowerForTeam is exported by the matchmaker module for callers that
// want to preview a team's power without queueing. Surfaced here for symmetry
// with the queue endpoint. Could become its own route if the frontend wants
// "compute my team's power" without committing to a stake bracket.
export { computePowerForTeam };
