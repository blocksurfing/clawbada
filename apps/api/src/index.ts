import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { gameRoutes } from './routes/game';
import { agentRoutes } from './routes/agent';
import { faucetRoutes } from './routes/faucet';
import { leaderboardRoutes } from './routes/leaderboard';

const app = new Hono();

app.use('*', logger());
app.use('*', cors());

app.get('/health', (c) =>
  c.json({ status: 'ok', timestamp: Date.now(), version: '0.0.1' }),
);

app.route('/api/game', gameRoutes);
app.route('/api/agent', agentRoutes);
app.route('/api/faucet', faucetRoutes);
app.route('/api/leaderboard', leaderboardRoutes);

const port = Number(process.env.API_PORT ?? 3001);

console.log(`Clawbada API starting on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
