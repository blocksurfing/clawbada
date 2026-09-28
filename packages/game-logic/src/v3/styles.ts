/**
 * Strategy-probing bot styles built on the shared evaluation in bots.ts.
 * Each one embodies a specific way to play, so balance runs can answer
 * "does strategy X dominate?" rather than only "which class is strong?".
 *
 *   charger   — bank charge by Defending (2/turn), then unload Specials
 *   focus     — the whole team commits to one kill target
 *   roles     — class-aware: ranged classes kite at distance 2, melee brawl,
 *               tanks stand between enemies and allies, Sentinel shadows the hurt
 *   deep      — considers the opponent's best reply (2-ply beam search), with the team committing to one
 *               target (focus fire) and covering its own likeliest victim — upgraded 2026-09-28 after the
 *               naive `focus` script beat the old deep 60–40 (scripts/focus-probe.ts)
 */
import { deriveRandom } from '../hash';
import { LobsterClass } from '../types';
import { nextActor } from './atb';
import { hexDistance, type HexPos } from './board';
import { hasStatus } from './effects';
import { BOT_WEIGHTS, chooseTurn, rankTurns, type Bias, type BotWeights } from './bots';
import { cloneBattleState, type Policy } from './sim';
import type { AtbBattleState, AtbLobster, TurnCommand } from './state';
import { applyTurn, attackRangeOf, moveRangeOf } from './turn';

const n = (b: bigint) => Number(b);

// ──────────── charger ────────────
export const chargerPolicy: Policy = (state, actor) => {
  const cost = state.rules.specialCost;
  const bias: Bias = (cmd, { actor: a }) => {
    if (cmd.action === 'defend' && a.charge < cost) return 90; // bank charge unless a kill is on the table (kill bonus outweighs this)
    if (cmd.action === 'special') return 120;
    if (cmd.action === 'attack' && a.charge < cost) return -30;
    return 0;
  };
  return chooseTurn(state, actor, BOT_WEIGHTS.balanced, bias);
};

// ──────────── focus fire ────────────
/** Team focus target: the living enemy that is closest to dying (lowest HP, then lowest max HP). */
export function focusTarget(state: AtbBattleState, team: AtbLobster['team']): AtbLobster | null {
  let best: AtbLobster | null = null;
  for (const e of state.lobsters) {
    if (!e.alive || e.team === team) continue;
    if (!best || e.hp < best.hp || (e.hp === best.hp && e.maxHp < best.maxHp)) best = e;
  }
  return best;
}

/** Team focus fire: attacks and Specials on the focus target are worth more, on anyone else less; otherwise
 *  drift toward it. */
export function focusBias(state: AtbBattleState, actor: AtbLobster): Bias {
  const focus = focusTarget(state, actor.team);
  return (cmd, { target, dest }) => {
    if (!focus) return 0;
    if ((cmd.action === 'attack' || cmd.action === 'special') && target) return target.id === focus.id ? 60 : -60;
    // When not attacking, drift toward the focus target.
    return -8 * hexDistance(dest, focus.pos);
  };
}

export const focusPolicy: Policy = (state, actor) => chooseTurn(state, actor, BOT_WEIGHTS.balanced, focusBias(state, actor));

/** Enemies that could reach `victim` with an attack before it acts again (move + attack range). */
function threatsOn(state: AtbBattleState, victim: AtbLobster): number {
  let k = 0;
  for (const e of state.lobsters)
    if (e.alive && e.team !== victim.team && hexDistance(e.pos, victim.pos) <= moveRangeOf(state, e.class) + attackRangeOf(state, e.class)) k++;
  return k;
}

/** Cover the ally the enemy would focus (their focus target is our lowest-HP lobster) once two or more enemies
 *  can reach it: it Defends and steps back, Sentinel Rallies it, Bulwark Fortifies, allies stand beside it. */
export function protectBias(state: AtbBattleState, actor: AtbLobster): Bias {
  const victim = focusTarget(state, actor.team === 'A' ? 'B' : 'A');
  const enemies = state.lobsters.filter(l => l.alive && l.team !== actor.team);
  const threat = victim ? threatsOn(state, victim) : 0;
  return (cmd, { dest, target, exposure }) => {
    if (!victim || threat < 2) return 0;
    let b = 0;
    if (victim.id === actor.id) {
      if (cmd.action === 'defend') b += 40 + exposure * 0.4;
      b += 12 * Math.min(...enemies.map(e => hexDistance(dest, e.pos)));
    } else {
      if (actor.class === LobsterClass.Sentinel && cmd.action === 'special' && target?.id === victim.id) b += 90;
      if (actor.class === LobsterClass.Bulwark && cmd.action === 'special') b += 70;
      if (hexDistance(dest, victim.pos) === 1) b += 15;
    }
    return b;
  };
}

/** Focus fire + cover: the combination the 2026-09-28 probe measured strongest (57 % vs focus, 70 % vs old deep). */
export function teamplayBias(state: AtbBattleState, actor: AtbLobster): Bias {
  const f = focusBias(state, actor), p = protectBias(state, actor);
  return (cmd, ctx) => f(cmd, ctx) + p(cmd, ctx);
}

