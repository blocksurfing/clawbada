import { describe, expect, test } from 'bun:test';
import { EvolutionTier, LobsterClass } from '../types';
import { v3 } from '../index';

const team = (p: string, cs: LobsterClass[]) => cs.map((c, j) => ({ id: `${p}${j}`, class: c, tier: EvolutionTier.Elite, purity: 0 }));
const OPEN: v3.ArenaLayout = { layoutId: 'open', cols: 6, rows: 5, blockedHexes: [], tier: 'elite', ...v3.defaultSpawns() };
const B = LobsterClass.Bulwark, M = LobsterClass.Mantis, S = LobsterClass.Specter;

function setup(rules: Partial<v3.BattleRules>) {
  const s = v3.createBattle({ battleId: 't', vrfSeed: 7n, tier: 'elite', teamA: team('A', [M, M, M]), teamB: team('B', [B, S, S]), layout: OPEN, rules });
  for (const l of s.lobsters) l.lastTick = 10_000_000n;
  return s;
}

describe('anti-focus mechanics (default-off rule knobs)', () => {
  test('taunt: adjacent enemies must hit the Fortified Bulwark; distant enemies are unaffected', () => {
    const s = setup({ fortifyTaunt: true });
    const bul = s.lobsters.find(l => l.class === B)!;
    const spec = s.lobsters.find(l => l.class === S)!;
    const near = s.lobsters.find(l => l.id === 'A0')!;
    const far = s.lobsters.find(l => l.id === 'A1')!;
    bul.pos = { col: 2, row: 2 }; spec.pos = { col: 3, row: 2 };
    near.pos = { col: 2, row: 1 }; // adjacent to Bulwark, Specter within range 3
    far.pos = { col: 5, row: 4 };
    bul.charge = 3; bul.lastTick = -1n;
    v3.applyTurn(s, { lobsterId: bul.id, action: 'special' }); // Fortify + taunt
    expect(bul.statuses.some(st => st.type === 'taunt')).toBe(true);
    expect(v3.attackTargets(s, near).map(l => l.id)).toEqual([bul.id]);
    near.lastTick = -1n;
    expect(() => v3.applyTurn(s, { lobsterId: near.id, action: 'attack', targetId: spec.id })).toThrow(/taunt/);
    expect(v3.attackTargets(s, far).length).toBeGreaterThan(1); // not adjacent — free targeting
    // Bots stay legal automatically: either they hit the taunter, or they step
    // out of taunt range first (the intended counterplay) — never an illegal shot.
    const cmd = v3.balancedPolicy(s, near);
    expect(() => v3.validateTurn(s, cmd)).not.toThrow();
    if (cmd.action === 'attack' && !cmd.moveTo) expect(cmd.targetId).toBe(bul.id);
  });

  test('focus falloff: second hit inside the window is weaker; window resets on the target turn', () => {
    const dmgOf = (rules: Partial<v3.BattleRules>) => {
      const s = setup(rules);
      const a0 = s.lobsters.find(l => l.id === 'A0')!, a1 = s.lobsters.find(l => l.id === 'A1')!;
      const spec = s.lobsters.find(l => l.id === 'B1')!;
      a0.pos = { col: 2, row: 2 }; a1.pos = { col: 2, row: 1 }; spec.pos = { col: 3, row: 2 };
      a0.lastTick = -2n;
      const r1 = v3.applyTurn(s, { lobsterId: a0.id, action: 'attack', targetId: spec.id });
      a1.lastTick = -1n;
      const r2 = v3.applyTurn(s, { lobsterId: a1.id, action: 'attack', targetId: spec.id });
      return { first: r1.damage[0].amount, second: r2.damage[0].amount, state: s, spec };
    };
    const off = dmgOf({});
    const on = dmgOf({ focusFalloffBps: 2000n });
    expect(on.first).toBe(off.first); // first hit unaffected
    expect(on.second).toBe((off.second * 8000n) / 10_000n); // −20% on the second
    expect(on.spec.recentHits).toBe(2);
    on.spec.lastTick = -1n;
    v3.applyTurn(on.state, { lobsterId: on.spec.id, action: 'defend' });
    expect(on.spec.recentHits).toBe(0);
  });

  test('guard penalty: ranged shots past an adjacent frontliner are reduced', () => {
    const dmgAt = (rules: Partial<v3.BattleRules>, guard: boolean) => {
      const s = setup(rules);
      const a0 = s.lobsters.find(l => l.id === 'A0')!;
      const bul = s.lobsters.find(l => l.class === B)!, spec = s.lobsters.find(l => l.id === 'B1')!;
      a0.pos = { col: 2, row: 2 }; spec.pos = { col: 4, row: 2 };
      bul.pos = guard ? { col: 3, row: 2 } : { col: 5, row: 4 }; // adjacent... actually (3,2) is adjacent to (2,2)? dist 1 ✓
      a0.lastTick = -1n;
      return v3.applyTurn(s, { lobsterId: a0.id, action: 'attack', targetId: spec.id }).damage[0].amount;
    };
    const base = dmgAt({}, true);
    const guarded = dmgAt({ guardPenaltyBps: 3000n }, true);
    const unguarded = dmgAt({ guardPenaltyBps: 3000n }, false);
    expect(guarded).toBe((base * 7000n) / 10_000n);
    expect(unguarded).toBe(base);
  });

  test('all knobs off → behaviour identical to a battle without them', () => {
    const run = (rules?: Partial<v3.BattleRules>) => {
      const s = v3.createBattle({ battleId: 'z', vrfSeed: 123n, tier: 'elite', teamA: team('A', [M, B, S]), teamB: team('B', [S, M, B]), rules });
      v3.runBattle(s, { A: v3.balancedPolicy, B: v3.balancedPolicy });
      return v3.hashState(s);
    };
    expect(run()).toBe(run({ fortifyTaunt: false, focusFalloffBps: 0n, guardPenaltyBps: 0n }));
  });
});

