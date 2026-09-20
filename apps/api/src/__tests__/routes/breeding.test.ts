import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Mock @clawbada/chain ──
const mockVerifyMessage = mock(() => Promise.resolve(true));
const mockGetAddress = mock((addr: string) => addr);
const mockEncodeFunctionData = mock(() => '0xabcdef');

mock.module('@clawbada/chain', () => ({
  verifyMessage: mockVerifyMessage,
  getAddress: mockGetAddress,
  encodeFunctionData: mockEncodeFunctionData,
  BreedingLabAbi: [],
  ClawTokenAbi: [],
  addresses: { breedingLab: '0xBREED', clawToken: '0xCLAW' },
  base: { id: 8453 },
  baseSepolia: { id: 84532 },
}));

// ── Mock ../../lib/chain ──
const mockReadLobster = mock<any>();
const mockReadCooldownEnd = mock<any>();

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
  readBreedCost: mock(async () => 1000n * 10n ** 18n),
  readLobster: mockReadLobster,
  readCooldownEnd: mockReadCooldownEnd,
  serializeBigInts: _serializeBigInts,
}));

// ── Import AFTER mocking ──
import { breedingRoutes } from '../../routes/game/breeding';
import {
  TEST_ADDRESS,
  OTHER_ADDRESS,
  authHeaders,
  mockLobster,
  createTestApp,
} from '../helpers/route-test-utils';

const app = createTestApp(breedingRoutes, '/breeding');

describe('breeding routes', () => {
  beforeEach(() => {
    mockReadLobster.mockReset();
    mockReadCooldownEnd.mockReset();
    mockVerifyMessage.mockImplementation(() => Promise.resolve(true));
    mockGetAddress.mockImplementation((addr: string) => addr);
  });

  // ──────────── GET /breeding/preview ────────────

  describe('GET /breeding/preview', () => {
    test('returns cost and probabilities for two parents', async () => {
      mockReadLobster.mockImplementation((id: bigint) =>
        Promise.resolve(mockLobster({ tokenId: id, decoded: { class: 3, legend: 0, breedType: 0, bodyParts: [] } })),
      );

      const res = await app.request('/breeding/preview?parentA=1&parentB=2');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalCost).toBeDefined();
      expect(body.classProbabilities).toBeDefined();
      expect(body.offspringGeneration).toBe(1);
      expect(body.legendChance).toBe('0.3%');
    });

    test('returns 100% class probability for same-class parents', async () => {
      mockReadLobster.mockResolvedValue(
        mockLobster({ decoded: { class: 5, legend: 0, breedType: 0, bodyParts: [] } }),
      );

      const res = await app.request('/breeding/preview?parentA=1&parentB=2');
      expect(res.status).toBe(200);
      const body = await res.json();
      const probs = Object.values(body.classProbabilities);
      expect(probs).toHaveLength(1);
      expect(probs[0]).toBe('100%');
    });

    test('returns 400 when parentA missing', async () => {
      const res = await app.request('/breeding/preview?parentB=2');
      expect(res.status).toBe(400);
    });

    test('returns 400 when parentB missing', async () => {
      const res = await app.request('/breeding/preview?parentA=1');
      expect(res.status).toBe(400);
    });
  });

  // ──────────── GET /breeding/cooldowns/:lobsterId ────────────

  describe('GET /breeding/cooldowns/:lobsterId', () => {
    test('returns ready when cooldown expired', async () => {
      mockReadCooldownEnd.mockResolvedValue(0n);

      const res = await app.request('/breeding/cooldowns/1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.isReady).toBe(true);
      expect(body.remainingSeconds).toBe(0);
    });

    test('returns remaining seconds when on cooldown', async () => {
      const future = BigInt(Math.floor(Date.now() / 1000) + 3600);
      mockReadCooldownEnd.mockResolvedValue(future);

      const res = await app.request('/breeding/cooldowns/1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.isReady).toBe(false);
      expect(body.remainingSeconds).toBeGreaterThan(0);
    });
  });

  // ──────────── POST /breeding/breed ────────────

  describe('POST /breeding/breed', () => {
    test('returns two-step calldata (approve + breed)', async () => {
      mockReadLobster.mockImplementation((id: bigint) =>
        Promise.resolve(mockLobster({ tokenId: id })),
      );
      mockReadCooldownEnd.mockResolvedValue(0n);

      const res = await app.request('/breeding/breed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ parentA: '1', parentB: '2' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.steps).toHaveLength(2);
      expect(body.steps[0].description).toContain('Approve');
      expect(body.steps[1].description).toContain('breed');
      // The second step must encode a function BreedingLab actually has. It used to encode
      // `breed`, which does not exist; the encoder is stubbed here, so this test never noticed and
      // the real endpoint answered 500. (routes-match-abi.test.ts checks every route against the
      // real ABIs.)
      const encoded = (mockEncodeFunctionData.mock.calls as any[]).map((c) => c[0].functionName);
      expect(encoded).toContain('requestBreed');
      expect(encoded).not.toContain('breed');
      // D-21: tells the client that a keeper finalizes, and how to do it itself.
      expect(body.finalize.by).toBe('keeper');
      expect(body.finalize.windowBlocks).toBe(256);
    });

    test('POST /breeding/finalize/:requestId returns finalizeBreed calldata with a gas hint above the D-22 floor', async () => {
      mockEncodeFunctionData.mockClear();
      const res = await app.request('/breeding/finalize/7', { method: 'POST' });   // permissionless: no auth
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.steps).toHaveLength(1);
      const call = (mockEncodeFunctionData.mock.calls as any[])[0][0];
      expect(call.functionName).toBe('finalizeBreed');
      expect(call.args).toEqual([7n]);
      expect(Number(body.gasHint)).toBeGreaterThanOrEqual(500_000);
      for (const bad of ['0', '-1', 'abc', '1.5']) {
        expect((await app.request(`/breeding/finalize/${bad}`, { method: 'POST' })).status).toBe(400);
      }
    });

    test('returns 400 when parentA same as parentB', async () => {
      const res = await app.request('/breeding/breed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ parentA: '1', parentB: '1' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('itself');
    });

    test('returns 400 when parent not owned by caller', async () => {
      mockReadLobster.mockResolvedValue(mockLobster({ owner: OTHER_ADDRESS }));
      mockReadCooldownEnd.mockResolvedValue(0n);

      const res = await app.request('/breeding/breed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ parentA: '1', parentB: '2' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('not owned');
    });

    test('returns 409 when parent locked', async () => {
      mockReadLobster.mockResolvedValue(mockLobster({ locked: true }));
      mockReadCooldownEnd.mockResolvedValue(0n);

      const res = await app.request('/breeding/breed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ parentA: '1', parentB: '2' }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('LOBSTER_LOCKED');
    });

    test('returns 400 when parent at max breeds', async () => {
      mockReadLobster.mockResolvedValue(mockLobster({ breedCount: 5 }));
      mockReadCooldownEnd.mockResolvedValue(0n);

      const res = await app.request('/breeding/breed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ parentA: '1', parentB: '2' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('max breeds');
    });

    test('returns 409 when parent on cooldown', async () => {
      mockReadLobster.mockImplementation((id: bigint) =>
        Promise.resolve(mockLobster({ tokenId: id })),
      );
      const future = BigInt(Math.floor(Date.now() / 1000) + 86400);
      mockReadCooldownEnd.mockResolvedValue(future);

      const res = await app.request('/breeding/breed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ parentA: '1', parentB: '2' }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('COOLDOWN_ACTIVE');
    });
  });
});
