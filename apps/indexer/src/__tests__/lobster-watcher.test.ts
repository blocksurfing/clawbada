import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { makeDb, makeLogger, makeEventLog, tables, chainCalls, argOf, logMessages } from './helpers/mock-db';

// -- Mocks BEFORE importing the watcher --
const db = makeDb();
const logger = makeLogger();
const mockApplyPowerChange = mock(async (..._args: unknown[]) => true);
const mockCurrentBoostEpochId = mock(async (..._args: unknown[]) => 7);

mock.module('@clawbada/db', () => ({
  db,
  lobsters: tables.lobsters,
  teams: tables.teams,
  onChainEvents: tables.onChainEvents,
  indexerState: tables.indexerState,
  applyPowerChange: mockApplyPowerChange,
  currentBoostEpochId: mockCurrentBoostEpochId,
}));

mock.module('@clawbada/chain', () => ({
  LobsterNFTAbi: [],
  addresses: { lobsterNFT: '0x00000000000000000000000000000000000000a3' },
  getPublicClient: () => ({}),
}));

mock.module('../logger', () => ({ log: logger }));

import { LobsterWatcher } from '../watchers/lobster-watcher';

// -- Fixtures --
const TEAM = { teamId: 5n, lobster0: 1n, lobster1: 2n, lobster2: 3n };

function evolvedLog(tokenId: bigint, newTier: number) {
  return makeEventLog('LobsterEvolved', { tokenId, oldTier: newTier - 1, newTier });
}

function resetAll() {
  db.reset();
  mockApplyPowerChange.mockClear();
  mockCurrentBoostEpochId.mockClear();
  for (const level of ['info', 'warn', 'error']) logger[level].mockClear();
}

describe('LobsterWatcher LobsterEvolved', () => {
  beforeEach(resetAll);

  test('updates the tier and applies the new team power to the live team', async () => {
    db.queue(
      'select',
      [TEAM],
      [
        { tokenId: 1n, evolutionTier: 1 },
        { tokenId: 2n, evolutionTier: 2 }, // just evolved Evolved -> Elite
        { tokenId: 3n, evolutionTier: 1 },
      ],
    );
    await new LobsterWatcher().handleEvent(evolvedLog(2n, 2));

    expect(db.update).toHaveBeenCalledWith(tables.lobsters);
    expect(argOf(chainCalls(db.update, 0), 'set')).toMatchObject({ evolutionTier: 2 });

    expect(mockApplyPowerChange).toHaveBeenCalledTimes(1);
    expect(mockApplyPowerChange).toHaveBeenCalledWith(db, 5n, 4, 7);
    expect(logMessages(logger.info)).toContain('team power changed - rating reset to baseline');
  });

  test('no info log when the power did not change (applyPowerChange returns false)', async () => {
    db.queue('select', [TEAM], [
      { tokenId: 1n, evolutionTier: 1 },
      { tokenId: 2n, evolutionTier: 1 },
      { tokenId: 3n, evolutionTier: 1 },
    ]);
    mockApplyPowerChange.mockImplementationOnce(async () => false);
    await new LobsterWatcher().handleEvent(evolvedLog(2n, 1));

    expect(mockApplyPowerChange).toHaveBeenCalledWith(db, 5n, 3, 7);
    expect(logger.info).not.toHaveBeenCalled();
  });

  test('token not on a live team: tier update only', async () => {
    db.queue('select', []);
    await new LobsterWatcher().handleEvent(evolvedLog(2n, 2));

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(mockApplyPowerChange).not.toHaveBeenCalled();
    expect(mockCurrentBoostEpochId).not.toHaveBeenCalled();
  });

  test('team still has a Base member: no power change', async () => {
    db.queue('select', [TEAM], [
      { tokenId: 1n, evolutionTier: 1 },
      { tokenId: 2n, evolutionTier: 0 },
      { tokenId: 3n, evolutionTier: 1 },
    ]);
    await new LobsterWatcher().handleEvent(evolvedLog(1n, 1));

    expect(mockApplyPowerChange).not.toHaveBeenCalled();
  });

  test('a rating-layer failure is logged and does not throw', async () => {
    db.queue('select', [TEAM], [
      { tokenId: 1n, evolutionTier: 1 },
      { tokenId: 2n, evolutionTier: 1 },
      { tokenId: 3n, evolutionTier: 1 },
    ]);
    mockApplyPowerChange.mockImplementationOnce(async () => {
      throw new Error('db down');
    });
    await new LobsterWatcher().handleEvent(evolvedLog(1n, 1));

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
