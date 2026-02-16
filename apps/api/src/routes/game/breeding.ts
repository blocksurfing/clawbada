import { Hono } from 'hono';

export const breedingRoutes = new Hono();

// GET /api/game/breeding/preview — preview breed cost and offspring probabilities
breedingRoutes.get('/preview', (c) => {
  const parentA = c.req.query('parentA');
  const parentB = c.req.query('parentB');
  return c.json({ todo: true, endpoint: 'breed-preview', parentA, parentB });
});

// GET /api/game/breeding/cooldowns/:lobsterId — get cooldown timer
breedingRoutes.get('/cooldowns/:lobsterId', (c) => {
  const { lobsterId } = c.req.param();
  return c.json({ todo: true, endpoint: 'breed-cooldown', lobsterId });
});

// POST /api/game/breeding/breed — breed two parents
breedingRoutes.post('/breed', async (c) => {
  const body = await c.req.json();
  // body: { parentA, parentB }
  return c.json({ todo: true, endpoint: 'breed', ...body });
});
