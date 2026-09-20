/**
 * Audit D-07 — what an unauthenticated caller may learn about a battle.
 *
 * F5-01 made the on-chain team reveal atomic so neither player can see the other's team and then
 * walk away, and on that premise a reveal-window timeout is a costless mutual cancel. The public
 * battle read broke the premise: it returned the whole row, including the first revealer's teamId
 * and the salt that proves it, before the on-chain reveal.
 */
import { describe, test, expect, mock } from 'bun:test';

mock.module('@clawbada/db', () => ({ db: {}, battles: {} }));
mock.module('../lib/chain', () => ({ readBattle: async () => null, serializeBigInts: (x: unknown) => x }));

import { BattlePhase } from '@clawbada/game-logic';
import { publicBattleView } from '../routes/game/combat/battle-reads';

const SALT = '0x' + 'ab'.repeat(32);
const row = (over: Record<string, unknown> = {}) => ({
  battleId: 7n, playerA: '0xaaa', playerB: '0xbbb',
  teamA: 0n, teamB: 0n, queuedTeamA: 11n, queuedTeamB: 22n,
  stakeBracket: 0, stakeAmount: '2500', phase: BattlePhase.TeamReveal,
  revealSaltA: null, revealSaltB: null, status: 1, powerA: 3, powerB: 3,
  winner: null, protocolFee: null, winnerPayout: null, totalRounds: null,
  createdAt: new Date(0), settledAt: null,
  ...over,
}) as unknown as Parameters<typeof publicBattleView>[0];

describe('publicBattleView (D-07)', () => {
  test('the first revealer posting a salt changes NOTHING an outsider can read', () => {
    const before = publicBattleView(row());
    const afterFirstSalt = publicBattleView(row({ teamA: 11n, revealSaltA: SALT }));
    expect(afterFirstSalt).toEqual(before);           // no signal at all — not even "someone revealed"
    expect(afterFirstSalt.teamA).toBe(0n);
  });

  test('salts and queued teams never leave the server, in any phase', () => {
    for (const phase of [BattlePhase.Deposit, BattlePhase.TeamReveal, BattlePhase.Active, BattlePhase.Settled]) {
      const v = publicBattleView(row({ phase, teamA: 11n, teamB: 22n, revealSaltA: SALT, revealSaltB: SALT })) as Record<string, unknown>;
      expect(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))).not.toContain(SALT);
      for (const k of ['revealSaltA', 'revealSaltB', 'queuedTeamA', 'queuedTeamB']) expect(k in v).toBe(false);
    }
  });

  test('teams appear once the on-chain reveal has been indexed — they are public on-chain by then', () => {
    const v = publicBattleView(row({ phase: BattlePhase.Active, teamA: 11n, teamB: 22n }));
    expect([v.teamA, v.teamB]).toEqual([11n, 22n]);
    const settled = publicBattleView(row({ phase: BattlePhase.Settled, teamA: 11n, teamB: 22n }));
    expect([settled.teamA, settled.teamB]).toEqual([11n, 22n]);
  });

  test('it is an allow-list: a column added to the table later stays private until listed', () => {
    const v = publicBattleView(row({ someFutureSecret: 'do-not-leak' })) as Record<string, unknown>;
    expect('someFutureSecret' in v).toBe(false);
    expect(Object.keys(v).sort()).toEqual([
      'battleId', 'createdAt', 'phase', 'playerA', 'playerB', 'powerA', 'powerB', 'protocolFee',
      'settledAt', 'stakeAmount', 'stakeBracket', 'status', 'teamA', 'teamB', 'totalRounds', 'winner', 'winnerPayout',
    ]);
  });
});
