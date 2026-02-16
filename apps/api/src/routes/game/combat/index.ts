import { Hono } from 'hono';

export const combatRoutes = new Hono();

// POST /api/game/combat/queue — join matchmaking queue
combatRoutes.post('/queue', async (c) => {
  const body = await c.req.json();
  // body: { teamId, stakeAmount }
  return c.json({ todo: true, endpoint: 'join-queue', ...body });
});

// GET /api/game/combat/queue/status — check queue status
combatRoutes.get('/queue/status', (c) => {
  const address = c.req.query('address');
  return c.json({ todo: true, endpoint: 'queue-status', address });
});

// DELETE /api/game/combat/queue — leave matchmaking queue
combatRoutes.delete('/queue', async (c) => {
  const address = c.req.query('address');
  return c.json({ todo: true, endpoint: 'leave-queue', address });
});

// GET /api/game/combat/history — past battles for a wallet
combatRoutes.get('/history', (c) => {
  const address = c.req.query('address');
  const limit = c.req.query('limit') ?? '20';
  return c.json({ todo: true, endpoint: 'battle-history', address, limit });
});

// GET /api/game/combat/:battleId — get battle state
combatRoutes.get('/:battleId', (c) => {
  const { battleId } = c.req.param();
  return c.json({ todo: true, endpoint: 'get-battle', battleId });
});

// GET /api/game/combat/:battleId/rounds — get round history
combatRoutes.get('/:battleId/rounds', (c) => {
  const { battleId } = c.req.param();
  return c.json({ todo: true, endpoint: 'get-rounds', battleId });
});

// POST /api/game/combat/:battleId/deposit — deposit stake
combatRoutes.post('/:battleId/deposit', (c) => {
  const { battleId } = c.req.param();
  return c.json({ todo: true, endpoint: 'deposit-stake', battleId });
});

// POST /api/game/combat/:battleId/commit-team — commit team hash
combatRoutes.post('/:battleId/commit-team', async (c) => {
  const { battleId } = c.req.param();
  const body = await c.req.json();
  // body: { commitHash }
  return c.json({ todo: true, endpoint: 'commit-team', battleId, ...body });
});

// POST /api/game/combat/:battleId/reveal-team — reveal team
combatRoutes.post('/:battleId/reveal-team', async (c) => {
  const { battleId } = c.req.param();
  const body = await c.req.json();
  // body: { teamId, salt }
  return c.json({ todo: true, endpoint: 'reveal-team', battleId, ...body });
});

// POST /api/game/combat/:battleId/commit-moves — commit move hash
combatRoutes.post('/:battleId/commit-moves', async (c) => {
  const { battleId } = c.req.param();
  const body = await c.req.json();
  // body: { commitHash }
  return c.json({ todo: true, endpoint: 'commit-moves', battleId, ...body });
});

// POST /api/game/combat/:battleId/reveal-moves — reveal moves
combatRoutes.post('/:battleId/reveal-moves', async (c) => {
  const { battleId } = c.req.param();
  const body = await c.req.json();
  // body: { moveData, salt }
  return c.json({ todo: true, endpoint: 'reveal-moves', battleId, ...body });
});
