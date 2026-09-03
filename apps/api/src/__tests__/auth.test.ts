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
      },
    });

    expect(mockVerifyMessage).toHaveBeenCalledWith({
      address: VALID_ADDRESS,
      message: `Clawbada Auth: ${ts}`,
      signature: VALID_SIGNATURE,
    });
  });
});
