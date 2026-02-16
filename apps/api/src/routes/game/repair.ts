import { Hono } from 'hono';

export const repairRoutes = new Hono();

// GET /api/game/repair/cost/:lobsterId — get repair cost estimate
repairRoutes.get('/cost/:lobsterId', (c) => {
  const { lobsterId } = c.req.param();
  const points = c.req.query('points');
  return c.json({ todo: true, endpoint: 'repair-cost', lobsterId, points });
});

// POST /api/game/repair/repair — repair a lobster
repairRoutes.post('/repair', async (c) => {
  const body = await c.req.json();
  // body: { lobsterId, pointsToRepair }
  return c.json({ todo: true, endpoint: 'repair', ...body });
});
