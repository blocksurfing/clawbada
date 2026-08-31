/**
 * Look-ahead bot: enumerate every legal (move, action, target) for the acting
 * lobster, score the outcome with an expected-value heuristic, pick the best.
 * Deterministic — ties break by enumeration order, never by randomness.
 *
 * Personalities are weight sets on the same evaluation:
 *   aggressive — maximise expected damage / kills (focus fire emerges)
 *   cautious   — heavily penalise exposure on the bar (kiting emerges)
 *   balanced   — in between; the default "competent player"
 *
 * Score terms (all in HP units so they trade off sensibly):
 *   + damage dealt (capped at target HP, crit expected value, distance falloff)
 *   + kill bonus, + focus bonus on already-damaged targets
 *   + Special utility (heal, deny-turn, debuff, DoT, team mitigation)
 *   − exposure: expected damage enemies can land on us before our next turn,
 *     weighted by who acts before us on the ATB bar; halved when Defending
 *   ± positioning: approach for aggressive, keep-distance for cautious
 */
import { MULT_DENOM, SPECIAL_BASE_POWERS } from '../constants';
import { calculateAttackDamage, calculateSpecialDamage, critChance, getClassAdvantage } from '../battle-resolver';
import { LobsterClass } from '../types';
import { nextTick, tickDelta } from './atb';
import { hexDistance, sameHex, type HexPos } from './board';
import { ATTACK_MAX_RANGE, DISTANCE_MULT, FORTIFY_REDUCTION, REND_TURNS, SPECIAL_RANGE } from './constants';
import { effectiveStats, purityMult } from './effects';
import { specialPowerOf, specialTargetKind } from './specials';
import type { Policy } from './sim';
import type { AtbBattleState, AtbLobster, TurnCommand } from './state';
import { attackTargets, canCastSpecial, legalMoves, moveRangeOf, specialTargets } from './turn';

export interface BotWeights {
  /** Multiplier on damage/kill value. */
  aggression: number;
  /** Multiplier on exposure penalty. */
  caution: number;
  /** Preferred distance to the nearest enemy when not attacking (1 = brawl, 2–3 = kite). */
  standoff: number;
  /** Weight on closing distance when no attack is available. */
  approach: number;
}

export const BOT_WEIGHTS: Record<'aggressive' | 'balanced' | 'cautious', BotWeights> = {
  // Tuned 2026-08-30 against headless batches: turtling loses in this ruleset,
  // so the default ("balanced") leans aggressive; "cautious" is kept as a
  // deliberately passive archetype for comparison runs, not as a strong player.
  aggressive: { aggression: 1.4, caution: 0.25, standoff: 1, approach: 45 },
  balanced: { aggression: 1.2, caution: 0.4, standoff: 1, approach: 35 },
  cautious: { aggression: 0.8, caution: 1.0, standoff: 2, approach: 15 },
};

const n = (b: bigint) => Number(b);

/** Expected Attack damage (mean VRF, crit expectation, distance falloff), capped at target HP. */
export function expectedAttack(actor: AtbLobster, target: AtbLobster, dist: number, state?: AtbBattleState): number {
  const mult = DISTANCE_MULT[dist];
  if (mult === undefined) return 0;
  const a = effectiveStats(actor), t = effectiveStats(target);
  const base = n(calculateAttackDamage(a.attack, t.armor, getClassAdvantage(actor.class, target.class), false, 1000n));
  const pCrit = n(critChance(a.critical)) / 10_000;
  let dmg = base * (1 + 0.5 * pCrit) * (n(mult) / 1000);
  if (target.defending) dmg *= 0.5;
  for (const s of target.statuses) if (s.type === 'fortify' || s.type === 'shield') dmg *= 1 - n(s.value) / 1000;
  if (state && state.rules.focusFalloffBps > 0n && target.recentHits > 0)
    dmg *= Math.max(0.4, 1 - (n(state.rules.focusFalloffBps) / 10_000) * target.recentHits);
  return Math.min(dmg, n(target.hp));
}

