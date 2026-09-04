import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Mock @clawbada/chain ──
const mockVerifyMessage = mock(() => Promise.resolve(true));
const mockGetAddress = mock((addr: string) => addr);
const mockEncodeFunctionData = mock(() => '0xabcdef');

mock.module('@clawbada/chain', () => ({
  verifyMessage: mockVerifyMessage,
  getAddress: mockGetAddress,
  encodeFunctionData: mockEncodeFunctionData,
  MarketplaceAbi: [],
  ClawTokenAbi: [],
  LobsterNFTAbi: [],
  addresses: { marketplace: '0xMKT', clawToken: '0xCLAW', lobsterNFT: '0xNFT' },
  base: { id: 8453 },
  baseSepolia: { id: 84532 },
}));

// ── Mock ../../lib/chain ──
const mockReadListing = mock<any>();
const mockReadLobster = mock<any>();

// ── Local serializeBigInts ──
function _serializeBigInts(obj: any): any {
  if (typeof obj === 'bigint') return obj.toString();
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(_serializeBigInts);
  if (typeof obj === 'object') {
    const r: any = {};
    for (const [k, v] of Object.entries(obj)) r[k] = _serializeBigInts(v);
    return r;
  }
  return obj;
}

mock.module('../../lib/chain', () => ({
  readListing: mockReadListing,
  readLobster: mockReadLobster,
  serializeBigInts: _serializeBigInts,
}));

// ── Mock @clawbada/db (for GET /listings and /price-history) ──
function mockDbChain(result: any[] = []) {
  const chain: any = {};
  const methods = ['select', 'from', 'innerJoin', 'where', 'orderBy', 'limit', 'offset'];
  for (const m of methods) {
    chain[m] = mock(() => chain);
  }
  chain.then = (resolve: Function) => resolve(result);
  return chain;
}

const dbChainResult: any[] = [];
const mockDb = mockDbChain(dbChainResult);

mock.module('@clawbada/db', () => ({
  db: {
    select: () => mockDb,
  },
  listings: { listingId: 'listingId', tokenId: 'tokenId', seller: 'seller', price: 'price', listedAt: 'listedAt', active: 'active' },
  priceHistory: { tokenId: 'tokenId', timestamp: 'timestamp' },
  lobsters: { tokenId: 'tokenId', class: 'class', evolutionTier: 'evolutionTier', purity: 'purity', legend: 'legend' },
}));

mock.module('drizzle-orm', () => ({
  eq: (...args: any[]) => args,
  desc: (col: any) => col,
  asc: (col: any) => col,
}));

// ── Import AFTER mocking ──
import { marketRoutes } from '../../routes/game/market';
import {
  TEST_ADDRESS,
  OTHER_ADDRESS,
  authHeaders,
  mockLobster,
  mockListing,
  createTestApp,
} from '../helpers/route-test-utils';

const app = createTestApp(marketRoutes, '/market');

describe('market routes', () => {
  beforeEach(() => {
    mockReadListing.mockReset();
    mockReadLobster.mockReset();
    mockVerifyMessage.mockImplementation(() => Promise.resolve(true));
    mockGetAddress.mockImplementation((addr: string) => addr);
  });

  // ──────────── GET /market/listings ────────────

  describe('GET /market/listings', () => {
    test('returns listings (DB query)', async () => {
      const res = await app.request('/market/listings');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('count');
      expect(body).toHaveProperty('listings');
    });
  });

  // ──────────── GET /market/listings/:listingId ────────────

  describe('GET /market/listings/:listingId', () => {
    test('returns listing with enriched lobster data', async () => {
      mockReadListing.mockResolvedValue(mockListing());
      mockReadLobster.mockResolvedValue(mockLobster());

      const res = await app.request('/market/listings/1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('lobster');
      expect(body.lobster).toHaveProperty('stats');
      expect(body.lobster).toHaveProperty('purity');
    });

    test('returns 404 when listing not found', async () => {
      mockReadListing.mockRejectedValue(new (await import('../../lib/errors')).ApiError('NOT_FOUND', 'not found'));

      const res = await app.request('/market/listings/999');
      expect(res.status).toBe(404);
    });
  });

  // ──────────── POST /market/list ────────────

  describe('POST /market/list', () => {
    test('returns approve+list calldata for valid listing', async () => {
      mockReadLobster.mockResolvedValue(mockLobster());

      const res = await app.request('/market/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ lobsterId: '1', price: '5000' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.steps).toHaveLength(2);
      expect(body.steps[0].description).toContain('Approve');
    });

    test('returns 400 when price is 0', async () => {
      mockReadLobster.mockResolvedValue(mockLobster());

      const res = await app.request('/market/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ lobsterId: '1', price: '0' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('> 0');
    });

    test('returns 400 when not lobster owner', async () => {
      mockReadLobster.mockResolvedValue(mockLobster({ owner: OTHER_ADDRESS }));

      const res = await app.request('/market/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ lobsterId: '1', price: '5000' }),
      });
      expect(res.status).toBe(400);
    });

    test('returns 409 when lobster is locked', async () => {
      mockReadLobster.mockResolvedValue(mockLobster({ locked: true }));

      const res = await app.request('/market/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ lobsterId: '1', price: '5000' }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('LOBSTER_LOCKED');
    });

    test('returns 400 for soulbound lobster', async () => {
      mockReadLobster.mockResolvedValue(mockLobster({ soulbound: true }));

      const res = await app.request('/market/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ lobsterId: '1', price: '5000' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('Soulbound');
    });
  });

  // ──────────── POST /market/listings/:listingId/buy ────────────

  describe('POST /market/listings/:listingId/buy', () => {
    test('returns approve+buy calldata for active listing', async () => {
      mockReadListing.mockResolvedValue(mockListing());

      const res = await app.request('/market/listings/1/buy', {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.steps).toHaveLength(2);
    });

    test('returns 404 when listing inactive', async () => {
      mockReadListing.mockResolvedValue(mockListing({ active: false }));

      const res = await app.request('/market/listings/1/buy', {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(404);
    });
  });

  // ──────────── DELETE /market/listings/:listingId ────────────

  describe('DELETE /market/listings/:listingId', () => {
    test('returns cancel calldata for seller', async () => {
      mockReadListing.mockResolvedValue(mockListing());

      const res = await app.request('/market/listings/1', {
        method: 'DELETE',
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.steps).toHaveLength(1);
      expect(body.steps[0].description).toContain('Cancel');
    });

    test('returns 400 when not seller', async () => {
      mockReadListing.mockResolvedValue(mockListing({ seller: OTHER_ADDRESS }));

      const res = await app.request('/market/listings/1', {
        method: 'DELETE',
        headers: authHeaders(),
      });
      expect(res.status).toBe(400);
    });
  });

  // ──────────── PATCH /market/listings/:listingId/price ────────────

  describe('PATCH /market/listings/:listingId/price', () => {
    test('returns calldata for price update', async () => {
      mockReadListing.mockResolvedValue(mockListing());

      const res = await app.request('/market/listings/1/price', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ price: '10000' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.steps).toHaveLength(1);
    });

    test('returns 400 when price is 0', async () => {
      mockReadListing.mockResolvedValue(mockListing());

      const res = await app.request('/market/listings/1/price', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ price: '0' }),
      });
      expect(res.status).toBe(400);
    });
  });
});
