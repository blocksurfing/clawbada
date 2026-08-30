import { describe, expect, test } from 'bun:test';
import { EvolutionTier, LobsterClass } from '../types';
import { v3 } from '../index';

const ALL = [...Array(10).keys()] as LobsterClass[];
const team = (p: string, cs: LobsterClass[], i: number) => cs.map((c, j) => ({ id: `${p}${j}`, class: c, tier: EvolutionTier.Elite, purity: (i + j) % 7 }));
const comp = (i: number, k: number) => [ALL[(i * 7 + k) % 10], ALL[(i * 3 + k * 2) % 10], ALL[(i * 11 + k * 5) % 10]];

describe('strategy styles', () => {
  test('every style produces only legal commands and battles finish (30 battles each)', () => {
    for (const [name, policy] of Object.entries(v3.STYLE_BOTS)) {
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
  });

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
