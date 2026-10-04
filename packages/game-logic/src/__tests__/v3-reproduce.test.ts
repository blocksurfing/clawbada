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

  // M2 (review 2026-10-03): a lobster that dies to bleed at the start of a timed-out turn is
  // logged as a 'skip' with timeout = true (applyTurn never resolves the auto-Defend). The audit
  // used to reject every timed-out entry that was not a plain Defend, so an honest result with
  // that one entry could not be reproduced — and the watchdog froze it.
  describe('a bleed death during a timed-out turn (M2)', () => {
    /** B's turns time out from the moment a bleeding B lobster reaches its turn with hp <= the
     *  bleed tick; everyone else plays the aggressive bot. Seed 4 produces it at turn 24. */
    function playBleedTimeout(seed = 4n) {
      const state = v3.createBattle({ battleId: '9', vrfSeed: seed, tier: 'evolved', teamA: inputs('A'), teamB: inputs('B') });
      let clock: v3.SessionClock = { timeouts: { A: 0, B: 0 } };
      let dyingTurn: number | null = null;
      while (!state.finished) {
        const actor = v3.nextActor(state)!;
        const stunned = actor.statuses.some((s) => s.type === 'stun');
        const bleed = actor.statuses.find((s) => s.type === 'bleed');
        let ev: v3.SessionEvent;
        if (stunned) ev = { type: 'stun_skip' };
        else if (dyingTurn === null && actor.team === 'B' && bleed && actor.hp <= bleed.value) { dyingTurn = state.turn + 1; ev = { type: 'timeout' }; }
        else if (dyingTurn !== null && actor.team === 'B') ev = { type: 'timeout' };
        else ev = { type: 'command', cmd: v3.BOTS.aggressive(state, actor) };
        clock = v3.reduceSession(state, clock, ev).clock;
      }
      return { state, dyingTurn };
    }

    test('the log carries a timed-out skip, and the stored session reproduces with its forfeiter', () => {
      const { state, dyingTurn } = playBleedTimeout();
      expect(dyingTurn).not.toBeNull();
      const entry = state.log.find((e) => e.turn === dyingTurn)!;
      expect(entry).toMatchObject({ action: 'skip', timeout: true });
      expect(entry.lobsterId).toMatch(/^B/);
      expect(state.lobsters.find((l) => l.id === entry.lobsterId)!.alive).toBe(false);
      // B timed out three times in a row starting with that skip, so the forfeit only replays
      // if the skip counted toward the streak.
      expect(state.log.filter((e) => e.timeout).length).toBe(3);
      expect(v3.forfeitedSide(state)).toBe('B');
      const r = v3.reproduceSession(stored(state));
      expect(r).toMatchObject({ ok: true, winner: 'A', forfeiter: 'B' });
      if (!r.ok) return;
      expect(r.finalStateHash).toBe(v3.hashState(state));
      expect(r.turnLogHash).toBe(v3.turnLogHash(state, [...inputs('A'), ...inputs('B')]));
    });

    test('a timed-out entry that is neither a plain Defend nor a death-skip still does not replay', () => {
      const s = play('wipeout');
      const wire = JSON.parse(v3.serializeState(s));
      const i = wire.log.findIndex((e: { action: string }) => e.action === 'attack');
      expect(i).toBeGreaterThan(-1);
      wire.log[i] = { ...wire.log[i], timeout: true };
      const r = v3.reproduceSession({ ...stored(s), stateJson: JSON.stringify(wire) });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toContain('a timed-out turn must be a plain Defend');
    });

    test('a timed-out skip by a stunned lobster still does not replay', () => {
      const { state } = playBleedTimeout();
      const wire = JSON.parse(v3.serializeState(state));
      // Pretend a stun skip was a timeout: the first non-timed-out skip, if any, is a stun skip.
      const i = wire.log.findIndex((e: { action: string; timeout?: boolean }) => e.action === 'skip' && !e.timeout);
      if (i === -1) return; // no stun skip in this battle; nothing to corrupt
      wire.log[i] = { ...wire.log[i], timeout: true };
      const r = v3.reproduceSession({ ...stored(state), stateJson: JSON.stringify(wire) });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toContain('a stunned lobster cannot time out');
    });
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
