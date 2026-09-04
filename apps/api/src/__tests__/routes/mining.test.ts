import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Mock @clawbada/chain ──
const mockVerifyMessage = mock(() => Promise.resolve(true));
const mockGetAddress = mock((addr: string) => addr);
const mockEncodeFunctionData = mock(() => '0xabcdef');

mock.module('@clawbada/chain', () => ({
  verifyMessage: mockVerifyMessage,
  getAddress: mockGetAddress,
  encodeFunctionData: mockEncodeFunctionData,
  MiningPoolAbi: [],
  addresses: { miningPool: '0xMINE' },
  base: { id: 8453 },
  baseSepolia: { id: 84532 },
}));

// ── Mock ../../lib/chain ──
const mockReadTeamsByOwner = mock<any>();
const mockReadTeam = mock<any>();
const mockReadLobster = mock<any>();
const mockReadExpedition = mock<any>();
const mockReadActiveExpedition = mock<any>();
const mockReadCurrentSeason = mock<any>();
const mockReadSeasonConfig = mock<any>();

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
  readTeamsByOwner: mockReadTeamsByOwner,
  readTeam: mockReadTeam,
  readLobster: mockReadLobster,
  readExpedition: mockReadExpedition,
  readActiveExpedition: mockReadActiveExpedition,
  readCurrentSeason: mockReadCurrentSeason,
  readSeasonConfig: mockReadSeasonConfig,
  serializeBigInts: _serializeBigInts,
}));

// ── Import AFTER mocking ──
import { miningRoutes } from '../../routes/game/mining';
import {
  TEST_ADDRESS,
  OTHER_ADDRESS,
  authHeaders,
  mockTeam,
  mockLobster,
  mockExpedition,
  createTestApp,
} from '../helpers/route-test-utils';

const app = createTestApp(miningRoutes, '/mining');

describe('mining routes', () => {
  beforeEach(() => {
    mockReadTeamsByOwner.mockReset();
    mockReadTeam.mockReset();
    mockReadLobster.mockReset();
    mockReadExpedition.mockReset();
    mockReadActiveExpedition.mockReset();
    mockReadCurrentSeason.mockReset();
    mockReadSeasonConfig.mockReset();
    mockVerifyMessage.mockImplementation(() => Promise.resolve(true));
    mockGetAddress.mockImplementation((addr: string) => addr);
  });

  // ──────────── GET /mining ────────────

  describe('GET /mining', () => {
    test('returns active expeditions for address', async () => {
      // A team on an expedition is `active` on chain (MiningPool sets it via ACTIVITY_ROLE).
      const team = mockTeam({ active: true });
      mockReadTeamsByOwner.mockResolvedValue([team]);
      mockReadActiveExpedition.mockResolvedValue(1n);
      mockReadExpedition.mockResolvedValue(mockExpedition());

      const res = await app.request(`/mining?address=${TEST_ADDRESS}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.count).toBe(1);
      expect(body.expeditions).toHaveLength(1);
    });

    test('returns 400 when address missing', async () => {
      const res = await app.request('/mining');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('INVALID_INPUT');
    });

    test('returns empty when no active expeditions', async () => {
      mockReadTeamsByOwner.mockResolvedValue([mockTeam()]);
      mockReadActiveExpedition.mockResolvedValue(0n);

      const res = await app.request(`/mining?address=${TEST_ADDRESS}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.count).toBe(0);
    });
  });

  // ──────────── GET /mining/:expeditionId ────────────

  describe('GET /mining/:expeditionId', () => {
    test('returns expedition with remaining time', async () => {
      const now = BigInt(Math.floor(Date.now() / 1000));
      mockReadExpedition.mockResolvedValue(
        mockExpedition({ startTime: now - 3600n, isComplete: false }),
      );

      const res = await app.request('/mining/1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.remainingSeconds).toBeGreaterThan(0);
    });

    test('returns remainingSeconds 0 for completed expedition', async () => {
      mockReadExpedition.mockResolvedValue(mockExpedition({ isComplete: true }));

      const res = await app.request('/mining/1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.remainingSeconds).toBe(0);
    });
  });

  // ──────────── POST /mining/start ────────────

  describe('POST /mining/start', () => {
    test('returns calldata for valid team + tier', async () => {
      mockReadTeam.mockResolvedValue(mockTeam());
      mockReadActiveExpedition.mockResolvedValue(0n);
      mockReadLobster.mockImplementation((id: bigint) =>
        Promise.resolve(mockLobster({ tokenId: id, evolutionTier: 1 })),
      );

      const res = await app.request('/mining/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1', mineTier: 0 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.steps).toHaveLength(1);
      expect(body.preview).toHaveProperty('expectedReward');
    });

    test('returns 400 when teamId missing', async () => {
      const res = await app.request('/mining/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ mineTier: 0 }),
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 when mineTier out of range', async () => {
      const res = await app.request('/mining/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1', mineTier: 5 }),
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 when not team owner', async () => {
      mockReadTeam.mockResolvedValue(mockTeam({ owner: OTHER_ADDRESS }));

      const res = await app.request('/mining/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1', mineTier: 0 }),
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 when team already mining', async () => {
      mockReadTeam.mockResolvedValue(mockTeam());
      mockReadActiveExpedition.mockResolvedValue(5n);

      const res = await app.request('/mining/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1', mineTier: 0 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('active expedition');
    });

    test('returns 403 when lobster tier too low', async () => {
      mockReadTeam.mockResolvedValue(mockTeam());
      mockReadActiveExpedition.mockResolvedValue(0n);
      mockReadLobster.mockResolvedValue(mockLobster({ evolutionTier: 0 }));

      const res = await app.request('/mining/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1', mineTier: 1 }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('INSUFFICIENT_TIER');
    });
  });

  // ──────────── POST /mining/:expeditionId/claim ────────────

  describe('POST /mining/:expeditionId/claim', () => {
    test('returns calldata for completed expedition', async () => {
      mockReadExpedition.mockResolvedValue(mockExpedition());

      const res = await app.request('/mining/1/claim', {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.steps).toHaveLength(1);
      expect(body.reward).toBeDefined();
    });

    test('returns 400 when expedition not complete', async () => {
      mockReadExpedition.mockResolvedValue(mockExpedition({ isComplete: false }));

      const res = await app.request('/mining/1/claim', {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('not yet complete');
    });

    test('returns 400 when not expedition owner', async () => {
      mockReadExpedition.mockResolvedValue(mockExpedition({ owner: OTHER_ADDRESS }));

      const res = await app.request('/mining/1/claim', {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(400);
    });
  });
});
