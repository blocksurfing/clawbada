import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Same shape as auth.test.ts: the token layer only needs getAddress from the chain package
// (plus `addresses`, which routes/auth publishes in GET /params — HARDEN-1).
const mockGetAddress = mock((addr: string) => addr);
mock.module('@clawbada/chain', () => ({
  verifyMessage: mock(() => Promise.resolve(true)),
  getAddress: mockGetAddress,
  // A getter, so one test can stand in for an API with no contract addresses configured.
  addresses: { get battleArena() { if (missingAddresses) throw new Error('Missing contract address: BATTLE_ARENA_ADDRESS is not set.'); return '0xBATTLE'; } },
}));
let missingAddresses = false;

import { Hono } from 'hono';
import { walletAuth, playerAuth, GUEST_REFUSED_MESSAGE } from '../middleware/auth';
import { ApiError } from '../lib/errors';
import {
  mintSessionToken, verifySessionToken, bearerFrom, resetSessionSecret,
  TOKEN_TTL_SEC, SESSION_MAX_AGE_SEC,
} from '../lib/session-token';

const ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const OTHER = '0x1111111111111111111111111111111111111111';

beforeEach(() => {
  process.env.AUTH_SESSION_SECRET = 'test-secret-at-least-32-characters-long!!';
  resetSessionSecret();
  mockGetAddress.mockImplementation((addr: string) => addr);
});

describe('session tokens', () => {
  test('a minted token verifies back to its address, with both expiries', () => {
    const now = Math.floor(Date.now() / 1000);
    const minted = mintSessionToken(ADDRESS);
    expect(minted.expiresAt).toBeGreaterThanOrEqual(now + TOKEN_TTL_SEC - 2);
    expect(minted.sessionEndsAt).toBeGreaterThanOrEqual(now + SESSION_MAX_AGE_SEC - 2);

    const v = verifySessionToken(minted.token);
    expect(v.checksumAddress).toBe(ADDRESS);
    expect(v.expiresAt).toBe(minted.expiresAt);
    expect(v.sessionStart).toBeGreaterThanOrEqual(now - 2);
  });

  test('a refresh keeps the original session start, so it cannot roll forward for ever', () => {
    const signedAt = Math.floor(Date.now() / 1000) - 60 * 60;      // signed an hour ago
    const refreshed = mintSessionToken(ADDRESS, signedAt);
    expect(verifySessionToken(refreshed.token).sessionStart).toBe(signedAt);
    expect(refreshed.sessionEndsAt).toBe(signedAt + SESSION_MAX_AGE_SEC);

    // Past the cap, the token is refused however fresh its own exp is.
    const tooOld = mintSessionToken(ADDRESS, Math.floor(Date.now() / 1000) - SESSION_MAX_AGE_SEC - 1);
    expect(() => verifySessionToken(tooOld.token)).toThrow(/too old/i);
  });

  test('an expired token is refused', () => {
    // Mint as if two and a half hours ago, so its own exp (TTL 2 h) has passed but the
    // 24 h session cap has not — this is expiry, not the cap.
    const realNow = Date.now;
    const past = realNow() - (TOKEN_TTL_SEC + 1800) * 1000;
    Date.now = () => past;
    let token: string;
    try {
      token = mintSessionToken(ADDRESS).token;
    } finally {
      Date.now = realNow;
    }
    expect(() => verifySessionToken(token)).toThrow(/expired/i);
  });

  test('a tampered payload fails the signature check', () => {
    const token = mintSessionToken(ADDRESS).token;
    const [prefix, payload, sig] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    claims.a = OTHER;                                        // try to become someone else
    const forged = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    expect(() => verifySessionToken(`${prefix}.${forged}.${sig}`)).toThrow(/invalid session token/i);
  });

  test('a token minted under a different secret is refused', () => {
    const token = mintSessionToken(ADDRESS).token;
    process.env.AUTH_SESSION_SECRET = 'a-completely-different-secret-32-chars!!!';
    resetSessionSecret();
    expect(() => verifySessionToken(token)).toThrow(/invalid session token/i);
  });

  test('malformed tokens are refused rather than crashing', () => {
    for (const bad of ['', 'nope', 'clw1.only-two', 'xxx1.a.b', 'clw1..', 'clw1.!!!.!!!']) {
      expect(() => verifySessionToken(bad)).toThrow(ApiError);
    }
  });

  test('bearerFrom reads only a well-formed Authorization header', () => {
    expect(bearerFrom('Bearer abc')).toBe('abc');
    expect(bearerFrom('bearer abc')).toBe('abc');
    expect(bearerFrom('  Bearer   abc  ')).toBe('abc');
    expect(bearerFrom('Basic abc')).toBeNull();
    expect(bearerFrom('abc')).toBeNull();
    expect(bearerFrom(undefined)).toBeNull();
  });
});

