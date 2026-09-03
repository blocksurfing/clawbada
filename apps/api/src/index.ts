// ── Env validation (fail fast) ──
{
  const required = ['DATABASE_URL', 'MATCHMAKER_ADDRESS'];
  const isMainnet = process.env.CHAIN_ENV === 'mainnet';
  required.push(isMainnet ? 'BASE_RPC_URL' : 'BASE_SEPOLIA_RPC_URL');

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[api] Missing required environment variables:\n  ${missing.join('\n  ')}`);
    console.error('Copy .env.example to .env and fill in values.');
    process.exit(1);
  }

  const mm = process.env.MATCHMAKER_ADDRESS!;
  if (!/^0x[0-9a-fA-F]{40}$/.test(mm)) {
    console.error(`[api] MATCHMAKER_ADDRESS must be a 0x-prefixed 20-byte address, got: ${mm}`);
    process.exit(1);
  }
}

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { eq } from 'drizzle-orm';
import { createHonoLogger } from '@clawbada/logger';
import { db, battles } from '@clawbada/db';
import { log } from './logger';
import { gameRoutes } from './routes/game';
import { agentRoutes } from './routes/agent';
import { faucetRoutes } from './routes/faucet';
import { leaderboardRoutes } from './routes/leaderboard';
import { activityRoutes } from './routes/activity';
import { walletAuth, verifyWalletSignature, WS_AUTH_LIFETIME_SEC } from './middleware/auth';
import { rateLimit } from './middleware/rate-limit';
import { ApiError } from './lib/errors';
import { battleWS } from './lib/ws';
import { startMatchmakerTicker } from './lib/matchmaker/tick';
import { getClientIp } from './lib/client-ip';

const app = new Hono();

app.use('*', createHonoLogger());
app.use('*', cors());

// Global error handler for ApiError thrown from middleware
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.status as any);
  }
  log.error({ err }, 'Unhandled error');
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
app.route('/api/activity', activityRoutes);

const port = Number(process.env.API_PORT ?? 3001);

log.info({ port }, 'Clawbada API starting');

// V3 S1: start the Power Matchmaker global ticker (5s interval). Runs in this
// process for the lifetime of the API server. Idempotent if reload-restarted.
startMatchmakerTicker();

// F-2B: WS-specific rate limiting. The Hono `rateLimit('/api/*')` middleware
// doesn't cover `/ws` (handled in this top-level fetch before delegating).
// Caps:
//   - per IP, max 30 upgrade ATTEMPTS per rolling minute (covers reconnect)
//   - per address, max 8 CONCURRENT live sockets (covers tabs + dev tools)
// Counters are process-local; horizontal scaling will need a shared store.
const WS_PER_IP_MAX_PER_MIN = 30;
const WS_PER_IP_WINDOW_MS = 60_000;
const WS_PER_ADDRESS_MAX_CONCURRENT = 8;
const wsAttemptsByIp = new Map<string, number[]>();
const wsLiveByAddress = new Map<string, number>();

// F-2I/F-2O: client-IP resolution moved to `./lib/client-ip` so the same
// trust policy applies to BOTH the WS upgrade handler and the REST rate
// limiter. The previous implementation lived only in this file and the REST
// middleware kept reading the spoofable `X-Forwarded-For` header directly.

function checkAndIncrIpAttempts(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - WS_PER_IP_WINDOW_MS;
  const arr = (wsAttemptsByIp.get(ip) ?? []).filter((t) => t > cutoff);
  if (arr.length >= WS_PER_IP_MAX_PER_MIN) {
    wsAttemptsByIp.set(ip, arr);
    return false;
  }
  arr.push(now);
  wsAttemptsByIp.set(ip, arr);
  return true;
}

/** F-2L: periodic sweep so idle IPs don't accumulate Map entries forever.
 *  Runs every minute and removes any key whose recent-attempts window is
 *  empty after re-filtering. Cheap relative to the in-process Map size. */
const WS_ATTEMPTS_GC_INTERVAL_MS = 60_000;
setInterval(() => {
  const cutoff = Date.now() - WS_PER_IP_WINDOW_MS;
  for (const [ip, arr] of wsAttemptsByIp) {
    const fresh = arr.filter((t) => t > cutoff);
    if (fresh.length === 0) wsAttemptsByIp.delete(ip);
    else if (fresh.length !== arr.length) wsAttemptsByIp.set(ip, fresh);
  }
}, WS_ATTEMPTS_GC_INTERVAL_MS).unref?.();

function tryReserveAddressSlot(address: string): boolean {
  const lower = address.toLowerCase();
  const live = wsLiveByAddress.get(lower) ?? 0;
  if (live >= WS_PER_ADDRESS_MAX_CONCURRENT) return false;
  wsLiveByAddress.set(lower, live + 1);
  return true;
}

function releaseAddressSlot(address: string): void {
  const lower = address.toLowerCase();
  const live = wsLiveByAddress.get(lower) ?? 0;
  if (live <= 1) wsLiveByAddress.delete(lower);
  else wsLiveByAddress.set(lower, live - 1);
}

interface WsData {
  address: string;
  battleId?: string;
  /** F-2A: epoch seconds at which the upgrading signature stops being valid.
   *  Used to schedule a forced socket close so a leaked URL can't keep an
   *  indefinite live feed open past the replay window. */
  authExpiresAt: number;
}

// F-03/F-06/F-07: authenticated WebSocket upgrade.
// Browser WS API has no header support, so the EIP-191 challenge that
// `walletAuth` consumes via headers is passed via URL params here. The
// shared verifier (`verifyWalletSignature`) ensures both transports apply
// identical replay-window + signature checks — no new auth machinery.
//
// Privacy note: WSS encrypts the URL in transit; only this endpoint sees the
// raw query string. The signature embeds a 5-minute timestamp window, so a
// leaked signature is only useful for that window.
async function authenticateWsUpgrade(url: URL): Promise<WsData> {
  const address = url.searchParams.get('address');
  const signature = url.searchParams.get('signature');
  const timestampStr = url.searchParams.get('timestamp');
  const battleIdParam = url.searchParams.get('battleId');

  if (!address || !signature || !timestampStr) {
    throw new ApiError(
      'UNAUTHORIZED',
      'Missing auth params: address, signature, timestamp',
    );
  }

  const { checksumAddress, expiresAt } = await verifyWalletSignature({
    address,
    signature,
    timestamp: Number(timestampStr),
  });
  const lowerAddr = checksumAddress.toLowerCase();

  // F-06: battle-room subscriptions must come from a battle participant.
  // Without this, any caller with a valid signature could subscribe to any
  // battleId and receive its events (round_result, battle_settled, etc.).
  let battleId: string | undefined;
  if (battleIdParam) {
    // F-2E: accept ONLY decimal-form battleIds. `BigInt('0x10')` parses to
    // `16n`, which would pass the participant check but then disagree with
    // the canonical decimal battleId used by `battleWS.broadcast` / `join`.
    // F-2M: also reject 0 (contract battleIds start at 1) and bound at the
    // signed-int64 max of the Postgres `bigint` column. Without this, very
    // large decimals would parse but throw at the DB query layer with a
    // generic error.
    const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
    if (!/^[1-9]\d{0,18}$/.test(battleIdParam)) {
      throw new ApiError('INVALID_INPUT', 'Invalid battleId');
    }
    const battleIdBig = BigInt(battleIdParam);
    if (battleIdBig > POSTGRES_BIGINT_MAX) {
      throw new ApiError('INVALID_INPUT', 'battleId out of range');
    }
    const [battle] = await db
      .select({ playerA: battles.playerA, playerB: battles.playerB })
      .from(battles)
      .where(eq(battles.battleId, battleIdBig))
      .limit(1);
    if (!battle) {
      throw new ApiError('NOT_FOUND', 'Battle not found');
    }
    if (
      battle.playerA.toLowerCase() !== lowerAddr &&
      battle.playerB.toLowerCase() !== lowerAddr
    ) {
      throw new ApiError('UNAUTHORIZED', 'Not a participant in this battle');
    }
    // Canonicalize: store the DB form so room keys match broadcast keys.
    battleId = battleIdBig.toString();
  }

  return { address: lowerAddr, battleId, authExpiresAt: expiresAt };
}

export default {
  port,
  async fetch(req: Request, server: any) {
    const url = new URL(req.url);

    if (url.pathname === '/ws') {
      // F-2B: per-IP attempt rate limit before any signature verification —
      // protects the verifier itself from abuse and bounds upgrade churn.
      // F-2I: IP source respects TRUST_PROXY env so XFF can't be spoofed
      // when the API is exposed directly.
      const ip = getClientIp(req, server);
      if (!checkAndIncrIpAttempts(ip)) {
        return new Response(
          JSON.stringify({ error: 'RATE_LIMITED', message: 'Too many WS upgrade attempts' }),
          { status: 429, headers: { 'content-type': 'application/json' } },
        );
      }

      let data: WsData;
      try {
        data = await authenticateWsUpgrade(url);
      } catch (err) {
        if (err instanceof ApiError) {
          return new Response(
            JSON.stringify({ error: err.code, message: err.message }),
            {
              status: err.status,
              headers: { 'content-type': 'application/json' },
            },
          );
        }
        log.error({ err }, 'WS upgrade authentication failed');
        return new Response('Unauthorized', { status: 401 });
      }

      // F-Y2: address-cap check moved to `open()` (below) so we can signal
      // capacity-exhaustion via a WebSocket close code (1013 "Try Again
      // Later") rather than a pre-upgrade HTTP 429. The browser doesn't
      // expose pre-upgrade HTTP statuses to JS, so the previous design
      // produced an indistinguishable "connection failed" — the client's
      // F-2N pre-open failure classifier then treated transient capacity
      // hits as permanent rejection.

      if (server.upgrade(req, { data })) {
        return; // upgraded — Bun handles the WS handshake response
      }
      return new Response('Upgrade failed', { status: 500 });
    }

    // F-2O: thread the Bun `server` ref into Hono's env so the REST rate
    // limiter can use the same `getClientIp` policy as the WS upgrade.
    return app.fetch(req, { server });
  },
  websocket: {
    open(
      ws: WebSocket & {
        data?: WsData;
        // F-2A: per-socket lifetime timer attached at open, cleared at close.
        __authTimer?: ReturnType<typeof setTimeout>;
        // F-Y2: track whether this socket reserved an address-room slot so
        // close() releases at most once.
        __reserved?: boolean;
      },
    ) {
      const data = ws.data;
      if (!data) return;
      const { battleId, address, authExpiresAt } = data;

      // F-Y2: per-address concurrent socket cap. Moved post-upgrade so we
      // can signal exhaustion via close code 1013 ("Try Again Later",
      // IANA-registered) instead of a pre-upgrade 429 the browser hides
      // from JS. Client's `useBattleWs` distinguishes 1013 from generic
      // pre-open closes and does NOT count it toward F-2N's terminal
      // classifier — it's a transient signal that closing other tabs will
      // resolve.
      // F-Y6: idempotent. If Bun ever fires `open` twice for the same WS
      // instance (defensive), the early-return prevents double-reservation
      // (which would later under-release one capacity slot via __reserved
      // tracking only one increment).
      if (ws.__reserved) {
        return;
      }
      if (!tryReserveAddressSlot(address)) {
        try {
          ws.close(1013, 'address-capacity');
        } catch {
          // already closed; nothing to do
        }
        return;
      }
      ws.__reserved = true;

      // Battle-room subscription (post-match): both fields present.
      if (battleId && address) {
        battleWS.join(battleId, ws, address);
      }
      // Address-room subscription (queue lifecycle): always join if we have
      // an authenticated address. Cheap to maintain alongside the battle room
      // and lets queue events route correctly even if the client connects
      // pre-match.
      if (address) {
        battleWS.joinAddressRoom(address, ws);
      }

      // F-2A: schedule a forced close at signature expiry. Without this, an
      // upgraded socket stays subscribed forever — a leaked auth URL becomes
      // an indefinite live feed even though the signature itself is only
      // valid for AUTH_PAST_WINDOW_SEC after the signed timestamp.
      const remainingMs = authExpiresAt * 1000 - Date.now();
      if (remainingMs > 0) {
        ws.__authTimer = setTimeout(() => {
          try {
            ws.close(1008, 'Signature expired');
          } catch {
            // already closed; nothing to do
          }
        }, remainingMs);
      } else {
        // Defensive: should be unreachable since the upgrade handler
        // already enforces the past-window check.
        try {
          ws.close(1008, 'Signature expired');
        } catch {
          // ignore
        }
      }
    },
    close(
      ws: WebSocket & {
        data?: WsData;
        __authTimer?: ReturnType<typeof setTimeout>;
        __reserved?: boolean;
      },
    ) {
      const data = ws.data;
      if (!data) return;
      const { battleId, address } = data;
      if (battleId) {
        battleWS.leave(battleId, ws);
      }
      if (address) {
        battleWS.leaveAddressRoom(address, ws);
        // F-Y2: only release if open() actually reserved. A capacity-rejected
        // socket calls close() too but never reserved, so unconditional
        // release would underflow the per-address counter.
        if (ws.__reserved) {
          releaseAddressSlot(address);
          ws.__reserved = false;
        }
      }
      if (ws.__authTimer) {
        clearTimeout(ws.__authTimer);
        ws.__authTimer = undefined;
      }
    },
    message(_ws: WebSocket, _message: string | Buffer) {
      // Battle WS is server-push only — no client messages expected
    },
  },
};
