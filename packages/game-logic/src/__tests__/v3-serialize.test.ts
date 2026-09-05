import { describe, expect, test } from 'bun:test';
import { EvolutionTier, LobsterClass } from '../types';
import { v3 } from '../index';

const { createBattle, runBattle, applyTurn, nextActor, hashState, toWire, fromWire, serializeState, deserializeState, clientView, BOTS, greedyPolicy, legalMoves, attackTargets, specialTargets } = v3;

function team(prefix: string, classes: LobsterClass[], tier = EvolutionTier.Elite, purity = 3): v3.LobsterInput[] {
  return classes.map((c, i) => ({ id: `${prefix}${i}`, class: c, tier, purity, legend: i === 1 }));
}
const COMP_A = [LobsterClass.Bulwark, LobsterClass.Mantis, LobsterClass.Sentinel];
const COMP_B = [LobsterClass.Kraken, LobsterClass.Reaver, LobsterClass.Specter];

function midBattle(seed = 7n, turns = 50) {
  const state = createBattle({
    battleId: 'wire-1', vrfSeed: seed, tier: 'elite', teamA: team('A', COMP_A), teamB: team('B', COMP_B),
    rules: { focusFalloffBps: 1500n, moveRange: { [LobsterClass.Bulwark]: 2 }, attackMult: { [LobsterClass.Mantis]: 1100n } },
  });
  runBattle(state, { A: BOTS.balanced, B: BOTS.aggressive }, turns);
  return state;
}

describe('wire format', () => {
  test('toWire/fromWire round-trips a mid-battle state exactly (hash, bigints, statuses, rules)', () => {
    const state = midBattle();
    expect(state.turn).toBeGreaterThan(20);
    const back = fromWire(toWire(state));
    expect(hashState(back)).toBe(hashState(state));
    expect(back.vrfSeed).toBe(state.vrfSeed);
    expect(back.tick).toBe(state.tick);
    expect(back.damageDealt).toEqual(state.damageDealt);
    expect(back.lobsters).toEqual(state.lobsters);
    expect(back.rules).toEqual(state.rules);
    expect(back.layout).toEqual(state.layout);
    expect(back.log).toEqual(state.log);
  });

  test('serializeState produces bigint-free JSON that deserializes and keeps playing identically', () => {
    const a = midBattle(11n, 30);
    const json = serializeState(a);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.stringify(JSON.parse(json))).toBe(json); // plain JSON round-trips (no bigints leaked into the string)
    const b = deserializeState(json);
    // Continue both copies with the same policy: byte-identical logs and hashes.
    runBattle(a, { A: greedyPolicy, B: greedyPolicy }, 40);
    runBattle(b, { A: greedyPolicy, B: greedyPolicy }, 40);
    expect(hashState(b)).toBe(hashState(a));
    expect(JSON.stringify(b.log)).toBe(JSON.stringify(a.log));
    expect(b.finished).toBe(a.finished);
    expect(b.winner).toBe(a.winner);
  });

  test('deserializeState rejects an unknown wire version', () => {
    const json = serializeState(midBattle(3n, 5)).replace('"v":1', '"v":2');
    expect(() => deserializeState(json)).toThrow(/wire version/);
  });

  test('a freshly created battle round-trips too (turn 0, empty log)', () => {
    const state = createBattle({ battleId: 'fresh', vrfSeed: 99n, tier: 'apex', teamA: team('A', COMP_A, EvolutionTier.Apex), teamB: team('B', COMP_B, EvolutionTier.Apex) });
    expect(fromWire(toWire(state))).toEqual(state);
  });
});

describe('clientView', () => {
  test('strips the VRF seed and adds next actor + bar', () => {
    const state = midBattle(0x1f3a9c77e2b4d5586a0f9e1c2d3b4a5968778695a4b3c2d1e0f1a2b3c4d5e6f7n, 12);
    const view = clientView(state);
    expect('vrfSeed' in view).toBe(false);
    expect(JSON.stringify(view).includes(state.vrfSeed.toString())).toBe(false);
    expect(view.nextActorId).toBe(nextActor(state)!.id);
    expect(view.bar.length).toBeGreaterThan(0);
    expect(view.bar[0].lobsterId).toBe(view.nextActorId!);
    expect(view.turn).toBe(state.turn);
    expect(view.log.length).toBe(state.log.length);
  });

  test('a seedless rebuild answers every legality query identically', () => {
    const state = midBattle(21n, 18);
    const view = clientView(state);
    const seedless = fromWire({ ...view, vrfSeed: '0' });
    const actor = nextActor(state)!;
    const actor2 = nextActor(seedless)!;
    expect(actor2.id).toBe(actor.id);
    expect(legalMoves(seedless, actor2)).toEqual(legalMoves(state, actor));
    expect(attackTargets(seedless, actor2).map(l => l.id)).toEqual(attackTargets(state, actor).map(l => l.id));
    expect(specialTargets(seedless, actor2).map(l => l.id)).toEqual(specialTargets(state, actor).map(l => l.id));
  });

  test('finished battle: no next actor, empty bar', () => {
    const state = createBattle({ battleId: 'f', vrfSeed: 2n, tier: 'evolved', teamA: team('A', COMP_A, EvolutionTier.Evolved), teamB: team('B', COMP_B, EvolutionTier.Evolved) });
    runBattle(state, { A: BOTS.aggressive, B: BOTS.aggressive });
    expect(state.finished).toBe(true);
    const view = clientView(state);
    expect(view.nextActorId).toBeNull();
    expect(view.bar).toEqual([]);
    // applyTurn on a finished battle still throws through the wire round trip
    expect(() => applyTurn(fromWire(toWire(state)), null)).toThrow();
  });
});