// ──────────── role-aware ────────────
const RANGED = new Set([LobsterClass.Tempest, LobsterClass.Specter, LobsterClass.Ember]);
const MELEE = new Set([LobsterClass.Mantis, LobsterClass.Reaver, LobsterClass.Abyss, LobsterClass.Leviathan]);

function roleWeights(cls: LobsterClass): BotWeights {
  if (RANGED.has(cls)) return { aggression: 1.1, caution: 0.8, standoff: 2, approach: 30 };
  if (MELEE.has(cls)) return { aggression: 1.4, caution: 0.3, standoff: 1, approach: 45 };
  if (cls === LobsterClass.Bulwark) return { aggression: 1.0, caution: 0.15, standoff: 1, approach: 40 };
  if (cls === LobsterClass.Sentinel) return { aggression: 0.9, caution: 0.9, standoff: 2, approach: 20 };
  return BOT_WEIGHTS.balanced; // Kraken
}

export const rolesPolicy: Policy = (state, actor) => {
  const allies = state.lobsters.filter(l => l.alive && l.team === actor.team && l.id !== actor.id);
  const enemies = state.lobsters.filter(l => l.alive && l.team !== actor.team);
  const bias: Bias = (_cmd, { dest }) => {
    let b = 0;
    if (actor.class === LobsterClass.Bulwark && allies.length && enemies.length) {
      // Reward standing closer to the enemies than every ally does (be the wall).
      const myD = Math.min(...enemies.map(e => hexDistance(dest, e.pos)));
      const allyD = Math.min(...allies.map(a => Math.min(...enemies.map(e => hexDistance(a.pos, e.pos)))));
      b += myD <= allyD ? 25 : -25;
    }
    if (actor.class === LobsterClass.Sentinel && allies.length) {
      // Stay within Rally range (2) of the most damaged ally.
      const hurt = allies.reduce((h, a) => (a.hp * h.maxHp < h.hp * a.maxHp ? a : h));
      b += hexDistance(dest, hurt.pos) <= 2 ? 20 : -15 * (hexDistance(dest, hurt.pos) - 2);
    }
    if (RANGED.has(actor.class) && enemies.length) {
      // Prefer cells no melee enemy can reach adjacency of next turn.
      const threatened = enemies.some(e => MELEE.has(e.class) && hexDistance(dest, e.pos) <= 1 + (e.class === LobsterClass.Leviathan ? 1 : 3));
      b += threatened ? -20 : 15;
    }
    return b;
  };
  return chooseTurn(state, actor, roleWeights(actor.class), bias);
};

// ──────────── deep (2-ply beam) ────────────
function evaluate(state: AtbBattleState, team: AtbLobster['team']): number {
  let v = 0;
  for (const l of state.lobsters) {
    const sign = l.team === team ? 1 : -1;
    const hp = l.hp > l.maxHp ? l.maxHp : l.hp;
    v += sign * (n(hp) + (l.alive ? 200 + l.charge * 25 : 0));
    for (const s of l.statuses) {
      if (s.type === 'stun') v -= sign * 120;
      if (s.type === 'bleed') v -= sign * n(s.value) * Math.min(s.turns, 3);
      if (s.type === 'haunt') v -= sign * 60;
    }
  }
  if (state.finished && state.winner) v += state.winner === team ? 5000 : state.winner === 'draw' ? 0 : -5000;
  return v;
}

function cloneState(state: AtbBattleState): AtbBattleState {
  // Explicit copy (Bun's structuredClone fails on 256-bit bigints); mask the true
  // VRF stream so the search cannot peek at real rolls.
  const c = cloneBattleState(state);
  c.vrfSeed = deriveRandom(state.vrfSeed, `lookahead_${state.turn}`);
  return c;
}

/** 2-ply beam search. `bias` shapes which candidates are searched (default: team focus fire + cover; null = the
 *  pre-2026-09-28 plain search). The opponent's reply is always modelled by the stock balanced bot. */
export function deepPolicy(beam = 4, bias: ((s: AtbBattleState, a: AtbLobster) => Bias) | null = teamplayBias): Policy {
  return (state, actor) => {
    const ranked = rankTurns(state, actor, BOT_WEIGHTS.balanced, bias ? bias(state, actor) : undefined).slice(0, beam);
    if (ranked.length === 1) return ranked[0].cmd;
    let best: { cmd: TurnCommand; value: number } | null = null;
    for (const cand of ranked) {
      const s1 = cloneState(state);
      applyTurn(s1, cand.cmd);
      // Opponent (or whoever acts next) replies with the balanced evaluation.
      if (!s1.finished) {
        const next = nextActor(s1)!;
        applyTurn(s1, hasStatus(next, 'stun') ? null : chooseTurn(s1, next, BOT_WEIGHTS.balanced));
      }
      const value = evaluate(s1, actor.team) + cand.score * 0.05; // tiny tiebreak toward the 1-ply favourite
      if (!best || value > best.value) best = { cmd: cand.cmd, value };
    }
    return best!.cmd;
  };
}

export const STYLE_BOTS: Record<string, Policy> = {
  charger: chargerPolicy,
  focus: focusPolicy,
  roles: rolesPolicy,
  deep: deepPolicy(),
};
