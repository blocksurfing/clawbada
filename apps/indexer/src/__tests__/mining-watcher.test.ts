import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { makeDb, makeLogger, makeEventLog, tables, chainCalls, argOf, logMessages } from './helpers/mock-db';

// -- Mocks BEFORE importing the watcher --
const db = makeDb();
const logger = makeLogger();
const mockGetBlock = mock(async (..._args: unknown[]) => ({ timestamp: 1_700_000_000n }));

mock.module('@clawbada/db', () => ({
  db,
  expeditions: tables.expeditions,
  seasons: tables.seasons,
  onChainEvents: tables.onChainEvents,
  indexerState: tables.indexerState,
}));

mock.module('@clawbada/chain', () => ({
  MiningPoolAbi: [],
  addresses: { miningPool: '0x00000000000000000000000000000000000000a4' },
  getPublicClient: () => ({ getBlock: mockGetBlock }),
}));

mock.module('../logger', () => ({ log: logger }));

import { MiningWatcher } from '../watchers/mining-watcher';

// -- Fixtures --
const OWNER = '0xAbCdEf0000000000000000000000000000000001';

/** The event as MiningPool emits it: (expeditionId, teamId, owner, mineTier, reward, boostBps). */
function startedLog(overrides: Record<string, unknown> = {}, blockNumber: bigint | null = 123n) {
  return makeEventLog(
    'ExpeditionStarted',
    { expeditionId: 7n, teamId: 3n, owner: OWNER, mineTier: 1, reward: 3750n, boostBps: 1250, ...overrides },
    blockNumber,
  );
}

function resetAll() {
  db.reset();
  mockGetBlock.mockClear();
  mockGetBlock.mockImplementation(async () => ({ timestamp: 1_700_000_000n }));
  for (const level of ['info', 'warn', 'error']) logger[level].mockClear();
}

describe('MiningWatcher ExpeditionStarted', () => {
  beforeEach(resetAll);

  test('writes boostBps, the block timestamp as startTime and the latest season', async () => {
    db.queue('select', [{ season: 2 }]);
    await new MiningWatcher().handleEvent(startedLog());

    expect(mockGetBlock).toHaveBeenCalledWith({ blockNumber: 123n });
    expect(db.insert).toHaveBeenCalledWith(tables.expeditions);
    expect(argOf(chainCalls(db.insert, 0), 'values')).toEqual({
      expeditionId: 7n,
      teamId: 3n,
      owner: OWNER.toLowerCase(),
      season: 2,
      mineTier: 1,
      startTime: 1_700_000_000n,
      reward: '3750',
      boostBps: 1250,
      claimed: false,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('never writes undefined or NaN (the event carries no season/startTime)', async () => {
    db.queue('select', [{ season: 1 }]);
    await new MiningWatcher().handleEvent(startedLog());

    const values = argOf(chainCalls(db.insert, 0), 'values');
    for (const [key, value] of Object.entries(values)) {
      expect(value, key).not.toBeUndefined();
      if (typeof value === 'number') expect(Number.isNaN(value), key).toBe(false);
    }
  });

  test('boostBps defaults to 0 for a pre-boost event shape', async () => {
    db.queue('select', [{ season: 1 }]);
    await new MiningWatcher().handleEvent(startedLog({ boostBps: undefined }));

    expect(argOf(chainCalls(db.insert, 0), 'values')).toMatchObject({ boostBps: 0 });
  });

  test('season defaults to 1 before any SeasonStarted is mirrored', async () => {
    db.queue('select', []);
    await new MiningWatcher().handleEvent(startedLog());

    expect(argOf(chainCalls(db.insert, 0), 'values')).toMatchObject({ season: 1 });
  });

  test('block read failure: startTime approximated with wall-clock, warning logged, row still written', async () => {
    db.queue('select', [{ season: 1 }]);
    mockGetBlock.mockImplementationOnce(async () => {
      throw new Error('rpc down');
    });
    const before = BigInt(Math.floor(Date.now() / 1000));
    await new MiningWatcher().handleEvent(startedLog());
    const after = BigInt(Math.floor(Date.now() / 1000));

    const values = argOf(chainCalls(db.insert, 0), 'values');
    expect(values.startTime >= before && values.startTime <= after).toBe(true);
    expect(logMessages(logger.warn).some((m) => m.includes('getBlock failed'))).toBe(true);
  });

  test('log without a blockNumber: wall-clock fallback without an RPC call', async () => {
    db.queue('select', [{ season: 1 }]);
    await new MiningWatcher().handleEvent(startedLog({}, null));

    expect(mockGetBlock).not.toHaveBeenCalled();
    expect(typeof argOf(chainCalls(db.insert, 0), 'values').startTime).toBe('bigint');
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('MiningWatcher SeasonStarted', () => {
  beforeEach(resetAll);

  test('mirrors the season row', async () => {
    await new MiningWatcher().handleEvent(
      makeEventLog('SeasonStarted', { season: 1n, totalEmission: 352_500_000n, baseReward: 1250n, startTime: 1_700_000_000n }),
    );
    expect(db.insert).toHaveBeenCalledWith(tables.seasons);
    expect(argOf(chainCalls(db.insert, 0), 'values')).toEqual({
      season: 1,
      totalEmission: '352500000',
      baseReward: '1250',
      totalMinted: '0',
      startTime: new Date(1_700_000_000 * 1000),
    });
  });
});
