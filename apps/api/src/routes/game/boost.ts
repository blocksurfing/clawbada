/**
 * Battle-rank mining boost - public reads (S1, locked 2026-09-02).
 *
 * GET /api/game/boost/epoch          - current + next weekly window, live chain epoch, schedule
 * GET /api/game/boost/team/:teamId   - rating, played-vs-floor, live/previous boost, lineage
 * GET /api/game/boost/leaderboard    - the posted ladder for a chain epoch (team_boosts)
 * GET /api/game/boost/ladder         - live projection: what would post if the window ended now
 *
 * No wallet auth: everything here derives from public chain events, and agents plan
 * their week around the ladder. Read-only views over tables the indexer (ratings,
 * participation) and the engine epoch job (boost_epochs, team_boosts) write.
 *
 * Epoch vocabulary: `epochId` is the weekly WINDOW index (boosts are earned in it);
 * `chainEpoch = epochId + 1` is what MiningPool activates for the following week.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  BOOST_MIN_BPS,
  BOOST_MAX_BPS,
  MIN_TEAM_POWER,
  MAX_TEAM_POWER,
  RATING_RADIUS_CAP,
  RATING_RADIUS_THRESHOLDS,
  floorPlayedForEpoch,
  rankQualified,
} from '@clawbada/game-logic';
import {
  db,
  teams,
  teamRatings,
  battleParticipation,
  boostEpochs,
  teamBoosts,
  currentBoostEpochId,
  boostEpochWindow,
} from '@clawbada/db';
import { catchErrors, ApiError } from '../../lib/errors';
import { serializeBigInts } from '../../lib/chain';

export const boostRoutes = new Hono();

// ──────────── Helpers ────────────

type BoostEpochRow = typeof boostEpochs.$inferSelect;
type TeamBoostRow = typeof teamBoosts.$inferSelect;

/** Window descriptor: the announced row when the job has written one (its floor may
 *  be an ops override), otherwise computed from the anchor - same numbers. */
async function describeEpoch(epochId: number, row: BoostEpochRow | undefined) {
  const window = row ? { startsAt: row.startsAt, endsAt: row.endsAt } : await boostEpochWindow(db, epochId);
  return {
    epochId,
    chainEpoch: epochId + 1,
    startsAt: window.startsAt.toISOString(),
    endsAt: window.endsAt.toISOString(),
    floorPlayed: row ? row.floorPlayed : floorPlayedForEpoch(epochId),
    status: row?.status ?? null,
    announced: row !== undefined,
  };
}

/** Announced floor wins over the ramp schedule (ops can override a week ahead). */
async function floorForEpoch(epochId: number): Promise<number> {
  const [row] = await db.select().from(boostEpochs).where(eq(boostEpochs.epochId, epochId)).limit(1);
  return row ? row.floorPlayed : floorPlayedForEpoch(epochId);
}

/** Latest activated epoch, or chainEpoch 0 when nothing has been posted yet
 *  (mirrors MiningPool.currentBoostEpoch == 0 at deploy). */
async function liveChainEpoch(): Promise<{ chainEpoch: number; row: BoostEpochRow | null }> {
  const [row] = await db
    .select()
    .from(boostEpochs)
    .where(eq(boostEpochs.status, 'activated'))
    .orderBy(desc(boostEpochs.chainEpoch))
    .limit(1);
  return { chainEpoch: row?.chainEpoch ?? 0, row: row ?? null };
}

function parseTeamId(raw: string | undefined): bigint {
  if (!raw || !/^\d+$/.test(raw)) {
    throw new ApiError('INVALID_INPUT', 'teamId must be a non-negative integer');
  }
  return BigInt(raw);
}

/** limit/offset query params, clamped. NaN falls back to the defaults. */
function parsePage(c: Context, defaults: { limit: number; max: number }): { limit: number; offset: number } {
  const limitRaw = Number(c.req.query('limit') ?? defaults.limit);
  const offsetRaw = Number(c.req.query('offset') ?? 0);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.floor(limitRaw), 1), defaults.max)
    : defaults.limit;
  const offset = Number.isFinite(offsetRaw) ? Math.max(Math.floor(offsetRaw), 0) : 0;
  return { limit, offset };
}