function expectedSpecialDamage(actor: AtbLobster, target: AtbLobster, power: bigint, armorMult = 1000n): number {
  const a = effectiveStats(actor), t = effectiveStats(target);
  const armor = (t.armor * armorMult) / 1000n;
  let dmg = n(calculateSpecialDamage(power, a.attack, armor > 0n ? armor : 1n, getClassAdvantage(actor.class, target.class), actor.purity, 1000n));
  if (target.defending) dmg *= 0.5;
  for (const s of target.statuses) if (s.type === 'fortify' || s.type === 'shield') dmg *= 1 - n(s.value) / 1000;
  return dmg;
}

/** A lobster's expected damage output per turn against a typical adjacent target (for deny/debuff valuation). */
function outputPerTurn(l: AtbLobster, against: AtbLobster): number {
  return expectedAttack(l, { ...against, hp: against.maxHp, defending: false, statuses: [] }, 1);
}

/** Expected damage enemies can land on `me` at `pos` before my next turn. */
export function exposure(state: AtbBattleState, me: AtbLobster, pos: HexPos, defending: boolean): number {
  const myNext = me.lastTick + tickDelta(me) * 2n; // after this turn, roughly when I act again
  let total = 0;
  for (const e of state.lobsters) {
    if (!e.alive || e.team === me.team) continue;
    const d = hexDistance(e.pos, pos);
    const mr = moveRangeOf(state, e.class);
    const reach = mr + ATTACK_MAX_RANGE;
    if (d > reach) continue;
    const bestDist = Math.max(1, d - mr);
    const probe = { ...me, pos, defending: false };
    let dmg = expectedAttack(e, probe, Math.min(bestDist, ATTACK_MAX_RANGE), state);
    // Charged Specials are the real threat.
    const power = specialPowerOf(state, e.class);
    if (canCastSpecial(state, e) && power > 0n && bestDist <= Math.max(1, SPECIAL_RANGE[e.class]))
      dmg = Math.max(dmg, expectedSpecialDamage(e, probe, power));
    const actsFirst = nextTick(e) < myNext;
    total += dmg * (actsFirst ? 1 : 0.4);
  }
  return defending ? total * 0.5 : total;
}

function nearestEnemyDistance(state: AtbBattleState, me: AtbLobster, pos: HexPos): number {
  let best = Infinity;
  for (const e of state.lobsters) if (e.alive && e.team !== me.team) best = Math.min(best, hexDistance(pos, e.pos));
  return best;
}

