import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock @clawbada/chain BEFORE importing auth middleware
const mockVerifyMessage = mock(() => Promise.resolve(true));
const mockGetAddress = mock((addr: string) => addr);

mock.module('@clawbada/chain', () => ({
  verifyMessage: mockVerifyMessage,
  getAddress: mockGetAddress,
}));

import { Hono } from 'hono';
import { walletAuth } from '../middleware/auth';
import { ApiError } from '../lib/errors';

const VALID_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const VALID_SIGNATURE = '0xdeadbeef';

function createApp() {
  const app = new Hono<{ Variables: { address: string } }>();
  // Mirror the global onError handler from index.ts so ApiError thrown by
  // middleware is serialised to the correct HTTP status instead of a bare 500.
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: err.code, message: err.message }, err.status as any);
    }
    return c.json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }, 500);
  });
  app.use('*', walletAuth);
  app.get('/test', (c) => c.json({ address: c.get('address') }));
  return app;
}

function validTimestamp(): string {
  return String(Math.floor(Date.now() / 1000));
}

function validHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'X-Wallet-Address': VALID_ADDRESS,
    'X-Signature': VALID_SIGNATURE,
    'X-Timestamp': validTimestamp(),
    'X-Nonce': 'unittest00000001',
    ...overrides,
  };
}

