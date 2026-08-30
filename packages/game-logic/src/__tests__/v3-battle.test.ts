import { describe, expect, test } from 'bun:test';
import { EvolutionTier, LobsterClass } from '../types';
import { v3 } from '../index';

const { createBattle, runBattle, applyTurn, nextActor, defendPolicy, greedyPolicy, hashState, effectiveSpeed, tickDelta, TurnError, hexKey, hexDistance, defaultSpawns } = v3;

function team(prefix: string, classes: LobsterClass[], tier = EvolutionTier.Evolved, purity = 0): v3.LobsterInput[] {
  return classes.map((c, i) => ({ id: `${prefix}${i}`, class: c, tier, purity }));
}
const OPEN: v3.ArenaLayout = { layoutId: 'open', cols: 6, rows: 5, blockedHexes: [], tier: 'evolved', ...defaultSpawns() };

function mk(seed: bigint, a: LobsterClass[], b: LobsterClass[], layout?: v3.ArenaLayout) {
  return createBattle({ battleId: 'b', vrfSeed: seed, tier: 'evolved', teamA: team('A', a), teamB: team('B', b), layout });
}

function assertInvariants(state: v3.AtbBattleState) {
  const occupied = new Set<string>();
  for (const l of state.lobsters) {
    if (!l.alive) { expect(l.hp).toBe(0n); continue; }
    expect(l.hp).toBeGreaterThan(0n);
    expect(occupied.has(hexKey(l.pos))).toBe(false);
    occupied.add(hexKey(l.pos));
    expect(state.layout.blockedHexes.some(h => hexKey(h) === hexKey(l.pos))).toBe(false);
    expect(l.charge).toBeGreaterThanOrEqual(0);
    expect(l.charge).toBeLessThanOrEqual(3);
  }
}

describe('ATB scheduling', () => {
  test('Speed drives turn frequency: Mantis takes ~1.86× the turns of Leviathan', () => {
    const state = mk(1n, [LobsterClass.Mantis, LobsterClass.Mantis, LobsterClass.Mantis], [LobsterClass.Leviathan, LobsterClass.Leviathan, LobsterClass.Leviathan]);
    runBattle(state, { A: defendPolicy, B: defendPolicy }, 99); // stops just under the 100-turn cap
    const mantis = state.lobsters.filter(l => l.class === LobsterClass.Mantis).reduce((s, l) => s + l.turnsTaken, 0) / 3;
    const levi = state.lobsters.filter(l => l.class === LobsterClass.Leviathan).reduce((s, l) => s + l.turnsTaken, 0) / 3;
    expect(mantis / levi).toBeGreaterThan(1.7);
    expect(mantis / levi).toBeLessThan(2.05);
  });

  test('first actor is the fastest; equal speeds break ties by VRF, deterministically', () => {
    const s1 = mk(42n, [LobsterClass.Bulwark, LobsterClass.Mantis, LobsterClass.Leviathan], [LobsterClass.Ember, LobsterClass.Sentinel, LobsterClass.Kraken]);
    expect(nextActor(s1)!.class).toBe(LobsterClass.Mantis);
    const s2 = mk(42n, [LobsterClass.Mantis, LobsterClass.Mantis, LobsterClass.Mantis], [LobsterClass.Mantis, LobsterClass.Mantis, LobsterClass.Mantis]);
    const s3 = mk(42n, [LobsterClass.Mantis, LobsterClass.Mantis, LobsterClass.Mantis], [LobsterClass.Mantis, LobsterClass.Mantis, LobsterClass.Mantis]);
    expect(nextActor(s2)!.id).toBe(nextActor(s3)!.id);
    const s4 = mk(43n, [LobsterClass.Mantis, LobsterClass.Mantis, LobsterClass.Mantis], [LobsterClass.Mantis, LobsterClass.Mantis, LobsterClass.Mantis]);
    // Different seed may pick a different first actor; either way it must be consistent with the projected bar.
    expect(v3.projectBar(s4, 1)[0].lobsterId).toBe(nextActor(s4)!.id);
  });

  test('effective Speed is clamped to [0.5×, 1.5×] of base', () => {
    const state = mk(1n, [LobsterClass.Mantis, LobsterClass.Mantis, LobsterClass.Mantis], [LobsterClass.Mantis, LobsterClass.Mantis, LobsterClass.Mantis]);
    const l = state.lobsters[0];
    const base = effectiveSpeed(l);
    l.statuses.push({ type: 'slow', turns: 5, value: 900n, since: 0 });
    expect(effectiveSpeed(l)).toBe(base / 2n);
    expect(tickDelta(l)).toBe(v3.TICK_SCALE / (base / 2n));
  });

  test('stun skips the next turn, then 2 turns of immunity block a second Bind', () => {
    const state = mk(7n, [LobsterClass.Kraken, LobsterClass.Kraken, LobsterClass.Kraken], [LobsterClass.Bulwark, LobsterClass.Bulwark, LobsterClass.Bulwark], OPEN);
    const target = state.lobsters.find(l => l.team === 'B')!;
    target.statuses.push({ type: 'stun', turns: 1, value: 0n, since: 0 });
    // Drive until the stunned lobster's turn comes up.
    let res: v3.TurnResult | null = null;
    while (!res || res.lobsterId !== target.id) res = applyTurn(state, nextActor(state)!.id === target.id ? null : defendPolicy(state, nextActor(state)!));
    expect(res.skipped).toBe('stun');
    expect(target.stunImmunity).toBe(2);
    expect(target.statuses.some(s => s.type === 'stun')).toBe(false);
    // A Kraken casting Bind on it now deals damage but does not stun.
    const kraken = state.lobsters.find(l => l.team === 'A')!;
    kraken.charge = 3; kraken.pos = { col: 4, row: target.pos.row }; target.pos = { col: 5, row: target.pos.row };
    kraken.lastTick = -1n; // force it to act next
    const r2 = applyTurn(state, { lobsterId: kraken.id, action: 'special', targetId: target.id });
    expect(r2.action).toBe('special');
    expect(r2.damage.some(d => d.targetId === target.id)).toBe(true);
    expect(target.statuses.some(s => s.type === 'stun')).toBe(false);
  });
});

