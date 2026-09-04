import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Mock @clawbada/chain ──
const mockVerifyMessage = mock(() => Promise.resolve(true));
const mockGetAddress = mock((addr: string) => addr);
const mockEncodeFunctionData = mock(() => '0xabcdef');

mock.module('@clawbada/chain', () => ({
  verifyMessage: mockVerifyMessage,
  getAddress: mockGetAddress,
  encodeFunctionData: mockEncodeFunctionData,
  FaucetAbi: [],
  addresses: { faucet: '0xFAUCET' },
  base: { id: 8453 },
  baseSepolia: { id: 84532 },
}));

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

// ── Mock ../../lib/chain ──
const mockReadFaucetStatus = mock<any>();

mock.module('../../lib/chain', () => ({
  readFaucetStatus: mockReadFaucetStatus,
  serializeBigInts: _serializeBigInts,
}));

// ── Import AFTER mocking ──
import { faucetRoutes } from '../../routes/faucet';
import {
  TEST_ADDRESS,
  authHeaders,
  mockFaucetStatus,
  createTestApp,
} from '../helpers/route-test-utils';

const app = createTestApp(faucetRoutes, '/faucet');

describe('faucet routes', () => {
  beforeEach(() => {
    mockReadFaucetStatus.mockReset();
    mockVerifyMessage.mockImplementation(() => Promise.resolve(true));
    mockGetAddress.mockImplementation((addr: string) => addr);
  });

  // ──────────── GET /faucet/status/:address ────────────

  describe('GET /faucet/status/:address', () => {
    test('returns full eligibility status', async () => {
      mockReadFaucetStatus.mockResolvedValue(mockFaucetStatus());

      const res = await app.request(`/faucet/status/${TEST_ADDRESS}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.address).toBe(TEST_ADDRESS);
      expect(body).toHaveProperty('isOpen');
      expect(body).toHaveProperty('isEligible');
      expect(body).toHaveProperty('canClaimLobsters');
      expect(body).toHaveProperty('canClaimClaw');
    });

    test('canClaimLobsters true when eligible, open, unclaimed', async () => {
      mockReadFaucetStatus.mockResolvedValue(
        mockFaucetStatus({ isOpen: true, isEligible: true, hasClaimedLobsters: false }),
      );

      const res = await app.request(`/faucet/status/${TEST_ADDRESS}`);
      const body = await res.json();
      expect(body.canClaimLobsters).toBe(true);
    });

    test('canClaimClaw true when lobsters claimed but claw unclaimed', async () => {
      mockReadFaucetStatus.mockResolvedValue(
        mockFaucetStatus({ hasClaimedLobsters: true, hasClaimedClaw: false }),
      );

      const res = await app.request(`/faucet/status/${TEST_ADDRESS}`);
      const body = await res.json();
      expect(body.canClaimClaw).toBe(true);
    });

    test('canClaimClaw false when lobsters not yet claimed', async () => {
      mockReadFaucetStatus.mockResolvedValue(
        mockFaucetStatus({ hasClaimedLobsters: false, hasClaimedClaw: false }),
      );

      const res = await app.request(`/faucet/status/${TEST_ADDRESS}`);
      const body = await res.json();
      expect(body.canClaimClaw).toBe(false);
    });
  });

  // ──────────── POST /faucet/claim-lobsters ────────────

  describe('POST /faucet/claim-lobsters', () => {
    test('returns calldata when eligible', async () => {
      mockReadFaucetStatus.mockResolvedValue(mockFaucetStatus());

      const res = await app.request('/faucet/claim-lobsters', {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.steps).toHaveLength(1);
      expect(body.steps[0].description).toContain('lobsters');
    });

    test('returns 400 when faucet closed', async () => {
      mockReadFaucetStatus.mockResolvedValue(mockFaucetStatus({ isOpen: false }));

      const res = await app.request('/faucet/claim-lobsters', {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('closed');
    });

    test('returns 400 when not eligible', async () => {
      mockReadFaucetStatus.mockResolvedValue(mockFaucetStatus({ isEligible: false }));

      const res = await app.request('/faucet/claim-lobsters', {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('not eligible');
    });

    test('returns 400 when already claimed', async () => {
      mockReadFaucetStatus.mockResolvedValue(mockFaucetStatus({ hasClaimedLobsters: true }));

      const res = await app.request('/faucet/claim-lobsters', {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('already claimed');
    });
  });

  // ──────────── POST /faucet/claim-claw ────────────

  describe('POST /faucet/claim-claw', () => {
    test('returns calldata when eligible and lobsters claimed', async () => {
      mockReadFaucetStatus.mockResolvedValue(
        mockFaucetStatus({ hasClaimedLobsters: true }),
      );

      const res = await app.request('/faucet/claim-claw', {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.steps).toHaveLength(1);
      expect(body.steps[0].description).toContain('CLAW');
    });

    test('returns 400 when lobsters not claimed yet', async () => {
      mockReadFaucetStatus.mockResolvedValue(
        mockFaucetStatus({ hasClaimedLobsters: false }),
      );

      const res = await app.request('/faucet/claim-claw', {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('lobsters first');
    });

    test('returns 400 when CLAW already claimed', async () => {
      mockReadFaucetStatus.mockResolvedValue(
        mockFaucetStatus({ hasClaimedLobsters: true, hasClaimedClaw: true }),
      );

      const res = await app.request('/faucet/claim-claw', {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('already claimed');
    });
  });
});
