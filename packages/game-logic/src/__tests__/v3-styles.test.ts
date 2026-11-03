import { describe, expect, test } from 'bun:test';
import { EvolutionTier, LobsterClass } from '../types';
import { v3 } from '../index';

const ALL = [...Array(10).keys()] as LobsterClass[];
const team = (p: string, cs: LobsterClass[], i: number) => cs.map((c, j) => ({ id: `${p}${j}`, class: c, tier: EvolutionTier.Elite, purity: (i + j) % 7 }));
const comp = (i: number, k: number) => [ALL[(i * 7 + k) % 10], ALL[(i * 3 + k * 2) % 10], ALL[(i * 11 + k * 5) % 10]];

describe('strategy styles', () => {
  test('every style produces only legal commands and battles finish (30 battles each)', () => {
    for (const [name, policy] of Object.entries(v3.STYLE_BOTS)) {
      if (name === 'planner') continue;   // ~1 s a battle: covered by its own suite below
      for (let i = 0; i < 30; i++) {
        const s = v3.createBattle({ battleId: `${name}${i}`, vrfSeed: BigInt(i + 1) * 7919n, tier: 'elite', teamA: team('A', comp(i, 0), i), teamB: team('B', comp(i, 1), i) });
        while (!s.finished) {
          const actor = v3.nextActor(s)!;
          if (actor.statuses.some(st => st.type === 'stun')) { v3.applyTurn(s, null); continue; }
          const cmd = policy(s, actor);
          expect(() => v3.validateTurn(s, cmd)).not.toThrow();
          v3.applyTurn(s, cmd);
        }
        expect(s.winner).not.toBeNull();
      }
    }
  }, 30_000); // ~5 s of simulation: it sat exactly on bun's 5 s default and timed out under load

  test('deep search does not mutate the real battle and stays deterministic', () => {
    const make = () => v3.createBattle({ battleId: 'deep', vrfSeed: 77n, tier: 'apex', teamA: team('A', comp(2, 0), 2), teamB: team('B', comp(2, 1), 2) });
    const s1 = make(), s2 = make();
    const before = v3.hashState(s1);
    const c1 = v3.STYLE_BOTS.deep(s1, v3.nextActor(s1)!);
    expect(v3.hashState(s1)).toBe(before);
    const c2 = v3.STYLE_BOTS.deep(s2, v3.nextActor(s2)!);
    expect(JSON.stringify(c1)).toBe(JSON.stringify(c2));
  });

  test('rules knobs: move range and attack multiplier overrides take effect', () => {
    const s = v3.createBattle({ battleId: 'k', vrfSeed: 5n, tier: 'elite', teamA: team('A', [LobsterClass.Bulwark, LobsterClass.Bulwark, LobsterClass.Bulwark], 0), teamB: team('B', [LobsterClass.Ember, LobsterClass.Ember, LobsterClass.Ember], 0), rules: { moveRange: { [LobsterClass.Bulwark]: 2 }, attackMult: { [LobsterClass.Bulwark]: 1300n } } });
    const bul = s.lobsters.find(l => l.class === LobsterClass.Bulwark)!;
    expect(v3.moveRangeOf(s, LobsterClass.Bulwark)).toBe(2);
    expect(v3.legalMoves(s, bul).some(c => v3.hexDistance(c, bul.pos) === 2)).toBe(true);
    expect(bul.stats.attack).toBe((100n * 1400n / 1000n) * 1300n / 1000n);
  });
});

describe('planner (the Dojo Hard bot)', () => {
  const planner = v3.STYLE_BOTS.planner!;
  test('only legal commands, battles finish, the real battle is never mutated (10 battles)', () => {
    for (let i = 0; i < 10; i++) {
      const s = v3.createBattle({ battleId: `pl${i}`, vrfSeed: BigInt(i + 1) * 7919n, tier: 'elite', teamA: team('A', comp(i, 0), i), teamB: team('B', comp(i, 1), i) });
      while (!s.finished) {
        const actor = v3.nextActor(s)!;
        if (actor.statuses.some(st => st.type === 'stun')) { v3.applyTurn(s, null); continue; }
        const before = v3.hashState(s);
        const cmd = planner(s, actor);
        expect(v3.hashState(s)).toBe(before);
        expect(() => v3.validateTurn(s, cmd)).not.toThrow();
        v3.applyTurn(s, cmd);
      }
      expect(s.winner).not.toBeNull();
    }
  }, 60_000);

  test('deterministic: the same position gives the same move', () => {
    const make = () => v3.createBattle({ battleId: 'pld', vrfSeed: 91n, tier: 'apex', teamA: team('A', comp(4, 0), 4), teamB: team('B', comp(4, 1), 4) });
    const s1 = make(), s2 = make();
    expect(JSON.stringify(planner(s1, v3.nextActor(s1)!))).toBe(JSON.stringify(planner(s2, v3.nextActor(s2)!)));
  });

  test('fits the live bot think window: well under 50 ms a move on a full board', () => {
    let ms = 0, moves = 0;
    for (let i = 0; i < 3; i++) {
      const s = v3.createBattle({ battleId: `plt${i}`, vrfSeed: BigInt(i + 3) * 104729n, tier: 'elite', teamA: team('A', comp(i, 2), i), teamB: team('B', comp(i, 3), i) });
      for (let k = 0; k < 12 && !s.finished; k++) {
        const actor = v3.nextActor(s)!;
        if (actor.statuses.some(st => st.type === 'stun')) { v3.applyTurn(s, null); continue; }
        const t = performance.now();
        const cmd = planner(s, actor);
        ms += performance.now() - t; moves++;
        v3.applyTurn(s, cmd);
      }
    }
    expect(ms / moves).toBeLessThan(50);
  }, 30_000);

  test('plays clearly better than balanced (20 mirrored pairs)', () => {
    let wins = 0, games = 0;
    for (let i = 0; i < 20; i++) for (const asA of [true, false]) {
      const s = v3.createBattle({ battleId: `plb${i}`, vrfSeed: BigInt(i + 1) * 104729n, tier: 'elite', teamA: team('A', comp(i, 0), i), teamB: team('B', comp(i, 1), i) });
      v3.runBattle(s, asA ? { A: planner, B: v3.BOTS.balanced! } : { A: v3.BOTS.balanced!, B: planner });
      games++; if (s.winner === (asA ? 'A' : 'B')) wins++;
    }
    // Measured 79.8 % at n=600 (2026-11-01); 60 % is ~2.5 standard errors below that at n=40.
    expect(wins / games).toBeGreaterThanOrEqual(0.6);
  }, 90_000);
});