describe('turn rules', () => {
  test('illegal commands are rejected as a whole', () => {
    const state = mk(3n, [LobsterClass.Mantis, LobsterClass.Bulwark, LobsterClass.Ember], [LobsterClass.Bulwark, LobsterClass.Bulwark, LobsterClass.Bulwark], OPEN);
    const actor = nextActor(state)!; // Mantis, range 3
    const enemy = state.lobsters.find(l => l.team === 'B')!;
    expect(() => applyTurn(state, { lobsterId: enemy.id, action: 'defend' })).toThrow(TurnError);
    expect(() => applyTurn(state, { lobsterId: actor.id, moveTo: { col: 5, row: 0 }, action: 'defend' })).toThrow(/cannot reach/);
    expect(() => applyTurn(state, { lobsterId: actor.id, action: 'attack', targetId: enemy.id })).toThrow(/out of attack range/);
    expect(() => applyTurn(state, { lobsterId: actor.id, action: 'special', targetId: enemy.id })).toThrow(/charge/);
    const ally = state.lobsters.find(l => l.team === 'A' && l.id !== actor.id)!;
    expect(() => applyTurn(state, { lobsterId: actor.id, moveTo: ally.pos, action: 'defend' })).toThrow(/cannot reach/); // occupied
    expect(state.turn).toBe(0); // nothing applied
  });

  test('charge economy: +1 per turn, Defend +2, cap 3, Special consumes all', () => {
    const state = mk(5n, [LobsterClass.Bulwark, LobsterClass.Bulwark, LobsterClass.Bulwark], [LobsterClass.Bulwark, LobsterClass.Bulwark, LobsterClass.Bulwark], OPEN);
    const a = nextActor(state)!;
    expect(applyTurn(state, { lobsterId: a.id, action: 'none' }).chargeAfter).toBe(1);
    // force same actor again
    a.lastTick = -1n;
    expect(applyTurn(state, { lobsterId: a.id, action: 'defend' }).chargeAfter).toBe(3);
    a.lastTick = -1n;
    expect(applyTurn(state, { lobsterId: a.id, action: 'defend' }).chargeAfter).toBe(3); // capped
    a.lastTick = -1n;
    expect(applyTurn(state, { lobsterId: a.id, action: 'special' }).chargeAfter).toBe(0); // Fortify, targetless
    expect(state.lobsters.filter(l => l.team === 'A').every(l => l.statuses.some(s => s.type === 'fortify'))).toBe(true);
  });

  test('attack damage falls off with distance: 100% / 75% / 50%, and 4+ is illegal', () => {
    const dmgAt = (dist: number) => {
      const state = mk(11n, [LobsterClass.Leviathan, LobsterClass.Bulwark, LobsterClass.Bulwark], [LobsterClass.Bulwark, LobsterClass.Bulwark, LobsterClass.Bulwark], OPEN);
      const actor = state.lobsters.find(l => l.class === LobsterClass.Leviathan)!;
      const target = state.lobsters.find(l => l.team === 'B')!;
      for (const l of state.lobsters) l.lastTick = 10_000_000n;
      actor.lastTick = -1n; // Leviathan acts first
      actor.pos = { col: 0, row: 2 }; target.pos = { col: dist, row: 2 };
      expect(hexDistance(actor.pos, target.pos)).toBe(dist);
      return { res: () => applyTurn(state, { lobsterId: actor.id, action: 'attack', targetId: target.id }) };
    };
    const d1 = dmgAt(1).res().damage.find(d => d.kind === 'attack')!.amount;
    const d2 = dmgAt(2).res().damage.find(d => d.kind === 'attack')!.amount;
    const d3 = dmgAt(3).res().damage.find(d => d.kind === 'attack')!.amount;
    expect(d1).toBeGreaterThan(0n);
    expect(d2).toBe((d1 * 750n) / 1000n);
    expect(d3).toBe((d1 * 500n) / 1000n);
    expect(() => dmgAt(4).res()).toThrow(/out of attack range/);
  });

  test('Defend halves incoming and counters only adjacent attackers; Specials are not countered', () => {
    const setup = (dist: number, action: 'attack' | 'special') => {
      const state = mk(13n, [LobsterClass.Leviathan, LobsterClass.Bulwark, LobsterClass.Bulwark], [LobsterClass.Bulwark, LobsterClass.Bulwark, LobsterClass.Bulwark], OPEN);
      const actor = state.lobsters.find(l => l.class === LobsterClass.Leviathan)!;
      const target = state.lobsters.find(l => l.team === 'B')!;
      for (const l of state.lobsters) l.lastTick = 10_000_000n;
      actor.lastTick = -1n; actor.charge = 3;
      actor.pos = { col: 0, row: 2 }; target.pos = { col: dist, row: 2 }; target.defending = true;
      return applyTurn(state, { lobsterId: actor.id, action, targetId: target.id });
    };
    const adj = setup(1, 'attack');
    expect(adj.damage.some(d => d.kind === 'counter')).toBe(true);
    const far = setup(2, 'attack');
    expect(far.damage.some(d => d.kind === 'counter')).toBe(false);
    const special = setup(1, 'special'); // Crush, adjacent
    expect(special.damage.some(d => d.kind === 'counter')).toBe(false);
    // halving: compare vs the same attack on a non-defending target
    const stateN = mk(13n, [LobsterClass.Leviathan, LobsterClass.Bulwark, LobsterClass.Bulwark], [LobsterClass.Bulwark, LobsterClass.Bulwark, LobsterClass.Bulwark], OPEN);
    const a = stateN.lobsters.find(l => l.class === LobsterClass.Leviathan)!; const t = stateN.lobsters.find(l => l.team === 'B')!;
    for (const l of stateN.lobsters) l.lastTick = 10_000_000n; a.lastTick = -1n; a.pos = { col: 0, row: 2 }; t.pos = { col: 1, row: 2 };
    const undefended = applyTurn(stateN, { lobsterId: a.id, action: 'attack', targetId: t.id }).damage.find(d => d.kind === 'attack')!.amount;
    expect(adj.damage.find(d => d.kind === 'attack')!.amount).toBe(undefended / 2n);
  });

  test('status durations count turns of the affected lobster and are not ticked on the turn applied', () => {
    const state = mk(17n, [LobsterClass.Specter, LobsterClass.Bulwark, LobsterClass.Bulwark], [LobsterClass.Bulwark, LobsterClass.Bulwark, LobsterClass.Bulwark], OPEN);
    const specter = state.lobsters.find(l => l.class === LobsterClass.Specter)!;
    const target = state.lobsters.find(l => l.team === 'B')!;
    for (const l of state.lobsters) l.lastTick = 10_000_000n;
    specter.lastTick = -1n; specter.charge = 3; specter.pos = { col: 1, row: 2 }; target.pos = { col: 3, row: 2 };
    applyTurn(state, { lobsterId: specter.id, action: 'special', targetId: target.id });
    const haunt = target.statuses.find(s => s.type === 'haunt')!;
    expect(haunt.turns).toBeGreaterThanOrEqual(4);
    const startTurns = haunt.turns;
    // Other lobsters acting must not tick the target's haunt.
    const other = state.lobsters.find(l => l.team === 'A' && l.id !== specter.id)!;
    other.lastTick = -1n;
    applyTurn(state, { lobsterId: other.id, action: 'defend' });
    expect(target.statuses.find(s => s.type === 'haunt')!.turns).toBe(startTurns);
    // The target's own turn ticks it.
    target.lastTick = -1n;
    applyTurn(state, { lobsterId: target.id, action: 'defend' });
    expect(target.statuses.find(s => s.type === 'haunt')!.turns).toBe(startTurns - 1);
  });
});