function specialValue(state: AtbBattleState, actor: AtbLobster, target: AtbLobster | null, pos: HexPos, w: BotWeights): number {
  const power = specialPowerOf(state, actor.class);
  switch (actor.class) {
    case LobsterClass.Bulwark: {
      // Fortify: 40% of what the team is about to take.
      let incoming = 0;
      for (const ally of state.lobsters) if (ally.alive && ally.team === actor.team) incoming += exposure(state, ally, ally.pos, false);
      return incoming * (n(FORTIFY_REDUCTION) / 1000) * 1.2;
    }
    case LobsterClass.Tempest: {
      let v = 0;
      for (const e of state.lobsters) if (e.alive && e.team !== actor.team && hexDistance(pos, e.pos) <= SPECIAL_RANGE[actor.class]) v += Math.min(expectedSpecialDamage(actor, e, power), n(e.hp)) + (n(e.hp) <= expectedSpecialDamage(actor, e, power) ? killBonus(e) : 0);
      return v * w.aggression;
    }
    case LobsterClass.Sentinel: {
      const ally = target!;
      const heal = n(ally.maxHp) * (n(state.rules.rallyHealPct) / 1000) * (n(purityMult(actor)) / 1000);
      const missing = n(ally.maxHp - ally.hp);
      const cleanse = ally.statuses.filter(s => (s.type === 'bleed' || s.type === 'haunt' || s.type === 'slow') && !s.uncleansable).length * 40;
      // Healing is worth more the closer the ally is to dying.
      const urgency = 1 + (1 - n(ally.hp) / n(ally.maxHp));
      return Math.min(heal, missing) * urgency + cleanse;
    }
    case LobsterClass.Mantis: {
      const t = target!;
      const dmg = expectedSpecialDamage(actor, t, power, 500n);
      return Math.min(dmg, n(t.hp)) * w.aggression + (dmg >= n(t.hp) ? killBonus(t) : 0);
    }
    case LobsterClass.Kraken: {
      const t = target!;
      const dmg = expectedSpecialDamage(actor, t, power);
      const deny = t.stunImmunity === 0 ? outputPerTurn(t, actor) * 1.1 : 0;
      return Math.min(dmg, n(t.hp)) * w.aggression + deny + (dmg >= n(t.hp) ? killBonus(t) : 0);
    }
    case LobsterClass.Specter: {
      const t = target!;
      const dmg = expectedSpecialDamage(actor, t, power);
      const debuff = outputPerTurn(t, actor) * (n(state.rules.hauntReduction) / 1000) * 3;
      return Math.min(dmg, n(t.hp)) * w.aggression + debuff + (dmg >= n(t.hp) ? killBonus(t) : 0);
    }
    case LobsterClass.Reaver: {
      const t = target!;
      const dmg = expectedSpecialDamage(actor, t, power);
      const bleed = Math.min(n(state.rules.rendBleedPerTurn * purityMult(actor) / 1000n) * REND_TURNS, Math.max(0, n(t.hp) - dmg)) * 0.8;
      return Math.min(dmg, n(t.hp)) * w.aggression + bleed + (dmg >= n(t.hp) ? killBonus(t) : 0);
    }
    case LobsterClass.Abyss: {
      const t = target!;
      const dmg = Math.min(expectedSpecialDamage(actor, t, power), n(t.hp));
      const heal = Math.min(dmg, n(actor.maxHp - actor.hp));
      return dmg * w.aggression + heal + (dmg >= n(t.hp) ? killBonus(t) : 0);
    }
    case LobsterClass.Ember: {
      const t = target!;
      const dmg = expectedSpecialDamage(actor, t, power);
      const self = dmg * 0.25;
      return Math.min(dmg, n(t.hp)) * w.aggression - self * w.caution + (dmg >= n(t.hp) ? killBonus(t) : 0);
    }
    case LobsterClass.Leviathan: {
      const t = target!;
      const p = t.hp * 2n < t.maxHp ? (power * 3n) / 2n : power; // enhanced upside, discounted below
      const dmg = expectedSpecialDamage(actor, t, power) * 0.85 + expectedSpecialDamage(actor, t, p) * 0.15;
      return Math.min(dmg, n(t.hp)) * w.aggression + (dmg >= n(t.hp) ? killBonus(t) : 0);
    }
  }
}

function killBonus(t: AtbLobster): number {
  return n(t.maxHp) * 0.6 + 150;
}

function focusBonus(t: AtbLobster, dmg: number): number {
  return dmg * 0.3 * (1 - n(t.hp) / n(t.maxHp));
}

export interface Candidate {
  cmd: TurnCommand;
  score: number;
}

/** Style hook: extra score (HP units) for a candidate — lets styles bias the shared evaluation. */
export type Bias = (cmd: TurnCommand, ctx: { actor: AtbLobster; dest: HexPos; target: AtbLobster | null; exposure: number }) => number;

/** Enumerate and score every legal turn for `actor`; returns the best. */
export function chooseTurn(state: AtbBattleState, actor: AtbLobster, w: BotWeights, bias?: Bias): TurnCommand {
  return rankTurns(state, actor, w, bias)[0].cmd;
}

