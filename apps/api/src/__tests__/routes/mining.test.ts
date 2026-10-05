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
const mockReadCurrentBaseReward = mock<any>();
const mockReadEpochBudget = mock<any>();
const mockReadTeamBoostBps = mock<any>();
const mockSimulateStart = mock<any>();
const mockReadChainNow = mock<any>();
const WEI = 10n ** 18n;
const DAY = 24n * 60n * 60n;
const nowSec = () => BigInt(Math.floor(Date.now() / 1000));

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
  readChainNow: mockReadChainNow,
  readTeamsByOwner: mockReadTeamsByOwner,
  readTeam: mockReadTeam,
  readLobster: mockReadLobster,
  readExpedition: mockReadExpedition,
  readActiveExpedition: mockReadActiveExpedition,
  readCurrentSeason: mockReadCurrentSeason,
  readSeasonConfig: mockReadSeasonConfig,
  readCurrentBaseReward: mockReadCurrentBaseReward,
  readEpochBudget: mockReadEpochBudget,
  readTeamBoostBps: mockReadTeamBoostBps,
  simulateStartExpedition: mockSimulateStart,
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
    // Chain time = wall clock; season 1 started 10 days ago, so it is active for 50 more (C-L3).
    mockReadChainNow.mockReset();
    mockReadChainNow.mockImplementation(async () => nowSec());
    mockReadCurrentSeason.mockReset();
    mockReadCurrentSeason.mockResolvedValue(1n);
    mockReadSeasonConfig.mockReset();
    mockReadSeasonConfig.mockResolvedValue({ totalEmission: 352_500_000n * WEI, baseReward: 1_250n * WEI, startTime: nowSec() - 10n * DAY, totalMinted: 0n });
    // The live glide rate and an hour with room: S1 hour 0 (2 x 352.5M / 1,440), nothing minted yet.
    mockReadCurrentBaseReward.mockReset();
    mockReadCurrentBaseReward.mockResolvedValue(1_250n * WEI);
    mockReadEpochBudget.mockReset();
    mockReadEpochBudget.mockResolvedValue({ cap: 489_583n * WEI, minted: 0n, nextEpochAt: BigInt(Math.floor(Date.now() / 1000) + 3_600) });
    mockReadTeamBoostBps.mockReset();
    mockReadTeamBoostBps.mockResolvedValue(0);
    mockSimulateStart.mockReset();
    mockSimulateStart.mockResolvedValue({ ok: true, simulated: true });
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

  // ──────────── GET /mining/budget ────────────

  describe('GET /mining/budget', () => {
    test("reports this hour's ceiling, what still fits per tier, and when the next hour opens", async () => {
      mockReadEpochBudget.mockResolvedValue({ cap: 489_583n * WEI, minted: 468_750n * WEI, nextEpochAt: 1_900_000_000n });

      const res = await app.request('/mining/budget');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.remaining).toBe((20_833n * WEI).toString());
      expect(body.fits).toEqual([16, 5, 1, 0]); // 20,833 / 1,250 / {1, 3, 10, 25}
      expect(body.nextEpochAtIso).toBe(new Date(1_900_000_000 * 1000).toISOString());
    });

    test('is not swallowed by the :expeditionId route', async () => {
      mockReadEpochBudget.mockResolvedValue({ cap: 1n, minted: 0n, nextEpochAt: 0n });
      const res = await app.request('/mining/budget');
      expect(res.status).toBe(200);
      expect(mockReadExpedition).not.toHaveBeenCalled();
    });

    test('L4: reports the glide position — this hour, the last re-pegged hour, the demand estimate — and flags a pending re-peg', async () => {
      const startTime = nowSec() - 10n * DAY;
      const currentEpoch = (nowSec() - startTime) / 3_600n;
      mockReadSeasonConfig.mockResolvedValue({ totalEmission: 352_500_000n * WEI, baseReward: 1_250n * WEI, startTime, totalMinted: 0n, lastRepegEpoch: currentEpoch - 2n, trailingWeightServed: 180n });
      let body = await (await app.request('/mining/budget')).json();
      expect(body.currentEpoch).toBe(currentEpoch.toString());
      expect(body.lastRepegEpoch).toBe((currentEpoch - 2n).toString());
      expect(body.trailingWeight).toBe('180');
      expect(body.quoteMayMove).toBe(true);
      expect(body.quoteNote).toContain('re-peg');

      mockReadSeasonConfig.mockResolvedValue({ totalEmission: 352_500_000n * WEI, baseReward: 1_250n * WEI, startTime, totalMinted: 0n, lastRepegEpoch: currentEpoch, trailingWeightServed: 180n });
      body = await (await app.request('/mining/budget')).json();
      expect(body.quoteMayMove).toBe(false);
      expect(body.quoteNote).toBeUndefined();
    });

    test('says when the season ends (unix seconds + ISO) — startExpedition reverts from that second (C-L3)', async () => {
      const startTime = 1_900_000_000n;
      mockReadSeasonConfig.mockResolvedValue({ totalEmission: 352_500_000n * WEI, baseReward: 1_250n * WEI, startTime, totalMinted: 0n });
      mockReadChainNow.mockResolvedValue(startTime + 30n * DAY);

      const res = await app.request('/mining/budget');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.season).toBe('1');
      expect(body.seasonEndsAt).toBe((startTime + 60n * DAY).toString());
      expect(body.seasonEndsAtIso).toBe(new Date(Number(startTime + 60n * DAY) * 1000).toISOString());
      expect(mockReadSeasonConfig).toHaveBeenCalledWith(1n);
    });

    test('returns 409 SEASON_GAP once the 60 days are up and the Safe has not started the next season', async () => {
      const startTime = 1_900_000_000n;
      mockReadSeasonConfig.mockResolvedValue({ totalEmission: 352_500_000n * WEI, baseReward: 1_250n * WEI, startTime, totalMinted: 0n });
      mockReadChainNow.mockResolvedValue(startTime + 60n * DAY); // the first second of the gap

      const res = await app.request('/mining/budget');
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('SEASON_GAP');
      expect(body.message).toContain(`seasonEndedAt=${startTime + 60n * DAY}`);
      expect(body.message).toContain('the Safe has not started the next season');
      expect(mockReadEpochBudget).not.toHaveBeenCalled();
    });

    test('returns 409 SEASON_GAP before season 1 has been started', async () => {
      mockReadCurrentSeason.mockResolvedValue(0n);

      const res = await app.request('/mining/budget');
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('SEASON_GAP');
      expect(body.message).toContain('season 1');
      expect(mockReadSeasonConfig).not.toHaveBeenCalled();
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
    const validTeam = () => {
      mockReadTeam.mockResolvedValue(mockTeam());
      mockReadActiveExpedition.mockResolvedValue(0n);
      mockReadLobster.mockImplementation((id: bigint) => Promise.resolve(mockLobster({ tokenId: id, evolutionTier: 1 })));
    };
    const start = (mineTier = 1) => app.request('/mining/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ teamId: '1', mineTier }),
    });

    test('L5: quotes the boosted reward exactly as the contract computes it (boost before the tier weight, floored)', async () => {
      validTeam();
      mockReadTeamBoostBps.mockResolvedValue(2_500); // +25 % at Power 3 (three Evolved lobsters)
      const res = await start(1);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(mockReadTeamBoostBps).toHaveBeenCalledWith(1n, 3);
      // 1,250 × 1.25 = 1,562.5 per unit × 3 (Evolved) = 4,687.5 GOLD
      expect(body.preview.expectedRewardWei).toBe((4_687n * WEI + WEI / 2n).toString());
      expect(body.preview.expectedReward).toBe(4687);
      expect(body.preview.boostBps).toBe(2500);
      expect(body.preview.power).toBe(3);
      expect(body.preview.simulated).toBe(true);
      expect(mockSimulateStart).toHaveBeenCalledWith(1n, 1, expect.any(String));
    });

    test('L5: the chain dry run has the last word — EpochBudgetFull becomes 409 MINE_FULL with the opening time', async () => {
      validTeam();
      const opensAt = BigInt(Math.floor(Date.now() / 1000) + 1_800);
      mockSimulateStart.mockResolvedValue({ ok: false, errorName: 'EpochBudgetFull', args: [opensAt] });
      const res = await start(0);
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('MINE_FULL');
      expect(body.message).toContain(new Date(Number(opensAt) * 1000).toISOString());
    });

    test('L5: an unmapped revert is 409 CHAIN_REVERT naming the error; a transport failure still quotes, flagged unsimulated', async () => {
      validTeam();
      mockSimulateStart.mockResolvedValue({ ok: false, errorName: 'SomethingNew', args: [7n] });
      let res = await start(0);
      expect(res.status).toBe(409);
      const revert = await res.json();
      expect(revert.error).toBe('CHAIN_REVERT');
      expect(revert.message).toContain('SomethingNew(7)');

      mockSimulateStart.mockResolvedValue({ ok: true, simulated: false, note: 'dry run unavailable: rpc down' });
      res = await start(0);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.preview.simulated).toBe(false);
      expect(body.preview.simulationNote).toContain('rpc down');
    });

    test('L4: quoteMayMove when the hour has not been re-pegged yet, not once it has', async () => {
      validTeam();
      const startTime = nowSec() - 10n * DAY;
      const currentEpoch = (nowSec() - startTime) / 3_600n;
      mockReadSeasonConfig.mockResolvedValue({ totalEmission: 352_500_000n * WEI, baseReward: 1_250n * WEI, startTime, totalMinted: 0n, lastRepegEpoch: currentEpoch - 1n, trailingWeightServed: 42n });
      let body = await (await start(0)).json();
      expect(body.preview.quoteMayMove).toBe(true);
      expect(body.preview.quoteNote).toContain('first expedition of the hour');

      mockReadSeasonConfig.mockResolvedValue({ totalEmission: 352_500_000n * WEI, baseReward: 1_250n * WEI, startTime, totalMinted: 0n, lastRepegEpoch: currentEpoch, trailingWeightServed: 42n });
      body = await (await start(0)).json();
      expect(body.preview.quoteMayMove).toBe(false);
      expect(body.preview.quoteNote).toBeUndefined();
    });

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

    test('quotes the live glide rate, not the launch constant', async () => {
      mockReadTeam.mockResolvedValue(mockTeam());
      mockReadActiveExpedition.mockResolvedValue(0n);
      mockReadLobster.mockImplementation((id: bigint) =>
        Promise.resolve(mockLobster({ tokenId: id, evolutionTier: 1 })),
      );
      mockReadCurrentBaseReward.mockResolvedValue(875n * WEI); // one -30% step into the season

      const res = await app.request('/mining/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1', mineTier: 1 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.preview.expectedReward).toBe(875 * 3);
      expect(body.preview.baseReward).toBe((875n * WEI).toString());
    });

    test("returns 409 MINE_FULL with the opening time when this hour's budget is spent (D-19)", async () => {
      mockReadTeam.mockResolvedValue(mockTeam());
      mockReadActiveExpedition.mockResolvedValue(0n);
      mockReadLobster.mockImplementation((id: bigint) =>
        Promise.resolve(mockLobster({ tokenId: id, evolutionTier: 1 })),
      );
      const opensAt = 1_900_000_000n;
      // 1,000 GOLD of room left; an Evolved expedition at 1,250 x 3 does not fit.
      mockReadEpochBudget.mockResolvedValue({ cap: 489_583n * WEI, minted: 488_583n * WEI, nextEpochAt: opensAt });

      const res = await app.request('/mining/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1', mineTier: 1 }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('MINE_FULL');
      expect(body.message).toContain(new Date(Number(opensAt) * 1000).toISOString());
      expect(body.steps).toBeUndefined();
    });

    test('returns 409 SEASON_GAP, not calldata, when the season has ended and no new one started (C-L3)', async () => {
      mockReadTeam.mockResolvedValue(mockTeam());
      mockReadActiveExpedition.mockResolvedValue(0n);
      mockReadLobster.mockImplementation((id: bigint) =>
        Promise.resolve(mockLobster({ tokenId: id, evolutionTier: 1 })),
      );
      const startTime = 1_900_000_000n;
      mockReadCurrentSeason.mockResolvedValue(3n);
      mockReadSeasonConfig.mockResolvedValue({ totalEmission: 88_125_000n * WEI, baseReward: 400n * WEI, startTime, totalMinted: 0n });
      mockReadChainNow.mockResolvedValue(startTime + 60n * DAY + 3_600n); // an hour into the gap

      const res = await app.request('/mining/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1', mineTier: 1 }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('SEASON_GAP');
      expect(body.message).toContain('Season 3 ended at');
      expect(body.message).toContain(`seasonEndedAt=${startTime + 60n * DAY}`);
      expect(body.message).toContain('the Safe has not started the next season');
      expect(body.steps).toBeUndefined();
      expect(mockReadSeasonConfig).toHaveBeenCalledWith(3n);
    });

    test('still returns calldata in the last second of the season', async () => {
      mockReadTeam.mockResolvedValue(mockTeam());
      mockReadActiveExpedition.mockResolvedValue(0n);
      mockReadLobster.mockImplementation((id: bigint) =>
        Promise.resolve(mockLobster({ tokenId: id, evolutionTier: 1 })),
      );
      const startTime = 1_900_000_000n;
      mockReadSeasonConfig.mockResolvedValue({ totalEmission: 352_500_000n * WEI, baseReward: 1_250n * WEI, startTime, totalMinted: 0n });
      mockReadChainNow.mockResolvedValue(startTime + 60n * DAY - 1n);

      const res = await app.request('/mining/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1', mineTier: 0 }),
      });
      expect(res.status).toBe(200);
    });

    test('returns 409 SEASON_GAP before season 1 has been started', async () => {
      mockReadCurrentSeason.mockResolvedValue(0n);

      const res = await app.request('/mining/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1', mineTier: 0 }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('SEASON_GAP');
      expect(mockReadTeam).not.toHaveBeenCalled();
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
