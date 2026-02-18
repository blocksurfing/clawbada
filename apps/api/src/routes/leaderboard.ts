import { Hono } from 'hono';
import { desc, sql, eq } from 'drizzle-orm';
import { db, agents, expeditions, breeds } from '@clawbada/db';
import { catchErrors } from '../lib/errors';
import { serializeBigInts } from '../lib/chain';

export const leaderboardRoutes = new Hono();

// GET /api/leaderboard/battle — battle leaderboard (by ELO, wins)
leaderboardRoutes.get(
  '/battle',
  catchErrors(async (c) => {
    const sort = c.req.query('sort') ?? 'elo';
    const limit = Math.min(Number(c.req.query('limit') ?? '50'), 100);

    const orderBy = sort === 'wins' ? desc(agents.wins) : desc(agents.elo);

    const result = await db
      .select({
        address: agents.address,
        elo: agents.elo,
        wins: agents.wins,
        losses: agents.losses,
        totalBattles: agents.totalBattles,
      })
      .from(agents)
      .orderBy(orderBy)
      .limit(limit);

    return c.json({
      sort,
      count: result.length,
      leaderboard: result.map((r, i) => ({
        rank: i + 1,
        ...r,
        winRate: r.totalBattles > 0 ? ((r.wins / r.totalBattles) * 100).toFixed(1) + '%' : 'N/A',
      })),
    });
  }),
);

// GET /api/leaderboard/mining — mining leaderboard (by total mined)
leaderboardRoutes.get(
  '/mining',
  catchErrors(async (c) => {
    const season = c.req.query('season');
    const limit = Math.min(Number(c.req.query('limit') ?? '50'), 100);

    let conditions;
    if (season !== undefined) {
      conditions = eq(expeditions.season, Number(season));
    }

    const result = await db
      .select({
        owner: expeditions.owner,
        totalExpeditions: sql<number>`count(*)::int`.as('total_expeditions'),
        totalReward: sql<string>`sum(${expeditions.reward}::numeric)::text`.as('total_reward'),
      })
      .from(expeditions)
      .where(conditions)
      .groupBy(expeditions.owner)
      .orderBy(sql`sum(${expeditions.reward}::numeric) desc`)
      .limit(limit);

    return c.json(serializeBigInts({
      season: season ?? 'all',
      count: result.length,
      leaderboard: result.map((r, i) => ({
        rank: i + 1,
        ...r,
      })),
    }));
  }),
);

// GET /api/leaderboard/breeding — breeding leaderboard (by legends bred)
leaderboardRoutes.get(
  '/breeding',
  catchErrors(async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? '50'), 100);

    // Count breeds per breeder (using parentA owner as proxy — both parents must be owned)
    const result = await db
      .select({
        breeder: sql<string>`(
          SELECT l.owner FROM lobsters l WHERE l.token_id = ${breeds.parentA}
        )`.as('breeder'),
        totalBreeds: sql<number>`count(*)::int`.as('total_breeds'),
        totalCost: sql<string>`sum(${breeds.cost}::numeric)::text`.as('total_cost'),
      })
      .from(breeds)
      .groupBy(sql`breeder`)
      .orderBy(sql`count(*) desc`)
      .limit(limit);

    return c.json(serializeBigInts({
      count: result.length,
      leaderboard: result.map((r, i) => ({
        rank: i + 1,
        ...r,
      })),
    }));
  }),
);
