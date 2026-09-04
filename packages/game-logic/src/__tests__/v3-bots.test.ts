import { describe, expect, test } from 'bun:test';
import { EvolutionTier, LobsterClass } from '../types';
import { v3 } from '../index';

const { createBattle, runBattle, nextActor, greedyPolicy, balancedPolicy, aggressivePolicy, cautiousPolicy, chooseTurn, BOT_WEIGHTS, validateTurn, hashState } = v3;
const ALL = [...Array(10).keys()] as LobsterClass[];
const team = (p: string, cs: LobsterClass[], i: number) => cs.map((c, j) => ({ id: `${p}${j}`, class: c, tier: EvolutionTier.Elite, purity: (i + j) % 7 }));
const comp = (i: number, k: number) => [ALL[(i * 7 + k) % 10], ALL[(i * 3 + k * 2) % 10], ALL[(i * 11 + k * 5) % 10]];

describe('look-ahead bots', () => {
  test('every command a bot produces is legal, across 60 full battles per personality', () => {
    for (const [name, policy] of Object.entries(v3.BOTS)) {
      for (let i = 0; i < 60; i++) {
        const s = createBattle({ battleId: `${name}${i}`, vrfSeed: BigInt(i + 1) * 7919n, tier: 'elite', teamA: team('A', comp(i, 0), i), teamB: team('B', comp(i, 1), i) });
        while (!s.finished) {
          const actor = nextActor(s)!;
          if (actor.statuses.some(st => st.type === 'stun')) { v3.applyTurn(s, null); continue; }
          const cmd = policy(s, actor);
          expect(() => validateTurn(s, cmd)).not.toThrow();
          v3.applyTurn(s, cmd);
        }
        expect(s.turn).toBeLessThanOrEqual(100);
        expect(s.winner).not.toBeNull();
      }
    }
  });

  test('deterministic: same state → same command, same battle → same hash', () => {
    const s1 = createBattle({ battleId: 'd', vrfSeed: 99n, tier: 'apex', teamA: team('A', comp(4, 0), 4), teamB: team('B', comp(4, 1), 4) });
    const s2 = createBattle({ battleId: 'd', vrfSeed: 99n, tier: 'apex', teamA: team('A', comp(4, 0), 4), teamB: team('B', comp(4, 1), 4) });
    expect(JSON.stringify(chooseTurn(s1, nextActor(s1)!, BOT_WEIGHTS.balanced))).toBe(JSON.stringify(chooseTurn(s2, nextActor(s2)!, BOT_WEIGHTS.balanced)));
    runBattle(s1, { A: balancedPolicy, B: cautiousPolicy });
    runBattle(s2, { A: balancedPolicy, B: cautiousPolicy });
    expect(hashState(s1)).toBe(hashState(s2));
  });

  test('balanced bot beats the greedy baseline decisively with mirrored teams (sides swapped)', () => {
    let wins = 0, games = 0;
    for (let i = 0; i < 80; i++) {
      const cs = comp(i, 2);
      const a = createBattle({ battleId: `g${i}`, vrfSeed: BigInt(i + 1) * 104729n, tier: 'elite', teamA: team('A', cs, i), teamB: team('B', cs, i) });
      runBattle(a, { A: balancedPolicy, B: greedyPolicy }); games++; if (a.winner === 'A') wins++;
      const b = createBattle({ battleId: `h${i}`, vrfSeed: BigInt(i + 1) * 104729n, tier: 'elite', teamA: team('A', cs, i), teamB: team('B', cs, i) });
      runBattle(b, { A: greedyPolicy, B: balancedPolicy }); games++; if (b.winner === 'B') wins++;
    }
    expect(wins / games).toBeGreaterThan(0.6);
  });

  test('personalities behave differently: cautious keeps more distance than aggressive', () => {
    const measure = (policy: v3.Policy) => {
      let sum = 0, count = 0;
      for (let i = 0; i < 20; i++) {
        const s = createBattle({ battleId: `p${i}`, vrfSeed: BigInt(i + 1) * 31n, tier: 'elite', teamA: team('A', [LobsterClass.Specter, LobsterClass.Tempest, LobsterClass.Ember], i), teamB: team('B', [LobsterClass.Bulwark, LobsterClass.Leviathan, LobsterClass.Sentinel], i) });
        const res = runBattle(s, { A: policy, B: greedyPolicy });
        for (const r of res) {
          const l = s.lobsters.find(x => x.id === r.lobsterId)!;
          if (l.team !== 'A' || r.skipped) continue;
          let d = Infinity;
          for (const e of s.lobsters) if (e.team === 'B') d = Math.min(d, v3.hexDistance(l.pos, e.pos));
          if (Number.isFinite(d)) { sum += d; count++; }
        }
      }
      return sum / count;
    };
    expect(measure(cautiousPolicy)).toBeGreaterThan(measure(aggressivePolicy));
  });
});