function serializeTeamBoost(r: TeamBoostRow) {
  return {
    epochId: r.epochId,
    teamId: r.teamId,
    earnedEpochId: r.earnedEpochId,
    rating: r.rating,
    rank: r.rank,
    // pg numeric arrives as a string.
    percentile: Number(r.percentile),
    boostBps: r.boostBps,
    power: r.power,
    gamesPlayed: r.gamesPlayed,
    batchIndex: r.batchIndex,
    txHash: r.txHash,
  };
}

function serializeLiveEpoch(row: BoostEpochRow | null) {
  if (!row) return null;
  return {
    chainEpoch: row.chainEpoch,
    earnedEpochId: row.epochId,
    qualifiedCount: row.qualifiedCount,
    ratedCount: row.ratedCount,
    lapsedCount: row.lapsedCount,
    avgBoostBps: row.avgBoostBps,
    activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
    activateTxHash: row.activateTxHash,
  };
}

// ──────────── GET /epoch ────────────

boostRoutes.get(
  '/epoch',
  catchErrors(async (c) => {
    const now = Date.now();
    const epochId = await currentBoostEpochId(db, now);
    const rows = await db
      .select()
      .from(boostEpochs)
      .where(inArray(boostEpochs.epochId, [epochId, epochId + 1]));
    const byId = new Map(rows.map((r) => [r.epochId, r]));
    const current = await describeEpoch(epochId, byId.get(epochId));
    const next = await describeEpoch(epochId + 1, byId.get(epochId + 1));
    const live = await liveChainEpoch();

    return c.json({
      current: {
        ...current,
        secondsRemaining: Math.max(0, Math.floor((new Date(current.endsAt).getTime() - now) / 1000)),
      },
      next,
      live: serializeLiveEpoch(live.row),
      schedule: { minBps: BOOST_MIN_BPS, maxBps: BOOST_MAX_BPS },
      radius: {
        // [elapsedSec, halfWidth] pairs - same shape as the Power table.
        rating: RATING_RADIUS_THRESHOLDS.map(([elapsedSec, halfWidth]) => [elapsedSec, halfWidth]),
        cap: RATING_RADIUS_CAP,
      },
    });
  }),
);

// ──────────── GET /team/:teamId ────────────

boostRoutes.get(
  '/team/:teamId',
  catchErrors(async (c) => {
    const teamId = parseTeamId(c.req.param('teamId'));

    const [rating] = await db.select().from(teamRatings).where(eq(teamRatings.teamId, teamId)).limit(1);
    if (!rating) {
      throw new ApiError('NOT_FOUND', `Team #${teamId} has no rating yet (rated on first queue join)`);
    }

    const epochId = await currentBoostEpochId(db);
    const floorPlayed = await floorForEpoch(epochId);

    // The ledger is authoritative; the cached counter on team_ratings is returned
    // alongside so a drift between the two is visible in telemetry.
    const [played] = await db
      .select({ value: count() })
      .from(battleParticipation)
      .where(and(eq(battleParticipation.teamId, teamId), eq(battleParticipation.epochId, epochId)));
    const gamesPlayedEpoch = Number(played?.value ?? 0);

    const { chainEpoch } = await liveChainEpoch();
    const boostRows: TeamBoostRow[] =
      chainEpoch > 0
        ? await db
            .select()
            .from(teamBoosts)
            .where(and(eq(teamBoosts.teamId, teamId), inArray(teamBoosts.epochId, [chainEpoch, chainEpoch - 1])))
        : [];
    const live = boostRows.find((r) => r.epochId === chainEpoch) ?? null;
    const previous = boostRows.find((r) => r.epochId === chainEpoch - 1) ?? null;

    return c.json(
      serializeBigInts({
        teamId,
        owner: rating.owner,
        rating: rating.rating,
        power: rating.power,
        epochId,
        chainEpoch,
        gamesPlayedEpoch,
        cachedGamesPlayedEpoch: rating.gamesPlayedEpoch,
        // Window the cached counter refers to; differs from `epochId` until the
        // team's first battle of the new window bumps it.
        cachedEpochId: rating.epochId,
        floorPlayed,
        onTrack: gamesPlayedEpoch >= floorPlayed,
        wins: rating.wins,
        losses: rating.losses,
        gamesPlayedTotal: rating.gamesPlayedTotal,
        lastBattleAt: rating.lastBattleAt ? rating.lastBattleAt.toISOString() : null,
        live: live ? serializeTeamBoost(live) : null,
        previous: previous ? serializeTeamBoost(previous) : null,
        lapsed: previous !== null && live === null,
        lineage: {
          parentTeamId: rating.lineageParentId,
          shared: rating.lineageShared,
          reason: rating.lineageReason,
        },
      }),
    );
  }),
);

