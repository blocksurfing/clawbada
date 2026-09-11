import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Same shape as auth.test.ts: the token layer only needs getAddress from the chain package.
const mockGetAddress = mock((addr: string) => addr);
mock.module('@clawbada/chain', () => ({
  verifyMessage: mock(() => Promise.resolve(true)),
  getAddress: mockGetAddress,
}));

import { Hono } from 'hono';
import { walletAuth } from '../middleware/auth';
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

  test('refresh refuses a missing or bad token', async () => {
    const a = await app();
    expect((await a.request('/api/auth/session/refresh', { method: 'POST' })).status).toBe(401);
    const bad = await a.request('/api/auth/session/refresh', { method: 'POST', headers: { Authorization: 'Bearer clw1.x.y' } });
    expect(bad.status).toBe(401);
  });
});
