import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { makeDb, makeLogger, makeEventLog, tables, chainCalls, argOf, logMessages } from './helpers/mock-db';

// -- Mocks BEFORE importing the watcher --
const db = makeDb();
const logger = makeLogger();
const mockRecordParticipation = mock(async (..._args: unknown[]) => true);
const mockApplyBattleOutcome = mock(async (..._args: unknown[]) => ({ applied: true, ratingA: 1216, ratingB: 1184 }));
const mockCurrentBoostEpochId = mock(async (..._args: unknown[]) => 7);

mock.module('@clawbada/db', () => ({
  db,
  battles: tables.battles,
  battleSessions: tables.battleSessions,
  agents: tables.agents,
  operatorJobs: tables.operatorJobs,
  onChainEvents: tables.onChainEvents,
  indexerState: tables.indexerState,
  recordParticipation: mockRecordParticipation,
  applyBattleOutcome: mockApplyBattleOutcome,
  currentBoostEpochId: mockCurrentBoostEpochId,
}));

mock.module('@clawbada/chain', () => ({
  BattleArenaAbi: [],
  addresses: { battleArena: '0x00000000000000000000000000000000000000a1' },
  getBattleArena: () => ({ read: { getBattle: mock(async () => ({})) } }),
  getPublicClient: () => ({}),
}));

mock.module('../logger', () => ({ log: logger }));

import { BattleWatcher } from '../watchers/battle-watcher';

// -- Fixtures --
const PLAYER_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PLAYER_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const WEI = 10n ** 18n;

function battleRow(overrides: Record<string, unknown> = {}) {
  return {
    playerA: PLAYER_A,
    playerB: PLAYER_B,
    settledAt: null,
    phase: 5,
    teamA: 11n,
    teamB: 22n,
    queuedTeamA: 11n,
    queuedTeamB: 22n,
    powerA: 4,
    powerB: 5,
    ...overrides,
  };
}

function agentRow(address: string) {
  return { address, elo: 1200, wins: 0, losses: 0, totalBattles: 0 };
}

/** Select order inside the settle transaction: battle row, session turn, winner agent, loser agent. */
function queueSettleSelects(row: Record<string, unknown>) {
  db.queue('select', [row], [{ turn: 3 }], [agentRow(PLAYER_A)], [agentRow(PLAYER_B)]);
}

function settledLog(battleId: bigint, winner: string) {
  return makeEventLog('BattleSettled', { battleId, winner, winnerPayout: 4500n * WEI, protocolFee: 500n * WEI });
}

function resetAll() {
  db.reset();
  mockRecordParticipation.mockClear();
  mockApplyBattleOutcome.mockClear();
  mockCurrentBoostEpochId.mockClear();
  for (const level of ['info', 'warn', 'error']) logger[level].mockClear();
}

