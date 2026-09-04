import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Mock @clawbada/chain ──
const mockVerifyMessage = mock(() => Promise.resolve(true));
const mockGetAddress = mock((addr: string) => addr);
const mockEncodeFunctionData = mock(() => '0xabcdef');

mock.module('@clawbada/chain', () => ({
  verifyMessage: mockVerifyMessage,
  getAddress: mockGetAddress,
  encodeFunctionData: mockEncodeFunctionData,
  EvolutionLabAbi: [],
  ClawTokenAbi: [],
  addresses: { evolutionLab: '0xEVO', clawToken: '0xCLAW' },
  base: { id: 8453 },
  baseSepolia: { id: 84532 },
}));

// ── Mock @clawbada/game-logic ──
mock.module('@clawbada/game-logic', () => ({
  evolutionRequirements: (tier: number) => {
    if (tier >= 3) return null; // Apex
    const costs: Record<number, any> = {
      0: { fuelCount: 2, fuelTier: 0, clawCost: 2000n },
      1: { fuelCount: 2, fuelTier: 1, clawCost: 10000n },
      2: { fuelCount: 2, fuelTier: 2, clawCost: 50000n },
    };
    return costs[tier];
  },
  canEvolve: mock(() => ({ valid: true })),
  previewEvolvedStats: mock(() => ({ hp: 840, attack: 84, armor: 144, speed: 96, critical: 108 })),
  EvolutionTier: { 0: 'Base', 1: 'Evolved', 2: 'Elite', 3: 'Apex', Base: 0, Evolved: 1, Elite: 2, Apex: 3 },
  LegendStatus: { Normal: 0, Legend: 1, 0: 'Normal', 1: 'Legend' },
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
import { evolutionRoutes } from '../../routes/game/evolution';
import {
  TEST_ADDRESS,
  OTHER_ADDRESS,
  authHeaders,
  mockLobster,
  createTestApp,
} from '../helpers/route-test-utils';

const app = createTestApp(evolutionRoutes, '/evolution');

describe('evolution routes', () => {
  beforeEach(() => {
    mockReadLobster.mockReset();
    mockVerifyMessage.mockImplementation(() => Promise.resolve(true));
    mockGetAddress.mockImplementation((addr: string) => addr);
  });

  // ──────────── GET /evolution/cost/:lobsterId ────────────

  describe('GET /evolution/cost/:lobsterId', () => {
    test('returns cost and preview for Base tier lobster', async () => {
      mockReadLobster.mockResolvedValue(
        mockLobster({ evolutionTier: 0, decoded: { class: 0, legend: 0, breedType: 0, bodyParts: [] } }),
      );

      const res = await app.request('/evolution/cost/1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.currentTier).toBe(0);
      expect(body.nextTier).toBe(1);
      expect(body.fuelCount).toBe(2);
      expect(body.previewStats).toBeDefined();
    });

    test('returns canEvolve false for Apex tier lobster', async () => {
      mockReadLobster.mockResolvedValue(mockLobster({ evolutionTier: 3 }));

      const res = await app.request('/evolution/cost/1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.canEvolve).toBe(false);
      expect(body.reason).toContain('Apex');
    });
  });

  // ──────────── POST /evolution/evolve ────────────

  describe('POST /evolution/evolve', () => {
    test('returns approve+evolve calldata for valid evolution', async () => {
      mockReadLobster.mockImplementation((id: bigint) =>
        Promise.resolve(mockLobster({ tokenId: id, evolutionTier: 0 })),
      );

      const res = await app.request('/evolution/evolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ lobsterId: '1', fuelId1: '2', fuelId2: '3' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.steps).toHaveLength(2);
      expect(body.steps[0].description).toContain('Approve');
      expect(body.steps[1].description).toContain('Evolve');
      expect(body.preview).toBeDefined();
    });

    test('returns 400 when missing fuelId1', async () => {
      const res = await app.request('/evolution/evolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ lobsterId: '1', fuelId2: '3' }),
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 when fuel not owned by caller', async () => {
      mockReadLobster.mockImplementation((id: bigint) => {
        if (id === 2n) return Promise.resolve(mockLobster({ tokenId: id, owner: OTHER_ADDRESS }));
        return Promise.resolve(mockLobster({ tokenId: id }));
      });

      const res = await app.request('/evolution/evolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ lobsterId: '1', fuelId1: '2', fuelId2: '3' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('not owned');
    });

    test('returns 401 without auth headers', async () => {
      const res = await app.request('/evolution/evolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lobsterId: '1', fuelId1: '2', fuelId2: '3' }),
      });
      expect(res.status).toBe(401);
    });
  });
});
