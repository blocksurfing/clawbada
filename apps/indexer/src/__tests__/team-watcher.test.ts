import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { makeDb, makeLogger, makeEventLog, tables, chainCalls, argOf, logMessages } from './helpers/mock-db';

// -- Mocks BEFORE importing the watcher --
const db = makeDb();
const logger = makeLogger();
const mockEnsureTeamRating = mock(async (..._args: unknown[]) => ({ rating: 1200, power: 6, created: true, reset: false }));
const mockCurrentBoostEpochId = mock(async (..._args: unknown[]) => 7);

mock.module('@clawbada/db', () => ({
  db,
  teams: tables.teams,
  lobsters: tables.lobsters,
  matchmakingQueue: tables.matchmakingQueue,
  onChainEvents: tables.onChainEvents,
  indexerState: tables.indexerState,
  ensureTeamRating: mockEnsureTeamRating,
  currentBoostEpochId: mockCurrentBoostEpochId,
}));

mock.module('@clawbada/chain', () => ({
  TeamManagerAbi: [],
  addresses: { teamManager: '0x00000000000000000000000000000000000000a2' },
  getPublicClient: () => ({}),
}));

mock.module('../logger', () => ({ log: logger }));

import { TeamWatcher } from '../watchers/team-watcher';

// -- Fixtures --
const OWNER = '0xAbCdEf0000000000000000000000000000000001';
const OWNER_LOWER = OWNER.toLowerCase();

function lobsterRows(tiers: [number, number, number]) {
  return [
    { tokenId: 1n, evolutionTier: tiers[0] },
    { tokenId: 2n, evolutionTier: tiers[1] },
    { tokenId: 3n, evolutionTier: tiers[2] },
  ];
}

function createdLog(teamId: bigint) {
  return makeEventLog('TeamCreated', { teamId, owner: OWNER, lobsterIds: [1n, 2n, 3n] });
}

function resetAll() {
  db.reset();
  mockEnsureTeamRating.mockClear();
  mockCurrentBoostEpochId.mockClear();
  for (const level of ['info', 'warn', 'error']) logger[level].mockClear();
}

describe('TeamWatcher TeamCreated', () => {
  beforeEach(resetAll);

  test('inserts the team as inactive and rates an all-Evolved+ roster', async () => {
    db.queue('select', lobsterRows([1, 2, 3]));
    await new TeamWatcher().handleEvent(createdLog(9n));

    expect(db.insert).toHaveBeenCalledWith(tables.teams);
    expect(argOf(chainCalls(db.insert, 0), 'values')).toEqual({
      teamId: 9n,
      owner: OWNER_LOWER,
      lobster0: 1n,
      lobster1: 2n,
      lobster2: 3n,
      active: false,
    });

    expect(mockEnsureTeamRating).toHaveBeenCalledTimes(1);
    expect(mockEnsureTeamRating.mock.calls[0][0]).toBe(db);
    expect(mockEnsureTeamRating.mock.calls[0][1]).toEqual({
      teamId: 9n,
      owner: OWNER_LOWER,
      lobsterIds: [1n, 2n, 3n],
      power: 6, // Evolved 1 + Elite 2 + Apex 3
      epochId: 7,
    });
    expect(logMessages(logger.info)).toContain('rated new team');
  });

  test('logs a reset when ensureTeamRating reports a power change', async () => {
    db.queue('select', lobsterRows([1, 1, 1]));
    mockEnsureTeamRating.mockImplementationOnce(async () => ({ rating: 1200, power: 3, created: false, reset: true }));
    await new TeamWatcher().handleEvent(createdLog(10n));

    expect(logMessages(logger.info)).toContain('team rating reset (power changed)');
  });

  test('does not rate a roster with a Base-tier lobster', async () => {
    db.queue('select', lobsterRows([0, 1, 1]));
    await new TeamWatcher().handleEvent(createdLog(11n));

    expect(argOf(chainCalls(db.insert, 0), 'values')).toMatchObject({ active: false });
    expect(mockEnsureTeamRating).not.toHaveBeenCalled();
    expect(mockCurrentBoostEpochId).not.toHaveBeenCalled();
  });

  test('does not rate a roster whose lobsters are not all in the mirror yet', async () => {
    db.queue('select', lobsterRows([1, 1, 1]).slice(0, 2));
    await new TeamWatcher().handleEvent(createdLog(12n));

    expect(mockEnsureTeamRating).not.toHaveBeenCalled();
  });

  test('a rating-layer failure is logged and does not throw', async () => {
    db.queue('select', lobsterRows([1, 1, 1]));
    mockEnsureTeamRating.mockImplementationOnce(async () => {
      throw new Error('db down');
    });
    await new TeamWatcher().handleEvent(createdLog(13n));

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe('TeamWatcher TeamDisbanded', () => {
  beforeEach(resetAll);

  test('stamps disbandedAt, deactivates, and clears the matchmaking queue row', async () => {
    db.queue('delete', [{ id: 1n }]);
    await new TeamWatcher().handleEvent(makeEventLog('TeamDisbanded', { teamId: 9n }));

    expect(db.update).toHaveBeenCalledWith(tables.teams);
    const set = argOf(chainCalls(db.update, 0), 'set');
    expect(set.active).toBe(false);
    expect(set.disbandedAt).toBeInstanceOf(Date);

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledWith(tables.matchmakingQueue);
    expect(logMessages(logger.info)).toContain('removed disbanded team from matchmaking queue');
  });

  test('no queue row: nothing logged, no rating calls', async () => {
    await new TeamWatcher().handleEvent(makeEventLog('TeamDisbanded', { teamId: 9n }));

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
    expect(mockEnsureTeamRating).not.toHaveBeenCalled();
  });
});

describe('TeamWatcher TeamActivityUpdated', () => {
  beforeEach(resetAll);

  test('mirrors the active flag', async () => {
    await new TeamWatcher().handleEvent(makeEventLog('TeamActivityUpdated', { teamId: 9n, active: true }));
    expect(argOf(chainCalls(db.update, 0), 'set')).toEqual({ active: true });
  });
});