/** All legal turns for `actor`, best first. */
export function rankTurns(state: AtbBattleState, actor: AtbLobster, w: BotWeights, bias?: Bias): Candidate[] {
  const cells: HexPos[] = [actor.pos, ...legalMoves(state, actor)];
  const all: Candidate[] = [];
  let posCtx: HexPos = actor.pos; let expCtx = 0;
  const consider = (cmd: TurnCommand, score: number, target: AtbLobster | null = null) => {
    if (bias) score += bias(cmd, { actor, dest: posCtx, target, exposure: expCtx });
    all.push({ cmd, score });
  };

  for (const pos of cells) {
    const moveTo = sameHex(pos, actor.pos) ? undefined : pos;
    const exp = exposure(state, actor, pos, false);
    posCtx = pos; expCtx = exp;
    const expDef = exposure(state, actor, pos, true);
    const nearest = nearestEnemyDistance(state, actor, pos);
    const positional = -w.approach * Math.max(0, nearest - w.standoff) - (nearest < w.standoff ? w.approach * 0.5 * (w.standoff - nearest) : 0);
    // Fragile lobsters weigh exposure more as they get hurt.
    const fragility = 1 + (1 - n(actor.hp) / n(actor.maxHp));
    const exposurePenalty = w.caution * fragility;

    // Attacks
    for (const t of attackTargets(state, actor, pos)) {
      let dmg = expectedAttack(actor, t, hexDistance(pos, t.pos), state);
      if (state.rules.guardPenaltyBps > 0n && hexDistance(pos, t.pos) >= 2 && state.lobsters.some(l => l.alive && l.team !== actor.team && hexDistance(pos, l.pos) === 1))
        dmg *= 1 - n(state.rules.guardPenaltyBps) / 10_000;
      const kill = dmg >= n(t.hp) ? killBonus(t) : 0;
      // A defending, adjacent target counters — small deterrent.
      const counter = t.defending && hexDistance(pos, t.pos) === 1 ? outputPerTurn(t, actor) * 0.3 : 0;
      consider({ lobsterId: actor.id, moveTo, action: 'attack', targetId: t.id }, (dmg + kill + focusBonus(t, dmg)) * w.aggression - counter - exp * exposurePenalty + positional, t);
    }
    // Specials
    if (canCastSpecial(state, actor)) {
      const kind = specialTargetKind(actor.class);
      if (kind === 'none') {
        const v = specialValue(state, actor, null, pos, w);
        if (v > 0) consider({ lobsterId: actor.id, moveTo, action: 'special' }, v - exp * exposurePenalty + positional);
      } else {
        for (const t of specialTargets(state, actor, pos)) {
          const v = specialValue(state, actor, t, pos, w);
          if (v > 0) consider({ lobsterId: actor.id, moveTo, action: 'special', targetId: t.id }, v - exp * exposurePenalty + positional, t);
        }
      }
    }
    // Defend (also banks charge)
    const chargeValue = actor.charge < state.rules.specialCost ? 15 : 0;
    consider({ lobsterId: actor.id, moveTo, action: 'defend' }, chargeValue - expDef * exposurePenalty + positional + (exp > 0 ? expDef * 0.3 : 0));
    // Move only / hold
    consider({ lobsterId: actor.id, moveTo, action: 'none' }, -exp * exposurePenalty + positional - 5);
  }
  // Stable order: higher score first; ties keep enumeration order (deterministic).
  return all.map((c, i) => ({ c, i })).sort((a, b) => b.c.score - a.c.score || a.i - b.i).map(x => x.c);
}

export const aggressivePolicy: Policy = (state, actor) => chooseTurn(state, actor, BOT_WEIGHTS.aggressive);
export const balancedPolicy: Policy = (state, actor) => chooseTurn(state, actor, BOT_WEIGHTS.balanced);
export const cautiousPolicy: Policy = (state, actor) => chooseTurn(state, actor, BOT_WEIGHTS.cautious);

export const BOTS: Record<string, Policy> = {
  aggressive: aggressivePolicy,
  balanced: balancedPolicy,
  cautious: cautiousPolicy,
};
// Strategy styles (charger/focus/roles/deep) are registered in styles.ts as STYLE_BOTS.