// ──────────── GET /leaderboard ────────────

boostRoutes.get(
  '/leaderboard',
  catchErrors(async (c) => {
    const epochParam = c.req.query('epoch');
    let epoch: number;
    if (epochParam === undefined) {
      epoch = (await liveChainEpoch()).chainEpoch;
    } else {
      epoch = Number(epochParam);
      if (!Number.isInteger(epoch) || epoch < 0) {
        throw new ApiError('INVALID_INPUT', 'epoch must be a non-negative integer (chain epoch)');
      }
    }
    const { limit, offset } = parsePage(c, { limit: 100, max: 500 });

    const rows = await db
      .select()
      .from(teamBoosts)
      .where(eq(teamBoosts.epochId, epoch))
      .orderBy(asc(teamBoosts.rank), asc(teamBoosts.teamId))
      .limit(limit)
      .offset(offset);
    const [total] = await db.select({ value: count() }).from(teamBoosts).where(eq(teamBoosts.epochId, epoch));

    return c.json(
      serializeBigInts({
        epoch,
        count: rows.length,
        total: Number(total?.value ?? 0),
        limit,
        offset,
        rows: rows.map(serializeTeamBoost),
      }),
    );
  }),
);

// ──────────── GET /ladder ────────────

/** What the epoch job would post if the current window ended now: live teams with
 *  played >= floor this window, ranked with the same `rankQualified` the job uses. */
boostRoutes.get(
  '/ladder',
  catchErrors(async (c) => {
    const epochId = await currentBoostEpochId(db);
    const floorPlayed = await floorForEpoch(epochId);

    const played = sql<number>`count(${battleParticipation.battleId})::int`;
    const candidates = await db
      .select({
        teamId: teamRatings.teamId,
        owner: teamRatings.owner,
        rating: teamRatings.rating,
        power: teamRatings.power,
        played,
      })
      .from(teamRatings)
      .innerJoin(teams, eq(teams.teamId, teamRatings.teamId))
      .innerJoin(
        battleParticipation,
        and(eq(battleParticipation.teamId, teamRatings.teamId), eq(battleParticipation.epochId, epochId)),
      )
      .where(
        and(
          isNull(teams.disbandedAt),
          gte(teamRatings.power, MIN_TEAM_POWER),
          lte(teamRatings.power, MAX_TEAM_POWER),
        ),
      )
      .groupBy(teamRatings.teamId, teamRatings.owner, teamRatings.rating, teamRatings.power)
      .having(sql`count(${battleParticipation.battleId}) >= ${floorPlayed}`);

    const ranked = rankQualified(candidates.map((r) => ({ teamId: r.teamId, rating: r.rating })));
    const byTeam = new Map(candidates.map((r) => [r.teamId.toString(), r]));
    const rows = ranked.map((r) => {
      const src = byTeam.get(r.teamId.toString())!;
      return {
        teamId: r.teamId,
        owner: src.owner,
        rating: r.rating,
        power: src.power,
        gamesPlayed: Number(src.played),
        rank: r.rank,
        percentile: r.percentile,
        boostBps: r.boostBps,
      };
    });

    return c.json(
      serializeBigInts({
        epochId,
        chainEpoch: epochId + 1,
        floorPlayed,
        qualifiedCount: rows.length,
        rows,
      }),
    );
  }),
);
