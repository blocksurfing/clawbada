import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Mock @clawbada/chain ──
const mockVerifyMessage = mock(() => Promise.resolve(true));
const mockGetAddress = mock((addr: string) => addr);
const mockEncodeFunctionData = mock(() => '0xabcdef');

mock.module('@clawbada/chain', () => ({
  verifyMessage: mockVerifyMessage,
  getAddress: mockGetAddress,
  encodeFunctionData: mockEncodeFunctionData,
  RepairShopAbi: [],
  ClawTokenAbi: [],
  addresses: { repairShop: '0xREPAIR', clawToken: '0xCLAW' },
  base: { id: 8453 },
  baseSepolia: { id: 84532 },
}));

// ── Mock @clawbada/game-logic ──
mock.module('@clawbada/game-logic', () => ({
  repairCost: (tier: number, points: number) => BigInt(points * [0, 5, 15, 40][tier]),
  REPAIR_RATES: { 0: 0, 1: 5, 2: 15, 3: 40 },
  DAMAGE_THRESHOLD: 80,
  EvolutionTier: { 0: 'Base', 1: 'Evolved', 2: 'Elite', 3: 'Apex', Base: 0, Evolved: 1, Elite: 2, Apex: 3 },
}));

// ── Mock ../../lib/chain ──
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
  readLobster: mockReadLobster,
  serializeBigInts: _serializeBigInts,
}));

// ── Import AFTER mocking ──
import { repairRoutes } from '../../routes/game/repair';
import {
  TEST_ADDRESS,
  OTHER_ADDRESS,
  authHeaders,
  mockLobster,
  createTestApp,
} from '../helpers/route-test-utils';

const app = createTestApp(repairRoutes, '/repair');

describe('repair routes', () => {
  beforeEach(() => {
    mockReadLobster.mockReset();
    mockVerifyMessage.mockImplementation(() => Promise.resolve(true));
    mockGetAddress.mockImplementation((addr: string) => addr);
  });

  // ──────────── GET /repair/cost/:lobsterId ────────────

  describe('GET /repair/cost/:lobsterId', () => {
    test('returns cost for damaged lobster', async () => {
      mockReadLobster.mockResolvedValue(mockLobster({ damage: 30, evolutionTier: 1 }));

      const res = await app.request('/repair/cost/1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.currentDamage).toBe(30);
      expect(body.pointsToRepair).toBe(30);
      expect(body.battleBlocked).toBe(false);
    });

    test('returns no damage message for undamaged lobster', async () => {
      mockReadLobster.mockResolvedValue(mockLobster({ damage: 0 }));

      const res = await app.request('/repair/cost/1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.damage).toBe(0);
      expect(body.message).toContain('no damage');
    });

    test('returns battleBlocked true when damage >= 80', async () => {
      mockReadLobster.mockResolvedValue(mockLobster({ damage: 85, evolutionTier: 1 }));

      const res = await app.request('/repair/cost/1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.battleBlocked).toBe(true);
    });

    test('respects points query parameter', async () => {
      mockReadLobster.mockResolvedValue(mockLobster({ damage: 50, evolutionTier: 1 }));

      const res = await app.request('/repair/cost/1?points=20');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.pointsToRepair).toBe(20);
    });
  });

  // ──────────── POST /repair/repair ────────────

  describe('POST /repair/repair', () => {
    test('returns approve+repair calldata for damaged lobster', async () => {
      mockReadLobster.mockResolvedValue(mockLobster({ damage: 40, evolutionTier: 1 }));

      const res = await app.request('/repair/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ lobsterId: '1' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.steps).toHaveLength(2);
      expect(body.steps[0].description).toContain('Approve');
      expect(body.steps[1].description).toContain('Repair');
    });

    test('returns 400 when lobster has no damage', async () => {
      mockReadLobster.mockResolvedValue(mockLobster({ damage: 0, evolutionTier: 1 }));

      const res = await app.request('/repair/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ lobsterId: '1' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('no damage');
    });

    test('returns 400 when not lobster owner', async () => {
      mockReadLobster.mockResolvedValue(mockLobster({ damage: 30, evolutionTier: 1, owner: OTHER_ADDRESS }));

      const res = await app.request('/repair/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ lobsterId: '1' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('owner');
    });

    test('returns 403 for Base tier lobster', async () => {
      mockReadLobster.mockResolvedValue(mockLobster({ damage: 30, evolutionTier: 0 }));

      const res = await app.request('/repair/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ lobsterId: '1' }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('INSUFFICIENT_TIER');
    });

    test('returns 400 when lobsterId missing', async () => {
      const res = await app.request('/repair/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });
});
