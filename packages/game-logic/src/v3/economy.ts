/**
 * Underdog-bonus economics (S1.5 candidate). Settlement-layer only — the
 * battle resolver never sees any of this, which keeps on-chain replay pure.
 *
 * Mechanism: each epoch, every class's share of fielded team slots is
 * published. A winning team earns a rebate out of the PROTOCOL FEE (never the
 * opponent's stake), scaled by how far below fair share (10%) its classes sit.
 * Zero-sum core untouched; the cost is reduced burn on underdog wins.
 *
 * economicEquilibrium() models profit-maximizing agents: a population over
 * comps updates toward higher expected $CLAW per battle; pick shares feed back
 * into the rebate. The time-averaged mix is the economic meta.
 */
import type { Comp } from './meta';
import { effectiveSupport } from './meta';

export interface BracketEconomics {
  /** Stake per side ($CLAW). */
  stake: number;
  /** Protocol fee as share of the combined pot (bps). Spec: 1000 = 10%. */
  feeBps: number;
  /** Expected repair burn for the winner / loser ($CLAW). */
  repairWinner: number;
  repairLoser: number;
}

/** Mid bracket at Elite tier (stake 10k, fee 10%, repairs 15/pt at ~30/~90 pts). */
export const MID_ELITE: BracketEconomics = { stake: 10_000, feeBps: 1000, repairWinner: 450, repairLoser: 1350 };

export interface UnderdogRule {
  /** Max rebate as share of the protocol fee (bps). 0 disables. */
  rebateCapBps: number;
  /** Fair pick share per class (bps of slots). 10 classes → 1000. */
  fairShareBps: number;
}

export const NO_REBATE: UnderdogRule = { rebateCapBps: 0, fairShareBps: 1000 };

/** Share of fielded team slots per class implied by a population mix over comps. */
export function classPickShares(mix: number[], comps: Comp[]): number[] {
  const shares = Array(10).fill(0);
  for (let i = 0; i < comps.length; i++) for (const c of comps[i]) shares[c] += mix[i] / 3;
  return shares;
}

/** 0 at/above fair share → 1 for a completely unpicked class. */
export function underdogWeight(share: number, rule: UnderdogRule): number {
  const fair = rule.fairShareBps / 10_000;
  if (share >= fair) return 0;
  return (fair - share) / fair;
}

/** Winner's rebate ($CLAW) for fielding `comp` under current pick shares. */
export function rebateFor(comp: Comp, shares: number[], econ: BracketEconomics, rule: UnderdogRule): number {
  const fee = (2 * econ.stake * econ.feeBps) / 10_000;
  const u = comp.reduce((s, c) => s + underdogWeight(shares[c], rule), 0) / 3;
  return fee * (rule.rebateCapBps / 10_000) * u;
}

/** Expected $CLAW per battle at win probability `p`, including the rebate on wins. */
export function battleEV(p: number, econ: BracketEconomics, rebate = 0): number {
  const pot = 2 * econ.stake;
  const fee = (pot * econ.feeBps) / 10_000;
  const winnerNet = pot - fee - econ.stake - econ.repairWinner + rebate;
  const loserNet = -econ.stake - econ.repairLoser;
  return p * winnerNet + (1 - p) * loserNet;
}

export interface EconomicEquilibrium {
  mix: number[];
  classShares: number[];
  /** Per class: best expected $CLAW per battle among comps containing it, under the final mix. */
  classBestEV: number[];
  /** Per comp: EV under the final mix. */
  compEV: number[];
  effectiveComps: number;
}

/**
 * Population dynamic over comps driven by EV (win prob vs the mix, plus the
 * rebate from the mix-implied pick shares). Replicator on positively shifted
 * EV, time-averaged over the back half of the run.
 */
export function economicEquilibrium(
  W: number[][],
  comps: Comp[],
  econ: BracketEconomics,
  rule: UnderdogRule,
  iterations = 6000,
  mutation = 1e-4,
): EconomicEquilibrium {
  const k = W.length;
  let x = Array(k).fill(1 / k);
  const acc = Array(k).fill(0);
  let n = 0;
  const evOf = (mix: number[]): number[] => {
    const shares = classPickShares(mix, comps);
    return W.map((row, i) => {
      const p = row.reduce((s, w, j) => s + w * mix[j], 0);
      return battleEV(p, econ, rebateFor(comps[i], shares, econ, rule));
    });
  };
  for (let it = 0; it < iterations; it++) {
    const ev = evOf(x);
    const min = Math.min(...ev);
    const fitness = ev.map(e => e - min + econ.stake * 0.01); // positive, stake-scaled floor
    const avg = fitness.reduce((s, f, i) => s + f * x[i], 0);
    const next = x.map((xi, i) => (xi * fitness[i]) / Math.max(avg, 1e-9));
    const total = next.reduce((s, v) => s + v, 0);
    x = next.map(v => (1 - mutation) * (v / total) + mutation / k);
    if (it >= iterations / 2) { for (let i = 0; i < k; i++) acc[i] += x[i]; n++; }
  }
  const mix = acc.map(v => v / n);
  const classShares = classPickShares(mix, comps);
  const compEV = evOf(mix);
  const classBestEV = Array(10).fill(-Infinity);
  for (let i = 0; i < comps.length; i++) for (const c of comps[i]) classBestEV[c] = Math.max(classBestEV[c], compEV[i]);
  return { mix, classShares, classBestEV, compEV, effectiveComps: effectiveSupport(mix) };
}