describe('BattleWatcher BattleProposed', () => {
  beforeEach(resetAll);

  test('advances phase to 5 and records participation for both teams', async () => {
    db.queue('select', [battleRow()]);
    await new BattleWatcher().handleEvent(makeEventLog('BattleProposed', { battleId: 1n, proposedWinner: PLAYER_A, payoutDeadline: 0n }));

    expect(argOf(chainCalls(db.update, 0), 'set')).toEqual({ phase: 5 });
    // V3: the session row mirrors the commitments and flips to 'settling'.
    expect(argOf(chainCalls(db.update, 1), 'set')).toMatchObject({ status: 'settling' });
    expect(mockCurrentBoostEpochId).toHaveBeenCalledTimes(1);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(mockRecordParticipation).toHaveBeenCalledTimes(2);
    expect(mockRecordParticipation.mock.calls[0][0]).toBe(db);
    expect(mockRecordParticipation.mock.calls[0][1]).toEqual({ battleId: 1n, teamId: 11n, opponentTeamId: 22n, epochId: 7, kind: 'played' });
    expect(mockRecordParticipation.mock.calls[1][1]).toEqual({ battleId: 1n, teamId: 22n, opponentTeamId: 11n, epochId: 7, kind: 'played' });
    expect(logMessages(logger.info)).toContain('recorded battle participation');
  });

  test('falls back to the queued team ids when teamA/teamB are still 0', async () => {
    db.queue('select', [battleRow({ teamA: 0n, teamB: 0n, queuedTeamA: 31n, queuedTeamB: 32n })]);
    await new BattleWatcher().handleEvent(makeEventLog('BattleProposed', { battleId: 2n, proposedWinner: PLAYER_B, payoutDeadline: 0n }));

    expect(mockRecordParticipation).toHaveBeenCalledTimes(2);
    expect(mockRecordParticipation.mock.calls[0][1]).toMatchObject({ teamId: 31n, opponentTeamId: 32n });
    expect(mockRecordParticipation.mock.calls[1][1]).toMatchObject({ teamId: 32n, opponentTeamId: 31n });
  });

  test('warns and skips when no team ids are known (phase update still lands)', async () => {
    db.queue('select', [battleRow({ teamA: 0n, teamB: 0n, queuedTeamA: null, queuedTeamB: null })]);
    await new BattleWatcher().handleEvent(makeEventLog('BattleProposed', { battleId: 3n, proposedWinner: PLAYER_A, payoutDeadline: 0n }));

    expect(db.update).toHaveBeenCalledTimes(2); // battles phase + battle_sessions mirror
    expect(mockRecordParticipation).not.toHaveBeenCalled();
    expect(logMessages(logger.warn).some((m) => m.includes('unknown team ids'))).toBe(true);
  });

  test('a rating-layer failure is logged and does not throw', async () => {
    db.queue('select', [battleRow()]);
    mockCurrentBoostEpochId.mockImplementationOnce(async () => {
      throw new Error('anchor unavailable');
    });
    await new BattleWatcher().handleEvent(makeEventLog('BattleProposed', { battleId: 4n, proposedWinner: PLAYER_A, payoutDeadline: 0n }));

    expect(db.update).toHaveBeenCalledTimes(2); // battles phase + battle_sessions mirror
    expect(mockRecordParticipation).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe('BattleWatcher BattleSettled', () => {
  beforeEach(resetAll);

  test("applies the outcome with kind 'battle' when a BattleProposed was mirrored (phase 5)", async () => {
    queueSettleSelects(battleRow({ phase: 5 }));
    await new BattleWatcher().handleEvent(settledLog(5n, PLAYER_A));

    expect(db.transaction).toHaveBeenCalledTimes(1);
    // battles row + battle_sessions status + winner agent + loser agent
    expect(db.update).toHaveBeenCalledTimes(4);
    expect(argOf(chainCalls(db.update, 1), 'set')).toMatchObject({ status: 'settled' });
    const settleSet = argOf(chainCalls(db.update, 0), 'set');
    expect(settleSet).toMatchObject({ winner: PLAYER_A, phase: 6, winnerPayout: '4500', protocolFee: '500', totalRounds: 3 });
    expect(settleSet.settledAt).toBeInstanceOf(Date);

    expect(mockCurrentBoostEpochId).toHaveBeenCalledWith(db);
    expect(mockApplyBattleOutcome).toHaveBeenCalledTimes(1);
    expect(mockApplyBattleOutcome.mock.calls[0][0]).toBe(db);
    expect(mockApplyBattleOutcome.mock.calls[0][1]).toEqual({
      battleId: 5n,
      teamA: 11n,
      teamB: 22n,
      winnerTeam: 11n,
      epochId: 7,
      kind: 'battle',
      fallback: { ownerA: PLAYER_A, ownerB: PLAYER_B, powerA: 4, powerB: 5 },
    });
    // BattleSettled never writes the ledger directly; applyBattleOutcome upserts it.
    expect(mockRecordParticipation).not.toHaveBeenCalled();
    expect(logger.info.mock.calls[0][0]).toMatchObject({ kind: 'battle', teamRating: { applied: true, ratingA: 1216, ratingB: 1184 } });
  });

  test('V3 draw (winner == address(0)): row settled with winner null, no ELO, participation for both teams', async () => {
    queueSettleSelects(battleRow({ phase: 5 }));
    const ZERO = '0x0000000000000000000000000000000000000000';
    await new BattleWatcher().handleEvent(
      makeEventLog('BattleSettled', { battleId: 9n, winner: ZERO, winnerPayout: 0n, protocolFee: 0n }),
    );

    expect(db.transaction).toHaveBeenCalledTimes(1);
    // battles row + battle_sessions status — no agents rows are touched on a draw.
    expect(db.update).toHaveBeenCalledTimes(2);
    const settleSet = argOf(chainCalls(db.update, 0), 'set');
    expect(settleSet).toMatchObject({ winner: null, phase: 6, winnerPayout: '0', protocolFee: '0', totalRounds: 3 });
    expect(settleSet.settledAt).toBeInstanceOf(Date);

    // Nobody won: the winner/loser rating math is skipped, but the match still
    // counts as PLAYED for both teams.
    expect(mockApplyBattleOutcome).not.toHaveBeenCalled();
    expect(mockRecordParticipation).toHaveBeenCalledTimes(2);
    expect(mockRecordParticipation.mock.calls[0][1]).toEqual({ battleId: 9n, teamId: 11n, opponentTeamId: 22n, epochId: 7 });
    expect(mockRecordParticipation.mock.calls[1][1]).toEqual({ battleId: 9n, teamId: 22n, opponentTeamId: 11n, epochId: 7 });
    expect(logger.info.mock.calls.at(-1)?.[1]).toContain('draw settled');
  });

  test("settled straight from Active is a forfeit: kind 'forfeit_loss', winner resolved to teamB", async () => {
    queueSettleSelects(battleRow({ phase: 4 }));
    await new BattleWatcher().handleEvent(settledLog(6n, PLAYER_B));

    expect(mockApplyBattleOutcome).toHaveBeenCalledTimes(1);
    expect(mockApplyBattleOutcome.mock.calls[0][1]).toMatchObject({ winnerTeam: 22n, kind: 'forfeit_loss' });
  });

  test('uses queued team ids and the power floor when reveals/powers are missing', async () => {
    queueSettleSelects(battleRow({ teamA: 0n, teamB: 0n, queuedTeamA: 31n, queuedTeamB: 32n, powerA: null, powerB: null }));
    await new BattleWatcher().handleEvent(settledLog(7n, PLAYER_A));

    expect(mockApplyBattleOutcome.mock.calls[0][1]).toMatchObject({
      teamA: 31n,
      teamB: 32n,
      winnerTeam: 31n,
      fallback: { powerA: 3, powerB: 3 },
    });
  });

  test('replay (settledAt already set) touches nothing', async () => {
    db.queue('select', [battleRow({ settledAt: new Date('2026-09-01T00:00:00Z') })]);
    await new BattleWatcher().handleEvent(settledLog(8n, PLAYER_A));

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(mockApplyBattleOutcome).not.toHaveBeenCalled();
    expect(mockRecordParticipation).not.toHaveBeenCalled();
    expect(mockCurrentBoostEpochId).not.toHaveBeenCalled();
  });

  test('unknown team ids: wallet accounting still runs, rating step skipped with a warning', async () => {
    queueSettleSelects(battleRow({ teamA: 0n, teamB: 0n, queuedTeamA: null, queuedTeamB: null }));
    await new BattleWatcher().handleEvent(settledLog(9n, PLAYER_A));

    expect(db.update).toHaveBeenCalledTimes(4); // battles + battle_sessions + 2 agents
    expect(mockApplyBattleOutcome).not.toHaveBeenCalled();
    expect(logMessages(logger.warn).some((m) => m.includes('unknown team ids'))).toBe(true);
  });

  test('unknown battle row: nothing is written', async () => {
    db.queue('select', []);
    await new BattleWatcher().handleEvent(settledLog(10n, PLAYER_A));

    expect(db.update).not.toHaveBeenCalled();
    expect(mockApplyBattleOutcome).not.toHaveBeenCalled();
  });
});
