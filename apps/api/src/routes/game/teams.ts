import { Hono } from 'hono';

export const teamRoutes = new Hono();

// GET /api/game/teams — list teams for a wallet
teamRoutes.get('/', (c) => {
  const address = c.req.query('address');
  return c.json({ todo: true, endpoint: 'list-teams', address });
});

// GET /api/game/teams/:teamId — get team details
teamRoutes.get('/:teamId', (c) => {
  const { teamId } = c.req.param();
  return c.json({ todo: true, endpoint: 'get-team', teamId });
});

// POST /api/game/teams/create — create a new team
teamRoutes.post('/create', async (c) => {
  const body = await c.req.json();
  // body: { lobsterIds: [id1, id2, id3] }
  return c.json({ todo: true, endpoint: 'create-team', ...body });
});

// POST /api/game/teams/:teamId/disband — disband a team
teamRoutes.post('/:teamId/disband', (c) => {
  const { teamId } = c.req.param();
  return c.json({ todo: true, endpoint: 'disband-team', teamId });
});
