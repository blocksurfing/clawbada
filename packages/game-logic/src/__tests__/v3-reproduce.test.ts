/**
 * reproduceSession / forfeitedSide: what the watchdog re-derives from a stored session, and what
 * the API puts in `settle(..., forfeiter)`.
 */
import { describe, expect, test } from 'bun:test';
import { EvolutionTier, LobsterClass } from '../types';
import { v3 } from '../index';

const A = [LobsterClass.Reaver, LobsterClass.Kraken, LobsterClass.Ember];
const B = [LobsterClass.Bulwark, LobsterClass.Abyss, LobsterClass.Tempest];
const inputs = (side: 'A' | 'B') => (side === 'A' ? A : B).map((c, i) => ({ id: `${side}${i}`, class: c, tier: EvolutionTier.Evolved, purity: i }));
const roster = (['A', 'B'] as const).flatMap((side) => inputs(side).map((l, slot) => ({ id: l.id, side, slot, classId: l.class, tier: l.tier, purity: l.purity, legend: false })));

function play(end: 'wipeout' | 'timeout' | 'resign', seed = 4242n) {
  const state = v3.createBattle({ battleId: '9', vrfSeed: seed, tier: 'evolved', teamA: inputs('A'), teamB: inputs('B') });
  if (end === 'wipeout') v3.runBattle(state, { A: v3.BOTS.balanced, B: v3.BOTS.balanced });
  else if (end === 'resign') v3.reduceSession(state, { timeouts: { A: 0, B: 0 } }, { type: 'resign', team: 'B' });
  else {
    let clock: v3.SessionClock = { timeouts: { A: 0, B: 0 } };
    while (!state.finished) {
      const actor = v3.nextActor(state)!;
      const stunned = actor.statuses.some((s) => s.type === 'stun');
      const ev: v3.SessionEvent = stunned ? { type: 'stun_skip' } : actor.team === 'A' ? { type: 'timeout' } : { type: 'command', cmd: v3.BOTS.balanced(state, actor) };
      clock = v3.reduceSession(state, clock, ev).clock;
    }
  }
  return state;
}
const stored = (state: v3.AtbBattleState) => ({ battleId: '9', tier: 'evolved', roster, stateJson: v3.serializeState(state) });

describe('forfeitedSide', () => {
  test('null when the battle was fought to the end', () => {
    expect(v3.forfeitedSide(play('wipeout'))).toBeNull();
  });
  test('the side that timed out three turns in a row', () => {
    const s = play('timeout');
    expect(s.winner).toBe('B');
    expect(v3.forfeitedSide(s)).toBe('A');
  });
  test('the side that resigned', () => {
    expect(v3.forfeitedSide(play('resign'))).toBe('B');
  });
});

describe('reproduceSession', () => {
  test('a stored battle re-plays to the same winner, hashes and repair damage', () => {
    const s = play('wipeout');
    const r = v3.reproduceSession(stored(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.winner).toBe(s.winner!);
    expect(r.forfeiter).toBeNull();
    expect(r.finalStateHash).toBe(v3.hashState(s));
    expect(r.turnLogHash).toBe(v3.turnLogHash(s, [...inputs('A'), ...inputs('B')]));
    expect({ damageA: r.damageA, damageB: r.damageB }).toEqual(v3.repairDamage(s));
  });

  test('a timeout forfeit reproduces with its forfeiter', () => {
    const r = v3.reproduceSession(stored(play('timeout')));
    expect(r).toMatchObject({ ok: true, winner: 'B', forfeiter: 'A' });
  });

  test('an edited log does not reproduce', () => {
    const wire = JSON.parse(v3.serializeState(play('wipeout')));
    wire.log[1] = { ...wire.log[1], action: 'defend', targetId: undefined, moveTo: undefined };
    expect(v3.reproduceSession({ ...stored(play('wipeout')), stateJson: JSON.stringify(wire) }).ok).toBe(false);
  });

  test('a forfeit the log does not justify (one timeout, then "timeout" forfeit) does not reproduce', () => {
    const s = v3.createBattle({ battleId: '9', vrfSeed: 4242n, tier: 'evolved', teamA: inputs('A'), teamB: inputs('B') });
    v3.forfeit(s, 'A', 'timeout');
    expect(v3.reproduceSession(stored(s)).ok).toBe(false);
  });

  test('a swapped roster, another battle id, or an unfinished battle does not reproduce', () => {
    const s = play('wipeout');
    const swapped = roster.map((r) => (r.id === 'A0' ? { ...r, classId: LobsterClass.Mantis } : r));
    expect(v3.reproduceSession({ ...stored(s), roster: swapped }).ok).toBe(false);
    expect(v3.reproduceSession({ ...stored(s), battleId: '10' }).ok).toBe(false);
    const live = v3.createBattle({ battleId: '9', vrfSeed: 1n, tier: 'evolved', teamA: inputs('A'), teamB: inputs('B') });
    expect(v3.reproduceSession(stored(live))).toEqual({ ok: false, reason: 'the stored battle is not finished' });
    expect(v3.reproduceSession({ ...stored(s), stateJson: '{not json' }).ok).toBe(false);
  });
});
