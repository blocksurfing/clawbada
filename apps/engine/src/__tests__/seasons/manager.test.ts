import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { decodeFunctionData } from 'viem';

// ── Mock @clawbada/chain ── (process-global: mirror the real module's shape for what the manager uses)
const realChain = await import('@clawbada/chain');
const mockSimulateStartSeason = mock((..._args: unknown[]) => Promise.resolve({ request: {} }));
mock.module('@clawbada/chain', () => ({
  ...realChain,
  addresses: { ...realChain.addresses, miningPool: '0x00000000000000000000000000000000000000aa' },
  getPublicClient: () => ({}),
  // The manager must never try to send startSeason itself (D-25). Kept here only to assert that.
  getMiningPool: () => ({ simulate: { startSeason: mockSimulateStartSeason }, read: {} }),
}));

// ── Mock @clawbada/db ──
const mockDbLimit = mock<any>();
mock.module('@clawbada/db', () => ({
  db: { select: () => ({ from: () => ({ orderBy: () => ({ limit: mockDbLimit }) }) }) },
  seasons: { season: 'season' },
}));

import { MiningPoolAbi } from '@clawbada/chain';
import {
  SeasonManager,
  scheduledEmission,
  nextSeasonEmission,
  MINING_ALLOCATION,
  S1_EMISSION,
  S7_EMISSION,
  ROLLOVER_DUE_AHEAD_MS,
  type SeasonChainReader,
} from '../../seasons/manager';

const DAY = 24 * 60 * 60 * 1000;
const WEI = 10n ** 18n;

function season(n: number, startedDaysAgo: number, now: number) {
  return {
    season: n,
    totalEmission: (scheduledEmission(n)).toString(),
    totalMinted: '0',
    baseReward: (1_250n * WEI).toString(),
    startTime: new Date(now - startedDaysAgo * DAY),
  };
}

function reader(minted: bigint, launch: bigint = 1_250n * WEI): SeasonChainReader {
  return { lifetimeMinted: async () => minted, launchBaseReward: async () => launch };
}

describe('season schedule (TOK-M1, wei)', () => {
  test('S1 352.5M halving through S6, S7 7.05M — in wei', () => {
    expect(scheduledEmission(1)).toBe(352_500_000n * WEI);
    expect(scheduledEmission(2)).toBe(176_250_000n * WEI);
    expect(scheduledEmission(6)).toBe(S1_EMISSION / 32n);
    expect(scheduledEmission(7)).toBe(S7_EMISSION);
  });
  test('the next season is clamped to what is left of the 705M allocation', () => {
    const minted = MINING_ALLOCATION - 1_000n * WEI;
    expect(nextSeasonEmission(8, minted)).toBe(1_000n * WEI);
    expect(nextSeasonEmission(2, 0n)).toBe(176_250_000n * WEI);
    expect(nextSeasonEmission(9, MINING_ALLOCATION)).toBe(0n);
  });
  test('rejects season 0', () => expect(() => scheduledEmission(0)).toThrow());
});

describe('SeasonManager.checkRollover (the Safe starts seasons — D-25)', () => {
  const now = Date.UTC(2027, 0, 1);
  beforeEach(() => {
    mockDbLimit.mockReset();
    mockSimulateStartSeason.mockReset();
  });

  test('nothing in DB → nothing', async () => {
    mockDbLimit.mockResolvedValue([]);
    expect(await new SeasonManager(reader(0n)).checkRollover(now)).toBeNull();
  });

  test('mid-season → silent', async () => {
    mockDbLimit.mockResolvedValue([season(1, 30, now)]);
    expect(await new SeasonManager(reader(0n)).checkRollover(now)).toBeNull();
  });

  test('3 days before the end → season_rollover_due with the exact Safe transaction', async () => {
    mockDbLimit.mockResolvedValue([season(1, 58, now)]); // ends in 2 days
    const m = new SeasonManager(reader(100_000_000n * WEI, 1_250n * WEI));
    expect(await m.checkRollover(now)).toBe('due');
    const plan = await m.buildRolloverPlan(season(1, 58, now) as any);
    expect(plan.target).toBe('0x00000000000000000000000000000000000000aa');
    expect(plan.nextSeason).toBe(2);
    const decoded = decodeFunctionData({ abi: MiningPoolAbi, data: plan.calldata });
    expect(decoded.functionName).toBe('startSeason');
    expect(decoded.args).toEqual([176_250_000n * WEI, 1_250n * WEI]);
    expect(mockSimulateStartSeason).not.toHaveBeenCalled(); // never sends it itself
  });

  test('the due alarm repeats daily, not every tick', async () => {
    mockDbLimit.mockResolvedValue([season(1, 58, now)]);
    const m = new SeasonManager(reader(0n));
    expect(await m.checkRollover(now)).toBe('due');
    expect(await m.checkRollover(now + 60 * 60 * 1000)).toBeNull();
    expect(await m.checkRollover(now + DAY)).toBe('due');
  });

  test('season over and no new one → season_rollover_overdue, repeating hourly', async () => {
    mockDbLimit.mockResolvedValue([season(2, 61, now)]);
    const m = new SeasonManager(reader(0n));
    expect(await m.checkRollover(now)).toBe('overdue');
    expect(await m.checkRollover(now + 30 * 60 * 1000)).toBeNull();
    expect(await m.checkRollover(now + 61 * 60 * 1000)).toBe('overdue');
  });

  test('allocation exhausted → no alarm to start anything', async () => {
    mockDbLimit.mockResolvedValue([season(8, 61, now)]);
    expect(await new SeasonManager(reader(MINING_ALLOCATION)).checkRollover(now)).toBe('exhausted');
  });

  test('an unreadable launch reward falls back to the S1 value (the Safe may change it)', async () => {
    mockDbLimit.mockResolvedValue([season(1, 58, now)]);
    const m = new SeasonManager({ lifetimeMinted: async () => 0n, launchBaseReward: async () => { throw new Error('rpc'); } });
    expect(await m.checkRollover(now)).toBe('due');
    const plan = await m.buildRolloverPlan(season(1, 58, now) as any);
    expect(decodeFunctionData({ abi: MiningPoolAbi, data: plan.calldata }).args?.[1]).toBe(1_250n * WEI);
  });

  test('the Safe started the next season → handler fires once and the alarms reset', async () => {
    const m = new SeasonManager(reader(0n));
    const handler = mock((_season: number, _emission: bigint, _baseReward: bigint) => {});
    m.setRolloverHandler(handler);
    mockDbLimit.mockResolvedValue([season(1, 61, now)]);
    expect(await m.checkRollover(now)).toBe('overdue');
    mockDbLimit.mockResolvedValue([season(2, 0, now + DAY)]);
    expect(await m.checkRollover(now + DAY)).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toBe(2);
    expect(await m.checkRollover(now + 2 * DAY)).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('due window starts exactly ROLLOVER_DUE_AHEAD_MS before the end', async () => {
    const end = now;
    mockDbLimit.mockResolvedValue([{ ...season(1, 0, now), startTime: new Date(end - 60 * DAY) }]);
    const m = new SeasonManager(reader(0n));
    expect(await m.checkRollover(end - ROLLOVER_DUE_AHEAD_MS - 1)).toBeNull();
    expect(await m.checkRollover(end - ROLLOVER_DUE_AHEAD_MS)).toBe('due');
  });
});
