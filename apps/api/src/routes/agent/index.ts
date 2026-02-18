import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, agents } from '@clawbada/db';
import { decodeDNA, getBaseStats, scaleStats, EvolutionTier, LegendStatus, CLASS_NAMES, CLASS_ROLES } from '@clawbada/game-logic';
import { walletAuth } from '../../middleware/auth';
import { catchErrors, ApiError } from '../../lib/errors';
import { readLobstersByOwner, serializeBigInts } from '../../lib/chain';

export const agentRoutes = new Hono();

// POST /api/agent/register — register an agent address
agentRoutes.post(
  '/register',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;

    const existing = await db.select().from(agents).where(eq(agents.address, address.toLowerCase())).limit(1);

    if (existing.length > 0) {
      return c.json({ registered: true, agent: existing[0] });
    }

    const [agent] = await db.insert(agents).values({
      address: address.toLowerCase(),
    }).returning();

    return c.json({ registered: true, agent });
  }),
);

// GET /api/agent/profile/:address — get agent profile
agentRoutes.get(
  '/profile/:address',
  catchErrors(async (c) => {
    const { address } = c.req.param();
    const result = await db.select().from(agents).where(eq(agents.address, address.toLowerCase())).limit(1);

    if (result.length === 0) {
      // Return a default profile for unregistered agents
      return c.json({
        address: address.toLowerCase(),
        elo: 1200,
        wins: 0,
        losses: 0,
        totalBattles: 0,
        totalExpeditions: 0,
        totalBreeds: 0,
        registered: false,
      });
    }

    return c.json({ ...result[0], registered: true });
  }),
);

// GET /api/agent/lobsters/:address — get all lobsters owned by address
agentRoutes.get(
  '/lobsters/:address',
  catchErrors(async (c) => {
    const { address } = c.req.param();
    const lobsters = await readLobstersByOwner(address);

    const enriched = lobsters.map((l) => ({
      tokenId: l.tokenId.toString(),
      owner: l.owner,
      dna: l.dna.toString(),
      class: l.decoded.class,
      className: CLASS_NAMES[l.decoded.class],
      classRole: CLASS_ROLES[l.decoded.class],
      legend: l.decoded.legend === LegendStatus.Legend,
      breedType: l.decoded.breedType,
      purity: l.purity,
      evolutionTier: l.evolutionTier,
      tierName: EvolutionTier[l.evolutionTier] ?? 'Base',
      damage: l.damage,
      breedCount: l.breedCount,
      generation: l.generation,
      soulbound: l.soulbound,
      locked: l.locked,
      stats: serializeBigInts(l.stats),
      bodyParts: l.decoded.bodyParts,
    }));

    return c.json({ address, count: enriched.length, lobsters: enriched });
  }),
);