describe('walletAuth middleware', () => {
  beforeEach(() => {
    mockVerifyMessage.mockImplementation(() => Promise.resolve(true));
    mockGetAddress.mockImplementation((addr: string) => addr);
  });

  test('missing all auth headers returns 401', async () => {
    const app = createApp();
    const res = await app.request('/test');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('UNAUTHORIZED');
  });

  test('missing X-Signature returns 401', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      headers: {
        'X-Wallet-Address': VALID_ADDRESS,
        'X-Timestamp': validTimestamp(),
      },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('UNAUTHORIZED');
  });

  test('missing X-Wallet-Address returns 401', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      headers: {
        'X-Signature': VALID_SIGNATURE,
        'X-Timestamp': validTimestamp(),
      },
    });
    expect(res.status).toBe(401);
  });

  test('missing X-Timestamp returns 401', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      headers: {
        'X-Wallet-Address': VALID_ADDRESS,
        'X-Signature': VALID_SIGNATURE,
      },
    });
    expect(res.status).toBe(401);
  });

  test('invalid timestamp (NaN) returns 401', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      headers: validHeaders({ 'X-Timestamp': 'not-a-number' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.message).toBe('Invalid timestamp');
  });

  test('expired timestamp (> 5 min ago) returns 401', async () => {
    const app = createApp();
    const expired = String(Math.floor(Date.now() / 1000) - 6 * 60); // 6 minutes ago
    const res = await app.request('/test', {
      headers: validHeaders({ 'X-Timestamp': expired }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.message).toBe('Timestamp expired');
  });

  test('future timestamp (> 30 s skew) returns 401', async () => {
    const app = createApp();
    // F-2F: the forward window is AUTH_FUTURE_SKEW_SEC (30 s), not the 5-minute replay window.
    const future = String(Math.floor(Date.now() / 1000) + 6 * 60); // 6 minutes ahead
    const res = await app.request('/test', {
      headers: validHeaders({ 'X-Timestamp': future }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.message).toBe('Timestamp too far in future');
  });

  test('invalid address format (getAddress throws) returns 401', async () => {
    mockGetAddress.mockImplementation(() => {
      throw new Error('invalid address');
    });

    const app = createApp();
    const res = await app.request('/test', {
      headers: validHeaders({ 'X-Wallet-Address': 'not-an-address' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.message).toBe('Invalid wallet address');
  });

  test('valid signature returns 200 with address on context', async () => {
    mockGetAddress.mockImplementation(() => VALID_ADDRESS);
    mockVerifyMessage.mockImplementation(() => Promise.resolve(true));

    const app = createApp();
    const res = await app.request('/test', {
      headers: validHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.address).toBe(VALID_ADDRESS);
  });

  test('invalid signature (verifyMessage returns false) returns 401', async () => {
    mockGetAddress.mockImplementation(() => VALID_ADDRESS);
    mockVerifyMessage.mockImplementation(() => Promise.resolve(false));

    const app = createApp();
    const res = await app.request('/test', {
      headers: validHeaders(),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.message).toBe('Invalid signature');
  });

  test('verifyMessage throwing returns 401', async () => {
    mockGetAddress.mockImplementation(() => VALID_ADDRESS);
    mockVerifyMessage.mockImplementation(() => {
      throw new Error('verification exploded');
    });

    const app = createApp();
    const res = await app.request('/test', {
      headers: validHeaders(),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.message).toBe('Signature verification failed');
  });

  test('verifyMessage is called with correct arguments', async () => {
    const ts = validTimestamp();
    mockGetAddress.mockImplementation(() => VALID_ADDRESS);
    mockVerifyMessage.mockImplementation(() => Promise.resolve(true));

    const app = createApp();
    await app.request('/test', {
      headers: {
        'X-Wallet-Address': VALID_ADDRESS,
        'X-Signature': VALID_SIGNATURE,
        'X-Timestamp': ts,
        'X-Nonce': 'abcdef0123456789',
        'X-Auth-Domain': 'localhost:3000',
      },
    });

    // C-01: the verified message is the EIP-4361 text rebuilt from the API's own domain
    // allow-list and chain id — not the old bare "Clawbada Auth: <ts>".
    const iso = (s: number) => new Date(s * 1000).toISOString();
    expect(mockVerifyMessage).toHaveBeenCalledWith({
      address: VALID_ADDRESS,
      message: [
        'localhost:3000 wants you to sign in with your Ethereum account:',
        VALID_ADDRESS,
        '',
        'Sign in to Clawbada. This signature only authorises game API requests for the next 5 minutes. It cannot move funds.',
        '',
        'URI: http://localhost:3000',
        'Version: 1',
        'Chain ID: 84532',
        'Nonce: abcdef0123456789',
        `Issued At: ${iso(Number(ts))}`,
        `Expiration Time: ${iso(Number(ts) + 300)}`,
      ].join('\n'),
      signature: VALID_SIGNATURE,
    });
  });

  // ── C-01: what the login message is bound to ──
  test('C-01: a domain that is not on the allow-list is refused before any signature check', async () => {
    mockVerifyMessage.mockClear();
    const res = await createApp().request('/test', { headers: validHeaders({ 'X-Auth-Domain': 'clawbada-web.evil.example' }) });
    expect(res.status).toBe(401);
    expect((await res.json()).message).toMatch(/not allowed to sign in/);
    expect(mockVerifyMessage).not.toHaveBeenCalled();
  });

  test('C-01: a malformed nonce is refused', async () => {
    for (const nonce of ['short', 'has spaces in it', 'semi;colon;12345']) {
      const res = await createApp().request('/test', { headers: validHeaders({ 'X-Nonce': nonce }) });
      expect(res.status).toBe(401);
    }
  });

  test('C-01: the legacy bare-string message is refused unless the rollout switch is on', async () => {
    const { 'X-Nonce': _n, ...legacy } = validHeaders();
    expect((await createApp().request('/test', { headers: legacy })).status).toBe(401);

    process.env.AUTH_ALLOW_LEGACY = '1';
    try {
      mockVerifyMessage.mockClear();
      const ok = await createApp().request('/test', { headers: legacy });
      expect(ok.status).toBe(200);
      expect((mockVerifyMessage.mock.calls as any)[0][0].message).toBe(`Clawbada Auth: ${legacy['X-Timestamp']}`);
    } finally {
      delete process.env.AUTH_ALLOW_LEGACY;
    }
  });
});
