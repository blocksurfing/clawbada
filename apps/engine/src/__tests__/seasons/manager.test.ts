import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Mock @clawbada/chain ──
const mockAccount = { address: '0xOperator' };
const mockWriteContract = mock(() => Promise.resolve('0xtxhash'));
const mockWaitForTransactionReceipt = mock(() => Promise.resolve({}));
const mockSimulateStartSeason = mock(() =>
  Promise.resolve({ request: { functionName: 'startSeason' } }),
);

mock.module('@clawbada/chain', () => ({
  getOperatorClient: () => ({
    account: mockAccount,
    writeContract: mockWriteContract,
  }),
  getPublicClient: () => ({
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
  }),
  getMiningPool: () => ({
    simulate: {
      startSeason: mockSimulateStartSeason,
    },
  }),
}));

// ── Mock @clawbada/db ──
const mockDbSelect = mock<any>();
const mockDbFrom = mock<any>();
const mockDbOrderBy = mock<any>();
const mockDbLimit = mock<any>();

mock.module('@clawbada/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        orderBy: () => ({
          limit: mockDbLimit,
        }),
      }),
    }),
  },
  seasons: { season: 'season' },
}));

// ── Import after mocks ──
import { SeasonManager } from '../../seasons/manager';
import { getSeasonEmission, SEASON_EMISSIONS, S1_BASE_REWARD } from '@clawbada/game-logic';

// ── Helpers ──

function makeSeason(overrides: Partial<{
  season: number;
  totalEmission: string;
  totalMinted: string;
  baseReward: string;
  startTime: Date;
}> = {}) {
  return {
    season: overrides.season ?? 1,
    totalEmission: overrides.totalEmission ?? '387500000',
    totalMinted: overrides.totalMinted ?? '0',
    baseReward: overrides.baseReward ?? '1250',
    startTime: overrides.startTime ?? new Date(),
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

describe('getSeasonEmission', () => {
  test('returns correct values for seasons 1-7', () => {
    expect(getSeasonEmission(1)).toBe(387_500_000n);
    expect(getSeasonEmission(2)).toBe(193_750_000n);
    expect(getSeasonEmission(3)).toBe(96_875_000n);
    expect(getSeasonEmission(4)).toBe(48_437_500n);
    expect(getSeasonEmission(5)).toBe(24_218_750n);
    expect(getSeasonEmission(6)).toBe(12_109_375n);
    expect(getSeasonEmission(7)).toBe(7_750_000n);
  });

  test('returns floor for seasons beyond 7', () => {
    expect(getSeasonEmission(8)).toBe(7_750_000n);
    expect(getSeasonEmission(10)).toBe(7_750_000n);
    expect(getSeasonEmission(100)).toBe(7_750_000n);
  });

  test('throws for season 0', () => {
    expect(() => getSeasonEmission(0)).toThrow('Season must be >= 1');
  });

  test('throws for negative season', () => {
    expect(() => getSeasonEmission(-1)).toThrow('Season must be >= 1');
  });
});

describe('SeasonManager', () => {
  let manager: SeasonManager;

  beforeEach(() => {
    manager = new SeasonManager();
    mockDbLimit.mockReset();
    mockSimulateStartSeason.mockReset();
    mockWriteContract.mockReset();
    mockWaitForTransactionReceipt.mockReset();

    // Defaults
    mockSimulateStartSeason.mockImplementation(() =>
      Promise.resolve({ request: { functionName: 'startSeason' } }),
    );
    mockWriteContract.mockImplementation(() => Promise.resolve('0xtxhash'));
    mockWaitForTransactionReceipt.mockImplementation(() => Promise.resolve({}));
  });

  describe('checkAndRollover', () => {
    test('skips when no season exists in DB', async () => {
      mockDbLimit.mockResolvedValue([]);

      const result = await manager.checkAndRollover();

      expect(result).toBe(false);
      expect(mockSimulateStartSeason).not.toHaveBeenCalled();
    });

    test('skips when season is still active (30 days elapsed)', async () => {
      mockDbLimit.mockResolvedValue([makeSeason({ startTime: daysAgo(30) })]);

      const result = await manager.checkAndRollover();

      expect(result).toBe(false);
      expect(mockSimulateStartSeason).not.toHaveBeenCalled();
    });

    test('triggers rollover when season has elapsed (61 days)', async () => {
      mockDbLimit.mockResolvedValue([makeSeason({ season: 1, startTime: daysAgo(61) })]);

      const result = await manager.checkAndRollover();

      expect(result).toBe(true);
      expect(mockSimulateStartSeason).toHaveBeenCalledTimes(1);
      // Should call with S2 emission and S1_BASE_REWARD
      const callArgs = mockSimulateStartSeason.mock.calls[0][0];
      expect(callArgs[0]).toBe(193_750_000n); // S2 emission
      expect(callArgs[1]).toBe(S1_BASE_REWARD);
    });

    test('uses correct emission for S6→S7 rollover (floor)', async () => {
      mockDbLimit.mockResolvedValue([makeSeason({ season: 6, startTime: daysAgo(61) })]);

      const result = await manager.checkAndRollover();

      expect(result).toBe(true);
      const callArgs = mockSimulateStartSeason.mock.calls[0][0];
      expect(callArgs[0]).toBe(7_750_000n); // S7 = floor
    });

    test('uses floor emission for S10→S11 rollover', async () => {
      mockDbLimit.mockResolvedValue([makeSeason({ season: 10, startTime: daysAgo(61) })]);

      const result = await manager.checkAndRollover();

      expect(result).toBe(true);
      const callArgs = mockSimulateStartSeason.mock.calls[0][0];
      expect(callArgs[0]).toBe(7_750_000n); // Still floor
    });

    test('handles chain error gracefully', async () => {
      mockDbLimit.mockResolvedValue([makeSeason({ season: 1, startTime: daysAgo(61) })]);
      mockSimulateStartSeason.mockRejectedValue(new Error('SeasonStillActive'));

      const result = await manager.checkAndRollover();

      expect(result).toBe(false);
    });

    test('calls rollover handler on success', async () => {
      mockDbLimit.mockResolvedValue([makeSeason({ season: 2, startTime: daysAgo(61) })]);

      const handler = mock<any>();
      manager.setRolloverHandler(handler);

      await manager.checkAndRollover();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(3, 96_875_000n, S1_BASE_REWARD);
    });

    test('does not call rollover handler on failure', async () => {
      mockDbLimit.mockResolvedValue([makeSeason({ season: 1, startTime: daysAgo(61) })]);
      mockSimulateStartSeason.mockRejectedValue(new Error('revert'));

      const handler = mock<any>();
      manager.setRolloverHandler(handler);

      await manager.checkAndRollover();

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