describe('full battles', () => {
  test('greedy vs greedy terminates with a winner, within the turn cap, invariants hold every turn', () => {
    const classes = Object.values(LobsterClass).filter((v): v is LobsterClass => typeof v === 'number');
    let decided = 0;
    for (let i = 0; i < 40; i++) {
      const a = [classes[i % 10], classes[(i * 3) % 10], classes[(i * 7) % 10]];
      const b = [classes[(i + 5) % 10], classes[(i * 3 + 1) % 10], classes[(i * 7 + 4) % 10]];
      const state = createBattle({ battleId: `b${i}`, vrfSeed: BigInt(1000 + i), tier: 'elite', teamA: team('A', a, EvolutionTier.Elite, i % 7), teamB: team('B', b, EvolutionTier.Elite, (i * 2) % 7) });
      while (!state.finished) {
        const actor = nextActor(state)!;
        applyTurn(state, actor.statuses.some(s => s.type === 'stun') ? null : greedyPolicy(state, actor));
        assertInvariants(state);
        expect(state.turn).toBeLessThanOrEqual(100);
      }
      expect(state.winner).not.toBeNull();
      if (state.winner !== 'draw') decided++;
    }
    expect(decided).toBeGreaterThan(30);
  });

  test('deterministic: same seed + same commands → identical log and final hash', () => {
    const play = () => {
      const state = mk(2024n, [LobsterClass.Reaver, LobsterClass.Sentinel, LobsterClass.Kraken], [LobsterClass.Ember, LobsterClass.Abyss, LobsterClass.Tempest]);
      runBattle(state, { A: greedyPolicy, B: greedyPolicy });
      return state;
    };
    const s1 = play(), s2 = play();
    expect(s1.log.length).toBeGreaterThan(5);
    expect(JSON.stringify(s1.log)).toBe(JSON.stringify(s2.log));
    expect(hashState(s1)).toBe(hashState(s2));
    expect(s1.log.every(e => /^0x[0-9a-f]{64}$/.test(e.postStateHash))).toBe(true);
  });

  test('turn cap: all-Defend battles end at 100 turns with HP% tiebreak', () => {
    const state = mk(9n, [LobsterClass.Bulwark, LobsterClass.Bulwark, LobsterClass.Bulwark], [LobsterClass.Bulwark, LobsterClass.Bulwark, LobsterClass.Bulwark]);
    runBattle(state, { A: defendPolicy, B: defendPolicy });
    expect(state.finished).toBe(true);
    expect(state.turn).toBe(100);
    expect(state.winner).toBe('draw');
  });
});

