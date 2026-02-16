import { Hono } from 'hono';

export const agentRoutes = new Hono();

// POST /api/agent/register — register an agent address
agentRoutes.post('/register', async (c) => {
  const body = await c.req.json();
  // body: { address, openclawId?, displayName? }
  return c.json({ todo: true, endpoint: 'register-agent', ...body });
});

// GET /api/agent/profile/:address — get agent profile
agentRoutes.get('/profile/:address', (c) => {
  const { address } = c.req.param();
  return c.json({ todo: true, endpoint: 'agent-profile', address });
});

// GET /api/agent/lobsters/:address — get all lobsters owned by address
agentRoutes.get('/lobsters/:address', (c) => {
  const { address } = c.req.param();
  return c.json({ todo: true, endpoint: 'agent-lobsters', address });
});