describe('walletAuth accepts a session token', () => {
  function app() {
    const a = new Hono<{ Variables: { address: string } }>();
    a.onError((err, c) =>
      err instanceof ApiError
        ? c.json({ error: err.code, message: err.message }, err.status as never)
        : c.json({ error: 'INTERNAL_ERROR' }, 500));
    a.use('*', walletAuth);
    a.get('/who', (c) => c.json({ address: c.get('address') }));
    return a;
  }

  test('a valid bearer token authenticates without any signature headers', async () => {
    const { token } = mintSessionToken(ADDRESS);
    const res = await app().request('/who', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect((await res.json()).address).toBe(ADDRESS);
  });

  test('a bad token is rejected and does not fall through to the signature path', async () => {
    const res = await app().request('/who', { headers: { Authorization: 'Bearer clw1.aaa.bbb' } });
    expect(res.status).toBe(401);
  });

  test('no proof at all still asks for one of the two', async () => {
    const res = await app().request('/who');
    expect(res.status).toBe(401);
    expect((await res.json()).message).toMatch(/Bearer|X-Wallet-Address/);
  });
});

describe('POST /api/auth/session', () => {
  async function app() {
    const { authRoutes } = await import('../routes/auth');
    const a = new Hono();
    a.onError((err, c) =>
      err instanceof ApiError
        ? c.json({ error: err.code, message: err.message }, err.status as never)
        : c.json({ error: 'INTERNAL_ERROR' }, 500));
    a.route('/api/auth', authRoutes);
    return a;
  }
  const signatureHeaders = () => ({
    'X-Wallet-Address': ADDRESS,
    'X-Signature': '0xdeadbeef',
    'X-Timestamp': String(Math.floor(Date.now() / 1000)),
    'X-Nonce': 'sessiontest00001',
  });

  test('one signature buys a token that then authenticates on its own', async () => {
    const res = await (await app()).request('/api/auth/session', { method: 'POST', headers: signatureHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.address).toBe(ADDRESS);
    expect(body.expiresAt * 1000).toBeGreaterThan(Date.now());
    expect(body.sessionEndsAt).toBeGreaterThan(body.expiresAt);
    // The token alone is now enough — this is the whole point: no second signature.
    expect(verifySessionToken(body.token).checksumAddress).toBe(ADDRESS);
  });

  test('without any proof it refuses', async () => {
    const res = await (await app()).request('/api/auth/session', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  test('refresh renews from the token alone and keeps the original session start', async () => {
    const a = await app();
    const first = await (await a.request('/api/auth/session', { method: 'POST', headers: signatureHeaders() })).json();
    const start = verifySessionToken(first.token).sessionStart;

    const res = await a.request('/api/auth/session/refresh', {
      method: 'POST',
      headers: { Authorization: `Bearer ${first.token}` },   // no wallet headers at all
    });
    expect(res.status).toBe(200);
    const renewed = await res.json();
    expect(renewed.address).toBe(ADDRESS);
    expect(verifySessionToken(renewed.token).sessionStart).toBe(start);
    expect(renewed.sessionEndsAt).toBe(first.sessionEndsAt);   // the cap does not move
  });

  // Audit C-01: /session accepted a bearer token and minted a token with a NEW session start, so
  // a token could buy itself a fresh 24 h forever and SESSION_MAX_AGE_SEC never applied.
  test('C-01: a token cannot buy a fresh session — only a wallet signature can', async () => {
    const a = await app();
    const first = await (await a.request('/api/auth/session', { method: 'POST', headers: signatureHeaders() })).json();

    const res = await a.request('/api/auth/session', { method: 'POST', headers: { Authorization: `Bearer ${first.token}` } });
    expect(res.status).toBe(401);
    expect((await res.json()).message).toMatch(/fresh wallet signature/);

    // Even alongside valid signature headers: the bearer must not be laundered into a new start.
    const both = await a.request('/api/auth/session', { method: 'POST', headers: { ...signatureHeaders(), Authorization: `Bearer ${first.token}` } });
    expect(both.status).toBe(401);
  });

  test('C-01: however often it is refreshed, a session never outlives its original cap', async () => {
    const a = await app();
    let tok = (await (await a.request('/api/auth/session', { method: 'POST', headers: signatureHeaders() })).json());
    const cap = tok.sessionEndsAt;
    for (let i = 0; i < 5; i++) {
      tok = await (await a.request('/api/auth/session/refresh', { method: 'POST', headers: { Authorization: `Bearer ${tok.token}` } })).json();
      expect(tok.sessionEndsAt).toBe(cap);
    }
  });

  test('refresh refuses a missing or bad token', async () => {
    const a = await app();
    expect((await a.request('/api/auth/session/refresh', { method: 'POST' })).status).toBe(401);
    const bad = await a.request('/api/auth/session/refresh', { method: 'POST', headers: { Authorization: 'Bearer clw1.x.y' } });
    expect(bad.status).toBe(401);
  });
});

// ── Guest sessions: the Dojo without a wallet ──

describe('guest tokens', () => {
  test('a guest mint verifies back as a guest; a wallet mint does not', () => {
    const guest = mintSessionToken(ADDRESS, undefined, { guest: true });
    expect(verifySessionToken(guest.token)).toMatchObject({ checksumAddress: ADDRESS, guest: true });
    expect(verifySessionToken(mintSessionToken(ADDRESS).token).guest).toBe(false);
  });

  test('a refresh carries the guest flag and the session start over', () => {
    const start = Math.floor(Date.now() / 1000) - 600;
    const v = verifySessionToken(mintSessionToken(ADDRESS, start, { guest: true }).token);
    expect(v.guest).toBe(true);
    expect(v.sessionStart).toBe(start);
  });

  test('the flag lives inside the signed body: adding or removing it breaks the signature', () => {
    const edit = (token: string, f: (claims: Record<string, unknown>) => void) => {
      const [prefix, payload, sig] = token.split('.');
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      f(claims);
      return `${prefix}.${Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')}.${sig}`;
    };
    // A guest cannot promote itself to a wallet session…
    expect(() => verifySessionToken(edit(mintSessionToken(ADDRESS, undefined, { guest: true }).token, (c) => { delete c.g; }))).toThrow(/invalid session token/i);
    // …and a wallet token cannot be turned into a guest one.
    expect(() => verifySessionToken(edit(mintSessionToken(ADDRESS).token, (c) => { c.g = 1; }))).toThrow(/invalid session token/i);
  });
});

describe('walletAuth refuses a guest token; playerAuth accepts both', () => {
  function app(mw: typeof walletAuth) {
    const a = new Hono<{ Variables: { address: string; guest: boolean } }>();
    a.onError((err, c) =>
      err instanceof ApiError
        ? c.json({ error: err.code, message: err.message }, err.status as never)
        : c.json({ error: 'INTERNAL_ERROR' }, 500));
    a.use('*', mw);
    a.get('/who', (c) => c.json({ address: c.get('address'), guest: c.get('guest') }));
    return a;
  }
  const guestBearer = () => ({ Authorization: `Bearer ${mintSessionToken(OTHER, undefined, { guest: true }).token}` });
  const walletBearer = () => ({ Authorization: `Bearer ${mintSessionToken(ADDRESS).token}` });

  test('walletAuth: a guest bearer is 401, with a message that says a wallet is needed', async () => {
    const res = await app(walletAuth).request('/who', { headers: guestBearer() });
    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe(GUEST_REFUSED_MESSAGE);
    const ok = await app(walletAuth).request('/who', { headers: walletBearer() });
    expect(await ok.json()).toEqual({ address: ADDRESS, guest: false });
  });

  test('playerAuth: a wallet bearer and a guest bearer both pass, and the route can tell them apart', async () => {
    expect(await (await app(playerAuth).request('/who', { headers: walletBearer() })).json()).toEqual({ address: ADDRESS, guest: false });
    expect(await (await app(playerAuth).request('/who', { headers: guestBearer() })).json()).toEqual({ address: OTHER, guest: true });
    expect((await app(playerAuth).request('/who')).status).toBe(401);
  });
});

describe('POST /api/auth/guest', () => {
  async function app() {
    const { authRoutes } = await import('../routes/auth');
    const a = new Hono();
    a.onError((err, c) =>
      err instanceof ApiError
        ? c.json({ error: err.code, message: err.message }, err.status as never)
        : c.json({ error: 'INTERNAL_ERROR' }, 500));
    a.route('/api/auth', authRoutes);
    return a;
  }
  const signatureHeaders = () => ({
    'X-Wallet-Address': ADDRESS,
    'X-Signature': '0xdeadbeef',
    'X-Timestamp': String(Math.floor(Date.now() / 1000)),
    'X-Nonce': 'guesttest0000001',
  });

  test('mints a guest session for a throwaway address — no proof needed, a new address every time', async () => {
    const res = await (await app()).request('/api/auth/guest', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.guest).toBe(true);
    expect(body.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(body.expiresAt * 1000).toBeGreaterThan(Date.now());
    expect(body.sessionEndsAt).toBeGreaterThan(body.expiresAt);
    expect(verifySessionToken(body.token)).toMatchObject({ checksumAddress: body.address, guest: true });
    const again = await (await (await app()).request('/api/auth/guest', { method: 'POST' })).json();
    expect(again.address).not.toBe(body.address);
  });

  test('a guest token refreshes and stays a guest; it can never buy a wallet session (C-01)', async () => {
    const a = await app();
    const first = await (await a.request('/api/auth/guest', { method: 'POST' })).json();
    const renewed = await a.request('/api/auth/session/refresh', { method: 'POST', headers: { Authorization: `Bearer ${first.token}` } });
    expect(renewed.status).toBe(200);
    const body = await renewed.json();
    expect(body).toMatchObject({ guest: true, address: first.address, sessionEndsAt: first.sessionEndsAt });
    expect(verifySessionToken(body.token).guest).toBe(true);
    expect((await a.request('/api/auth/session', { method: 'POST', headers: { Authorization: `Bearer ${first.token}` } })).status).toBe(401);
    expect((await a.request('/api/auth/session', { method: 'POST', headers: { ...signatureHeaders(), Authorization: `Bearer ${first.token}` } })).status).toBe(401);
  });

  test('a wallet session says it is not a guest', async () => {
    const body = await (await (await app()).request('/api/auth/session', { method: 'POST', headers: signatureHeaders() })).json();
    expect(body.guest).toBe(false);
  });

  test('switched off — GUEST_SESSIONS_ENABLED=false, or practice mode off — it is a 404', async () => {
    for (const [k, v] of [['GUEST_SESSIONS_ENABLED', 'false'], ['PRACTICE_ENABLED', 'false']] as const) {
      process.env[k] = v;
      try {
        expect((await (await app()).request('/api/auth/guest', { method: 'POST' })).status).toBe(404);
      } finally {
        delete process.env[k];
      }
    }
  });
});

describe('GET /api/auth/params', () => {
  async function app() {
    const { authRoutes } = await import('../routes/auth');
    const a = new Hono();
    a.route('/api/auth', authRoutes);
    return a;
  }

  test('publishes the arena address a client hashes into its team commit (HARDEN-1)', async () => {
    missingAddresses = false;
    const res = await (await app()).request('/api/auth/params');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chainId).toBe(84532);
    expect(body.contracts).toEqual({ battleArena: '0xBATTLE' });
  });

  test('still answers when no contract addresses are configured — login must not depend on a deployment', async () => {
    // Regression: #198 read `addresses.battleArena` inline, which throws without BATTLE_ARENA_ADDRESS,
    // so every dev/probe stack without contracts got a 500 here and nobody could sign in.
    missingAddresses = true;
    try {
      const res = await (await app()).request('/api/auth/params');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.chainIds).toEqual([84532, 8453]);
      expect(body.contracts).toEqual({});
    } finally {
      missingAddresses = false;
    }
  });
});

describe('POST /api/auth/ws-ticket', () => {
  async function app() {
    const { authRoutes } = await import('../routes/auth');
    const a = new Hono();
    a.onError((err, c) =>
      err instanceof ApiError
        ? c.json({ error: err.code, message: err.message }, err.status as never)
        : c.json({ error: 'INTERNAL_ERROR' }, 500));
    a.route('/api/auth', authRoutes);
    return a;
  }
  const post = async (token: string | null, body: unknown) =>
    (await app()).request('/api/auth/ws-ticket', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  test('trades a session token for a ticket bound to the battle, carrying the token\'s expiry', async () => {
    const minted = mintSessionToken(ADDRESS);
    const res = await post(minted.token, { battleId: '42' });
    expect(res.status).toBe(200);
    const j = await res.json() as { ticket: string; battleId: string; expiresInMs: number };
    expect(j.battleId).toBe('42');
    const { wsTickets } = await import('../lib/ws-ticket');
    expect(wsTickets.consume(j.ticket, '42')).toEqual({ checksumAddress: ADDRESS, guest: false, authExpiresAt: minted.expiresAt, battleId: '42' });
  });

  test('a guest gets tickets for its off-chain battles only', async () => {
    const guest = mintSessionToken(OTHER, undefined, { guest: true });
    expect((await post(guest.token, { battleId: 'f_8a0e5c6b-1d2e-4f3a-9b8c-7d6e5f4a3b2c' })).status).toBe(200);
    expect((await post(guest.token, { battleId: '42' })).status).toBe(401);
    expect((await post(guest.token, {})).status).toBe(401);
  });

  test('needs auth, and a strict body', async () => {
    expect((await post(null, { battleId: '42' })).status).toBe(401);
    const t = mintSessionToken(ADDRESS).token;
    expect((await post(t, { battleId: '42', role: 'admin' })).status).toBe(400);
    expect((await post(t, { battleId: 7 })).status).toBe(400);
    expect((await post(t, [])).status).toBe(400);
  });
});
