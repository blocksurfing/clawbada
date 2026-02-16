import { Hono } from 'hono';

export const faucetRoutes = new Hono();

// GET /api/faucet/status/:address — check eligibility and claim status
faucetRoutes.get('/status/:address', (c) => {
  const { address } = c.req.param();
  return c.json({ todo: true, endpoint: 'faucet-status', address });
});

// POST /api/faucet/claim-lobsters — claim 5 soulbound lobsters
faucetRoutes.post('/claim-lobsters', async (c) => {
  const body = await c.req.json();
  // body: { address }
  return c.json({ todo: true, endpoint: 'claim-lobsters', ...body });
});

// POST /api/faucet/claim-claw — claim 7,000 $CLAW drip
faucetRoutes.post('/claim-claw', async (c) => {
  const body = await c.req.json();
  // body: { address }
  return c.json({ todo: true, endpoint: 'claim-claw', ...body });
});
