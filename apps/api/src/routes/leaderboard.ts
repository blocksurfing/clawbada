import { Hono } from 'hono';

export const leaderboardRoutes = new Hono();

// GET /api/leaderboard/battle — battle leaderboard (by ELO, wins)
leaderboardRoutes.get('/battle', (c) => {
  const sort = c.req.query('sort') ?? 'elo';
  const limit = c.req.query('limit') ?? '50';
  return c.json({ todo: true, endpoint: 'battle-leaderboard', sort, limit });
});

// GET /api/leaderboard/mining — mining leaderboard (by total mined)
leaderboardRoutes.get('/mining', (c) => {
  const season = c.req.query('season');
  const limit = c.req.query('limit') ?? '50';
  return c.json({ todo: true, endpoint: 'mining-leaderboard', season, limit });
});

// GET /api/leaderboard/breeding — breeding leaderboard (by legends bred)
leaderboardRoutes.get('/breeding', (c) => {
  const limit = c.req.query('limit') ?? '50';
  return c.json({ todo: true, endpoint: 'breeding-leaderboard', limit });
});
