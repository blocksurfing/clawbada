import { Hono } from 'hono';

export const evolutionRoutes = new Hono();

// GET /api/game/evolution/cost/:lobsterId — get evolution cost for a lobster
evolutionRoutes.get('/cost/:lobsterId', (c) => {
  const { lobsterId } = c.req.param();
  return c.json({ todo: true, endpoint: 'evolution-cost', lobsterId });
});

// POST /api/game/evolution/evolve — evolve a lobster
evolutionRoutes.post('/evolve', async (c) => {
  const body = await c.req.json();
  // body: { lobsterId, fuelId1, fuelId2 }
  return c.json({ todo: true, endpoint: 'evolve', ...body });
});