describe('Specter prototype knobs', () => {
  test('attackRange override: range-4 shot is legal and uses the long-shot multiplier', () => {
    const s = setup({ attackRange: { [S]: 4 } });
    const spec = s.lobsters.find(l => l.id === 'B1')!;
    const m = s.lobsters.find(l => l.id === 'A0')!;
    spec.pos = { col: 1, row: 2 }; m.pos = { col: 5, row: 2 };
    spec.lastTick = -1n;
    const r = v3.applyTurn(s, { lobsterId: spec.id, action: 'attack', targetId: m.id });
    expect(r.damage[0].amount).toBeGreaterThan(0n);
    // and a non-overridden class still cannot shoot at 4
    const s2 = setup({ attackRange: { [S]: 4 } });
    const m2 = s2.lobsters.find(l => l.id === 'A0')!; const spec2 = s2.lobsters.find(l => l.id === 'B1')!;
    m2.pos = { col: 1, row: 2 }; spec2.pos = { col: 5, row: 2 }; m2.lastTick = -1n;
    expect(() => v3.applyTurn(s2, { lobsterId: m2.id, action: 'attack', targetId: spec2.id })).toThrow(/out of attack range/);
  });

  test('firstHitReduction: first hit each window reduced, second hit full', () => {
    const run = (rules: Partial<v3.BattleRules>) => {
      const s = setup(rules);
      const a0 = s.lobsters.find(l => l.id === 'A0')!, a1 = s.lobsters.find(l => l.id === 'A1')!;
      const spec = s.lobsters.find(l => l.id === 'B1')!;
      a0.pos = { col: 2, row: 2 }; a1.pos = { col: 2, row: 1 }; spec.pos = { col: 3, row: 2 };
      a0.lastTick = -2n;
      const r1 = v3.applyTurn(s, { lobsterId: a0.id, action: 'attack', targetId: spec.id });
      a1.lastTick = -1n;
      const r2 = v3.applyTurn(s, { lobsterId: a1.id, action: 'attack', targetId: spec.id });
      return { first: r1.damage[0].amount, second: r2.damage[0].amount };
    };
    // Specter now carries a 30% dodge BY DEFAULT (spec kit) — baseline must zero it explicitly.
    const off = run({ firstHitReduction: { [S]: 0n } });
    const on = run({ firstHitReduction: { [S]: 300n } });
    expect(on.first).toBe((off.first * 700n) / 1000n);
    expect(on.second).toBe(off.second); // window already opened — full damage
  });
});
