import { Hono } from 'hono';

export const miningRoutes = new Hono();

// GET /api/game/mining — list active expeditions for a wallet
miningRoutes.get('/', (c) => {
  const address = c.req.query('address');
  return c.json({ todo: true, endpoint: 'list-expeditions', address });
});

// GET /api/game/mining/:expeditionId — get expedition details
miningRoutes.get('/:expeditionId', (c) => {
  const { expeditionId } = c.req.param();
  return c.json({ todo: true, endpoint: 'get-expedition', expeditionId });
});

// POST /api/game/mining/start — start a new expedition
miningRoutes.post('/start', async (c) => {
  const body = await c.req.json();
  // body: { teamId, mineTier }
  return c.json({ todo: true, endpoint: 'start-expedition', ...body });
});

// POST /api/game/mining/:expeditionId/claim — claim completed expedition
miningRoutes.post('/:expeditionId/claim', (c) => {
  const { expeditionId } = c.req.param();
  return c.json({ todo: true, endpoint: 'claim-expedition', expeditionId });
});
