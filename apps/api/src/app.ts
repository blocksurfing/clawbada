/**
 * The HTTP app: middleware in the order it runs, then the routes. index.ts serves it (and owns everything that is
 * not HTTP: the WebSocket upgrade, the tickers, shutdown). Kept apart from index.ts so the order below — which is
 * what stands between the internet and the handlers — can be tested as assembled (src/__tests__/real/app.test.ts).
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createHonoLogger } from '@clawbada/logger';
import { log } from './logger';
import { gameRoutes } from './routes/game';
import { agentRoutes } from './routes/agent';
import { faucetRoutes } from './routes/faucet';
import { leaderboardRoutes } from './routes/leaderboard';
import { activityRoutes } from './routes/activity';
import { authRoutes } from './routes/auth';
import { rateLimit } from './middleware/rate-limit';
import { ApiError } from './lib/errors';
import { allowedWsOrigins, wsOriginAllowed } from './lib/ws-origin';
import { CHAIN_ONLY_PATHS, chainRoutesOnly } from './lib/chain-gate';
import { RENDER_PATH, renderRoutesOnly } from './lib/render-gate';

export const app = new Hono();

/** Everything one IP may send in a minute, on any path and with any method. A player's page stays far below it
 *  (the lobby polls 30 times a minute; the general API budget below is 100); a flood stops here. */
export const GLOBAL_REQUESTS_PER_MIN = 600;

// 1. The ceiling comes first: before the request log, so a flood is one line in the log and not one per request,
//    and before CORS, which answers preflights itself and so never reaches the limiters further down.
app.use('*', rateLimit(GLOBAL_REQUESTS_PER_MIN, 60_000, 'all'));

app.use('*', createHonoLogger());

// 2. Which web pages may call this API from a browser: the game's own (the same list that may open a socket —
//    lib/ws-origin.ts). Agents and scripts send no Origin and are not affected; they are judged by their token or
//    signature. The headers a page may send are listed, never echoed back from the request.
/** Browser origins allowed to use the API, resolved once at boot. */
const BROWSER_ORIGINS = allowedWsOrigins();
app.use('*', cors({
  origin: (origin) => (origin && wsOriginAllowed(origin, BROWSER_ORIGINS) ? origin : null),
  allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowHeaders: ['Content-Type', 'Accept', 'Authorization', 'X-Wallet-Address', 'X-Signature', 'X-Timestamp', 'X-Nonce', 'X-Auth-Domain'],
  maxAge: 600,
}));

// Global error handler for ApiError thrown from middleware
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.status as any);
  }
  log.error({ err }, 'Unhandled error');
  return c.json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }, 500);
});

// Rate limiting — applied before auth so we limit by IP for unauthenticated routes
// Playing a live battle over REST (agents without a socket, 2026-10-29: GET …/events long-poll, …/legal, POST …/turn)
// gets the socket's budget — 40 frames per 10 s = 240/min — instead of the general 100/min, which a fast agent-vs-agent
// battle (a turn a second, both sides) used to run into. Everything else keeps 100/min.
const LIVE_PLAY_PATH = /^\/api\/game\/combat\/[^/]+\/(events|legal|turn|state)$/;
const generalLimit = rateLimit(100);
const livePlayLimit = rateLimit(240, 60_000, 'play');
app.use('/api/*', (c, next) => (LIVE_PLAY_PATH.test(c.req.path) ? livePlayLimit(c, next) : generalLimit(c, next)));
// The 5/min faucet budget guards the WRITE routes (claim calldata). Since D-10 a lobster claim is
// two steps and clients poll GET /api/faucet/status/:address until the keeper has minted, so the
// read gets a budget of its own — at 5/min a wallet that polled every 2 s was locked out of its
// own claim within ten seconds.
const faucetWrites = rateLimit(5);
const faucetReads = rateLimit(60);
app.use('/api/faucet/*', (c, next) => (c.req.method === 'GET' ? faucetReads(c, next) : faucetWrites(c, next)));
// The 30/min budget guards matchmaking; live-battle turns (V3) can legitimately
// exceed it (a bot answers in under a second), so they stay on the /api/* default.
app.use('/api/game/combat/queue', rateLimit(30));
app.use('/api/game/combat/queue/*', rateLimit(30));
app.use('/api/game/combat/pool-depth', rateLimit(30));
// Guest sessions (the Dojo without a wallet) make a practice battle free to start: the token is an HMAC,
// the battle behind it is a bot and a Postgres row. Ten a minute per IP on the mint and on the start, on
// top of the practice route's own caps on live battles (PRACTICE_MAX_LIVE, and per IP: lib/live-battle-budget.ts).
app.use('/api/auth/guest', rateLimit(10, 60_000, 'guest'));
app.use('/api/game/combat/practice', rateLimit(10, 60_000, 'practice'));
// Battle Friends: creating invites is the spammable step; the lobby polls GET /rooms/:id every couple of seconds.
app.use('/api/game/friend/rooms', rateLimit(10, 60_000, 'friend-create'));
app.use('/api/game/friend/rooms/*', rateLimit(90, 60_000, 'friend'));
// One ticket per socket (re)connect; reconnect storms are already bounded by the /ws attempt limit (index.ts).
app.use('/api/auth/ws-ticket', rateLimit(60, 60_000, 'ws-ticket'));

// 3. The parts of the game that need the contracts are closed until the contracts are configured — answered here,
//    before any authentication or body parsing (lib/chain-gate.ts).
for (const path of CHAIN_ONLY_PATHS) app.use(path, chainRoutesOnly);

// 4. Drawing lobsters is closed until it is switched on (lib/render-gate.ts).
app.use(RENDER_PATH, renderRoutesOnly);

app.get('/health', (c) =>
  c.json({ status: 'ok', timestamp: Date.now(), version: '0.0.1' }),
);

app.route('/api/auth', authRoutes);
app.route('/api/game', gameRoutes);
app.route('/api/agent', agentRoutes);
app.route('/api/faucet', faucetRoutes);
app.route('/api/leaderboard', leaderboardRoutes);
app.route('/api/activity', activityRoutes);