describe('turn-cap tiebreaks', () => {
  test('equal HP% at the cap → the team that dealt more damage wins; nothing dealt → draw', () => {
    const state = mk(21n, [LobsterClass.Bulwark, LobsterClass.Bulwark, LobsterClass.Bulwark], [LobsterClass.Bulwark, LobsterClass.Bulwark, LobsterClass.Bulwark]);
    state.turn = 99;
    state.damageDealt.B = 40n;
    applyTurn(state, { lobsterId: nextActor(state)!.id, action: 'none' });
    expect(state.finished).toBe(true);
    expect(state.winner).toBe('B');
  });

  test('damage tally credits attacks, counters and bleed to the right team', () => {
    const state = mk(23n, [LobsterClass.Reaver, LobsterClass.Bulwark, LobsterClass.Bulwark], [LobsterClass.Bulwark, LobsterClass.Bulwark, LobsterClass.Bulwark], OPEN);
    const reaver = state.lobsters.find(l => l.class === LobsterClass.Reaver)!;
    const target = state.lobsters.find(l => l.team === 'B')!;
    for (const l of state.lobsters) l.lastTick = 10_000_000n;
    reaver.lastTick = -1n; reaver.charge = 3; reaver.pos = { col: 1, row: 2 }; target.pos = { col: 2, row: 2 }; target.defending = true;
    const r = applyTurn(state, { lobsterId: reaver.id, action: 'special', targetId: target.id }); // Rend: no counter vs Special
    const hit = r.damage.filter(d => d.kind === 'special').reduce((s, d) => s + d.amount, 0n);
    expect(state.damageDealt.A).toBe(hit);
    expect(state.damageDealt.B).toBe(0n);
    // target's next turn: bleed ticks, credited to A
    target.lastTick = -1n;
    const before = state.damageDealt.A;
    applyTurn(state, { lobsterId: target.id, action: 'defend' });
    expect(state.damageDealt.A).toBeGreaterThan(before);
  });
});
