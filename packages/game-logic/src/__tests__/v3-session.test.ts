import { describe, expect, test } from 'bun:test';
import { EvolutionTier, LobsterClass } from '../types';
import { v3 } from '../index';

const { createBattle, runBattle, nextActor, hashState, reduceSession, newSessionClock, forfeit, TIMEOUTS_TO_FORFEIT, hasStatus, BOTS, defaultSpawns } = v3;

function team(prefix: string, classes: LobsterClass[]): v3.LobsterInput[] {
  return classes.map((c, i) => ({ id: `${prefix}${i}`, class: c, tier: EvolutionTier.Evolved, purity: 0 }));
}
const OPEN: v3.ArenaLayout = { layoutId: 'open', cols: 6, rows: 5, blockedHexes: [], tier: 'evolved', ...defaultSpawns() };
function mk(seed = 1n) {
  return createBattle({
    battleId: 's', vrfSeed: seed, tier: 'evolved', layout: OPEN,
    teamA: team('A', [LobsterClass.Bulwark, LobsterClass.Sentinel, LobsterClass.Leviathan]),
    teamB: team('B', [LobsterClass.Kraken, LobsterClass.Reaver, LobsterClass.Abyss]),
  });
}
/** Drive until the next actor belongs to `team` (bots play the other side's turns). */
function untilActor(state: v3.AtbBattleState, team: v3.Team, clock: v3.SessionClock) {
  for (let i = 0; i < 20; i++) {
    const a = nextActor(state)!;
    if (hasStatus(a, 'stun')) { reduceSession(state, clock, { type: 'stun_skip' }); continue; }
    if (a.team === team) return a;
    clock = reduceSession(state, clock, { type: 'command', cmd: BOTS.balanced(state, a) }).clock;
  }
  throw new Error('no actor for team');
}

describe('reduceSession', () => {
  test('timeout auto-Defends the actor, grants Defend charge, and counts against that player only', () => {
    const state = mk();
    let clock = newSessionClock();
    const actor = untilActor(state, 'A', clock);
    const before = actor.charge;
    const step = reduceSession(state, clock, { type: 'timeout' });
    expect(step.results).toHaveLength(1);
    expect(step.results[0].action).toBe('defend');
    expect(step.results[0].lobsterId).toBe(actor.id);
    expect(actor.defending).toBe(true);
    expect(actor.charge).toBe(Math.min(3, before + 2));
    expect(step.clock.timeouts).toEqual({ A: 1, B: 0 });
    expect(step.forfeited).toBeNull();
    // Input clock is not mutated.
    expect(clock.timeouts).toEqual({ A: 0, B: 0 });
  });

  test('an accepted command resets that player\'s counter; the opponent\'s counter is untouched', () => {
    const state = mk();
    let clock: v3.SessionClock = { timeouts: { A: 2, B: 1 } };
    const actor = untilActor(state, 'A', clock);
    const step = reduceSession(state, clock, { type: 'command', cmd: { lobsterId: actor.id, action: 'defend' } });
    expect(step.clock.timeouts).toEqual({ A: 0, B: 1 });
  });

  test('a rejected command leaves the battle and the clock untouched', () => {
    const state = mk();
    const clock = newSessionClock();
    const actor = untilActor(state, 'A', clock);
    const h = hashState(state);
    expect(() => reduceSession(state, clock, { type: 'command', cmd: { lobsterId: actor.id, action: 'attack', targetId: 'B0' } })).toThrow(/out of attack range|range/);
    expect(hashState(state)).toBe(h);
    expect(clock.timeouts).toEqual({ A: 0, B: 0 });
  });

  test(`${TIMEOUTS_TO_FORFEIT} consecutive timeouts by the same player forfeit the battle to the opponent`, () => {
    const state = mk(3n);
    let clock = newSessionClock();
    let last: v3.SessionStep | null = null;
    for (let i = 0; i < TIMEOUTS_TO_FORFEIT; i++) {
      untilActor(state, 'B', clock);
      last = reduceSession(state, clock, { type: 'timeout' });
      clock = last.clock;
      if (i < TIMEOUTS_TO_FORFEIT - 1) expect(last.forfeited).toBeNull();
    }
    expect(last!.forfeited).toBe('B');
    expect(last!.results).toHaveLength(2); // auto-Defend, then the forfeit
    expect(last!.results[1].finished).toBe(true);
    expect(last!.results[1].winner).toBe('A');
    expect(state.finished).toBe(true);
    expect(state.winner).toBe('A');
    expect(state.log.at(-1)).toMatchObject({ action: 'forfeit', loser: 'B' });
  });

  test('timeouts interleaved with a played turn do not accumulate', () => {
    const state = mk(4n);
    let clock = newSessionClock();
    untilActor(state, 'A', clock); clock = reduceSession(state, clock, { type: 'timeout' }).clock;
    untilActor(state, 'A', clock); clock = reduceSession(state, clock, { type: 'timeout' }).clock;
    expect(clock.timeouts.A).toBe(2);
    const a = untilActor(state, 'A', clock);
    clock = reduceSession(state, clock, { type: 'command', cmd: BOTS.balanced(state, a) }).clock;
    expect(clock.timeouts.A).toBe(0);
    untilActor(state, 'A', clock); const step = reduceSession(state, clock, { type: 'timeout' });
    expect(step.clock.timeouts.A).toBe(1);
    expect(step.forfeited).toBeNull();
    expect(state.finished).toBe(false);
  });

  test('a stun skip is neither a command nor a timeout, and the other event types refuse a stunned actor', () => {
    // Find a state where the next actor is stunned: play bot turns until one appears.
    let state: v3.AtbBattleState | null = null;
    let clock = newSessionClock();
    for (let seed = 1n; seed < 60n && !state; seed++) {
      const s = mk(seed);
      for (let i = 0; i < 60 && !s.finished; i++) {
        const a = nextActor(s)!;
        if (hasStatus(a, 'stun')) { state = s; break; }
        reduceSession(s, clock, { type: 'command', cmd: BOTS.aggressive(s, a) });
      }
    }
    expect(state).not.toBeNull();
    clock = { timeouts: { A: 2, B: 2 } };
    const actor = nextActor(state!)!;
    expect(() => reduceSession(state!, clock, { type: 'timeout' })).toThrow(/stunned/);
    expect(() => reduceSession(state!, clock, { type: 'command', cmd: { lobsterId: actor.id, action: 'defend' } })).toThrow(/stunned/);
    const step = reduceSession(state!, clock, { type: 'stun_skip' });
    expect(step.results[0].skipped).toBe('stun');
    expect(step.clock.timeouts).toEqual({ A: 2, B: 2 }); // untouched
    expect(step.forfeited).toBeNull();
    expect(() => reduceSession(state!, step.clock, { type: 'stun_skip' })).toThrow(/not stunned/);
  });

  test('resign ends the battle immediately for the resigning team', () => {
    const state = mk(6n);
    runBattle(state, { A: BOTS.balanced, B: BOTS.balanced }, 5);
    const step = reduceSession(state, newSessionClock(), { type: 'resign', team: 'A' });
    expect(step.forfeited).toBe('A');
    expect(state.winner).toBe('B');
    expect(() => forfeit(state, 'A', 'resign')).toThrow(/over/);
  });
});
