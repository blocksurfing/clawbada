// ── Env validation (fail fast) ──
{
  const required = ['DATABASE_URL'];
  const isMainnet = process.env.CHAIN_ENV === 'mainnet';
  required.push(isMainnet ? 'BASE_RPC_URL' : 'BASE_SEPOLIA_RPC_URL');

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[api] Missing required environment variables:\n  ${missing.join('\n  ')}`);
    console.error('Copy .env.example to .env and fill in values.');
    process.exit(1);
  }
}

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { gameRoutes } from './routes/game';
import { agentRoutes } from './routes/agent';
import { faucetRoutes } from './routes/faucet';
import { leaderboardRoutes } from './routes/leaderboard';
import { walletAuth } from './middleware/auth';
import { rateLimit } from './middleware/rate-limit';
import { ApiError } from './lib/errors';
import { battleWS } from './lib/ws';

const app = new Hono();

app.use('*', logger());
app.use('*', cors());

// Global error handler for ApiError thrown from middleware
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.status as any);
  }
  console.error('Unhandled error:', err);
  return c.json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }, 500);
});

// Rate limiting — applied before auth so we limit by IP for unauthenticated routes
app.use('/api/*', rateLimit(100));
app.use('/api/faucet/*', rateLimit(5));
app.use('/api/game/combat/*', rateLimit(30));

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
  websocket: {
    open(ws: WebSocket & { data?: { battleId?: string; address?: string } }) {
      const { battleId, address } = ws.data ?? {};
      if (battleId && address) {
        battleWS.join(battleId, ws, address);
      }
    },
    close(ws: WebSocket & { data?: { battleId?: string } }) {
      const { battleId } = ws.data ?? {};
      if (battleId) {
        battleWS.leave(battleId, ws);
      }
    },
    message(_ws: WebSocket, _message: string | Buffer) {
      // Battle WS is server-push only — no client messages expected
    },
  },
};
