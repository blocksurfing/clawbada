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

const mockReadBlockNumber = mock<any>();

mock.module('../../lib/chain', () => ({
  readFaucetStatus: mockReadFaucetStatus,
  readBlockNumber: mockReadBlockNumber,
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

  // ──────────── D-10: the lobster claim is two steps ────────────

  describe('two-step lobster claim (D-10)', () => {
    const pending = (over: Record<string, unknown> = {}) =>
      mockFaucetStatus({ hasClaimedLobsters: true, lobsterClaimId: 7n, lobsterClaimPending: true, lobsterClaimTargetBlock: 1_000n, ...over });

    beforeEach(() => mockReadBlockNumber.mockReset());

    test('status: requested-but-not-minted is visible, and the CLAW drip waits for the lobsters', async () => {
      mockReadFaucetStatus.mockResolvedValue(pending());
      const body = await (await app.request(`/faucet/status/${TEST_ADDRESS}`)).json();
      expect(body).toMatchObject({ lobsterClaimPending: true, lobsterClaimId: '7', canFinalizeLobsters: true, canClaimClaw: false, canClaimLobsters: false });

      mockReadFaucetStatus.mockResolvedValue(pending({ lobsterClaimPending: false }));
      const minted = await (await app.request(`/faucet/status/${TEST_ADDRESS}`)).json();
      expect(minted).toMatchObject({ lobsterClaimPending: false, canFinalizeLobsters: false, canClaimClaw: true });
    });

    test('claim-lobsters says the lobsters arrive later and what to poll', async () => {
      mockReadFaucetStatus.mockResolvedValue(mockFaucetStatus());
      const body = await (await app.request('/faucet/claim-lobsters', { method: 'POST', headers: authHeaders() })).json();
      expect(body.steps).toHaveLength(1);
      expect(body.steps[0].description).toContain('arrive a few seconds later');
      expect(body.next).toMatchObject({ until: 'lobsterClaimPending === false', fallback: '/api/faucet/finalize-lobsters' });
    });

    test('claim-claw is refused while the lobsters are not minted', async () => {
      mockReadFaucetStatus.mockResolvedValue(pending());
      const res = await app.request('/faucet/claim-claw', { method: 'POST', headers: authHeaders() });
      expect(res.status).toBe(400);
      expect((await res.json()).message).toContain('not been minted yet');
    });

    test('finalize-lobsters: nothing to finalize', async () => {
      mockReadFaucetStatus.mockResolvedValue(mockFaucetStatus());
      expect((await app.request('/faucet/finalize-lobsters', { method: 'POST', headers: authHeaders() })).status).toBe(400);
      mockReadFaucetStatus.mockResolvedValue(pending({ lobsterClaimPending: false }));
      const res = await app.request('/faucet/finalize-lobsters', { method: 'POST', headers: authHeaders() });
      expect(res.status).toBe(400);
      expect((await res.json()).message).toContain('already minted');
    });

    test('finalize-lobsters: too early while the target block has no hash yet', async () => {
      mockReadFaucetStatus.mockResolvedValue(pending());
      mockReadBlockNumber.mockResolvedValue(1_000n); // head == target
      expect((await app.request('/faucet/finalize-lobsters', { method: 'POST', headers: authHeaders() })).status).toBe(409);
    });

    test('finalize-lobsters: inside the blockhash window -> finalizeClaim', async () => {
      mockReadFaucetStatus.mockResolvedValue(pending());
      mockReadBlockNumber.mockResolvedValue(1_001n);
      const body = await (await app.request('/faucet/finalize-lobsters', { method: 'POST', headers: authHeaders() })).json();
      expect(body.action).toBe('finalizeClaim');
      expect(body.steps).toHaveLength(1);
      mockReadBlockNumber.mockResolvedValue(1_256n); // the last block of the window
      expect((await (await app.request('/faucet/finalize-lobsters', { method: 'POST', headers: authHeaders() })).json()).action).toBe('finalizeClaim');
    });

    test('finalize-lobsters: past the window -> rearmClaim, nothing is lost', async () => {
      mockReadFaucetStatus.mockResolvedValue(pending());
      mockReadBlockNumber.mockResolvedValue(1_257n);
      const body = await (await app.request('/faucet/finalize-lobsters', { method: 'POST', headers: authHeaders() })).json();
      expect(body.action).toBe('rearmClaim');
      expect(body.steps[0].description).toContain('Re-arm');
    });

    test('finalize-lobsters needs auth', async () => {
      expect((await app.request('/faucet/finalize-lobsters', { method: 'POST' })).status).toBe(401);
    });
  });
});
