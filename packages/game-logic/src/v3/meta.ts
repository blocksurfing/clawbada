/**
 * Comp-metagame analysis: is "what team do I field?" a solved question?
 *
 * Pipeline (all deterministic given the seed):
 *   1. enumerate the 220 possible 3-class comps (multisets)
 *   2. screening: every comp plays a sample of opponents → rating
 *   3. round-robin the strongest K comps → win-probability matrix
 *   4. replicator dynamics on that matrix → the stable meta (equilibrium mix):
 *      the comp distribution a population of profit-maximizing agents settles into
 *   5. exploitability: how far above 50% the single best counter-comp gets
 *      against that mix — low = studying harder buys little at team select
 *
 * Outputs feed the balance north star: menu breadth (effective number of
 * viable comps), exploitability, and the comp edge (for comparison with the
 * piloting edge measured separately).
 */
import { deriveRandom } from '../hash';
import { EvolutionTier, LobsterClass } from '../types';
import type { Policy } from './sim';
import { createBattle, runBattle } from './sim';
import type { BattleRules } from './state';

export type Comp = [number, number, number]; // sorted class ids

export function enumerateComps(): Comp[] {
  const out: Comp[] = [];
  for (let a = 0; a < 10; a++) for (let b = a; b < 10; b++) for (let c = b; c < 10; c++) out.push([a, b, c]);
  return out;
}

export function compName(comp: Comp, names: readonly string[]): string {
  return comp.map(c => names[c].slice(0, 4)).join('/');
}

export interface DuelOptions {
  tier: 'evolved' | 'elite' | 'apex';
  purity: number;
  seed: bigint;
  rules?: Partial<BattleRules>;
}

/** Average win share of comp `a` vs comp `b` over `n` battles (sides swapped; draws = 0.5). */
export function duelComps(a: Comp, b: Comp, policy: Policy, n: number, opts: DuelOptions): number {
  let score = 0;
  const mk = (p: string, comp: Comp) => comp.map((c, j) => ({ id: `${p}${j}`, class: c as LobsterClass, tier: { evolved: EvolutionTier.Evolved, elite: EvolutionTier.Elite, apex: EvolutionTier.Apex }[opts.tier], purity: opts.purity }));
  for (let i = 0; i < n; i++) {
    const seed = deriveRandom(opts.seed, `duel_${a.join('')}_${b.join('')}_${i}`);
    const s = createBattle({ battleId: 'm', vrfSeed: seed, tier: opts.tier, teamA: mk('A', a), teamB: mk('B', b), rules: opts.rules });
    runBattle(s, { A: policy, B: policy });
    score += s.winner === 'A' ? 1 : s.winner === 'draw' ? 0.5 : 0;
    const t = createBattle({ battleId: 'n', vrfSeed: deriveRandom(seed, 'swap'), tier: opts.tier, teamA: mk('A', b), teamB: mk('B', a), rules: opts.rules });
    runBattle(t, { A: policy, B: policy });
    score += t.winner === 'B' ? 1 : t.winner === 'draw' ? 0.5 : 0;
  }
  return score / (2 * n);
}

/**
 * Replicator dynamics on a win-probability matrix (row's chance vs column).
 * Returns the stationary mix. Deterministic; small uniform mutation keeps the
 * dynamic from collapsing prematurely on noisy matrices.
 */
export function replicator(W: number[][], iterations = 4000, mutation = 1e-4): number[] {
  const k = W.length;
  let x = Array(k).fill(1 / k);
  for (let it = 0; it < iterations; it++) {
    const fitness = W.map(row => row.reduce((s, w, j) => s + w * x[j], 0));
    const avg = fitness.reduce((s, f, i) => s + f * x[i], 0);
    const next = x.map((xi, i) => (xi * fitness[i]) / Math.max(avg, 1e-12));
    const total = next.reduce((s, v) => s + v, 0);
    x = next.map(v => (1 - mutation) * (v / total) + mutation / k);
  }
  return x;
}

/** Payoff of each row strategy against a mix; the max is the best response. */
export function payoffsVsMix(W: number[][], mix: number[]): number[] {
  return W.map(row => row.reduce((s, w, j) => s + w * mix[j], 0));
}

/** Effective number of strategies in a mix (exp of Shannon entropy). */
export function effectiveSupport(mix: number[]): number {
  let h = 0;
  for (const p of mix) if (p > 1e-9) h -= p * Math.log(p);
  return Math.exp(h);
}
