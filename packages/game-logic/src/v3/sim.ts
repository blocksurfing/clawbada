/**
 * Battle construction and headless running. `Policy` is the seam for bots and
 * for the live engine alike: given full state and the acting lobster, return a
 * TurnCommand.
 */
import { HP_BATTLE_SCALE } from '../constants';
import { deriveRandom } from '../hash';
import { getBaseStats, scaleStats } from '../battle-resolver';
import { LobsterClass } from '../types';
import { nextActor } from './atb';
import { hexDistance, type ArenaLayout, type HexPos } from './board';
import { generateLayout } from './layout';
import type { AtbBattleState, AtbLobster, BattleRules, LobsterInput, Team, TurnCommand, TurnResult } from './state';
import { FORTIFY_ENHANCED_REFLECT, FORTIFY_REFLECT_BASE } from './constants';
import { applyTurn, attackTargets, canCastSpecial, legalMoves, specialTargets } from './turn';
import { hasStatus } from './effects';
import { specialTargetKind } from './specials';

export interface BattleConfig {
  battleId: string;
  vrfSeed: bigint;
  tier: ArenaLayout['tier'];
  teamA: LobsterInput[];
  teamB: LobsterInput[];
  /** Explicit layout (e.g. a designer-authored one); generated from the seed when omitted. */
  layout?: ArenaLayout;
  /**
   * BALANCE EXPERIMENT KNOB — battle HP multiplier applied instead of the
   * resolver's HP_BATTLE_SCALE (5). Docs specify ×5; headless batches show that
   * yields ~100-turn stalemates, so this exists to sweep alternatives. Leave
   * undefined for spec behaviour.
   */
  hpScale?: bigint;
  /** Partial rule overrides for balance experiments (see BattleRules). */
  rules?: Partial<BattleRules>;
}

export const DEFAULT_RULES: BattleRules = {
  fortifyReflectBase: FORTIFY_REFLECT_BASE,
  fortifyReflectEnhanced: FORTIFY_ENHANCED_REFLECT,
  moveRange: {},
  attackMult: {},
};

export function createBattle(cfg: BattleConfig): AtbBattleState {
  if (cfg.teamA.length !== 3 || cfg.teamB.length !== 3) throw new Error('Each team needs exactly 3 lobsters');
  const layout = cfg.layout ?? generateLayout(cfg.vrfSeed, cfg.tier);
  const make = (input: LobsterInput, team: Team, slot: number): AtbLobster => {
    const stats = scaleStats(getBaseStats(input.class), input.tier, !!input.legend);
    if (cfg.hpScale !== undefined) stats.hp = (stats.hp * cfg.hpScale) / HP_BATTLE_SCALE;
    const am = cfg.rules?.attackMult?.[input.class];
    if (am !== undefined) stats.attack = (stats.attack * am) / 1000n;
    const spawns = team === 'A' ? layout.teamASpawns : layout.teamBSpawns;
    return {
      id: input.id, team, slot, class: input.class, tier: input.tier, purity: input.purity, legend: !!input.legend,
      stats, maxHp: stats.hp, hp: stats.hp, alive: true, pos: { ...spawns[slot] }, charge: 0, defending: false,
      statuses: [], lastTick: 0n, turnsTaken: 0, stunImmunity: 0, tiebreak: deriveRandom(cfg.vrfSeed, `tie_${input.id}`),
    };
  };
  const lobsters = [...cfg.teamA.map((l, i) => make(l, 'A', i)), ...cfg.teamB.map((l, i) => make(l, 'B', i))];
  const ids = new Set(lobsters.map(l => l.id));
  if (ids.size !== 6) throw new Error('Lobster ids must be unique');
  return { battleId: cfg.battleId, vrfSeed: cfg.vrfSeed, layout, rules: { ...DEFAULT_RULES, ...cfg.rules }, lobsters, damageDealt: { A: 0n, B: 0n }, turn: 0, tick: 0n, finished: false, winner: null, log: [] };
}

export type Policy = (state: AtbBattleState, actor: AtbLobster) => TurnCommand;

/** Run to completion (or `maxTurns`) with one policy per side. */
export function runBattle(state: AtbBattleState, policies: Record<Team, Policy>, maxTurns = Infinity): TurnResult[] {
  const results: TurnResult[] = [];
  while (!state.finished && results.length < maxTurns) {
    const actor = nextActor(state);
    if (!actor) break;
    const cmd = hasStatus(actor, 'stun') ? null : policies[actor.team](state, actor);
    results.push(applyTurn(state, cmd));
  }
  return results;
}

// ──────────── Baseline policies ────────────

function nearestEnemy(state: AtbBattleState, actor: AtbLobster, from: HexPos): AtbLobster | null {
  let best: AtbLobster | null = null, bd = Infinity;
  for (const l of state.lobsters) {
    if (!l.alive || l.team === actor.team) continue;
    const d = hexDistance(from, l.pos);
    if (d < bd || (d === bd && best && l.hp < best.hp)) { best = l; bd = d; }
  }
  return best;
}

function lowestHp(cands: AtbLobster[]): AtbLobster | null {
  return cands.reduce<AtbLobster | null>((b, l) => (!b || l.hp < b.hp ? l : b), null);
}

/** Always Defend, never move. Useful for tempo/ATB tests. */
export const defendPolicy: Policy = (_state, actor) => ({ lobsterId: actor.id, action: 'defend' });

/**
 * Greedy: close to the nearest enemy (prefer adjacency), cast Special when
 * charged and a legal target exists, else attack the lowest-HP enemy in range,
 * else Defend. Deterministic — no randomness beyond the battle's VRF stream.
 */
export const greedyPolicy: Policy = (state, actor) => {
  const options: HexPos[] = [actor.pos, ...legalMoves(state, actor)];
  // Pick the cell that minimises distance to the nearest enemy; ties keep current cell.
  let dest = actor.pos, bestD = Infinity;
  for (const c of options) {
    const e = nearestEnemy(state, actor, c);
    const d = e ? hexDistance(c, e.pos) : Infinity;
    if (d < bestD) { bestD = d; dest = c; }
  }
  const moveTo = dest === actor.pos ? undefined : dest;

  if (canCastSpecial(actor)) {
    const kind = specialTargetKind(actor.class);
    if (kind === 'none') {
      // Fortify always useful; Maelstrom only if it hits someone.
      if (actor.class === LobsterClass.Bulwark || specialTargetsAoE(state, actor, dest) > 0) return { lobsterId: actor.id, moveTo, action: 'special' };
    } else {
      const cands = specialTargets(state, actor, dest);
      if (kind === 'ally') {
        const hurt = cands.filter(l => l.hp * 10n < l.maxHp * 7n);
        const t = hurt.reduce<AtbLobster | null>((b, l) => (!b || l.hp * b.maxHp < b.hp * l.maxHp ? l : b), null);
        if (t) return { lobsterId: actor.id, moveTo, action: 'special', targetId: t.id };
      } else {
        const t = lowestHp(cands);
        if (t) return { lobsterId: actor.id, moveTo, action: 'special', targetId: t.id };
      }
    }
  }
  const t = lowestHp(attackTargets(state, actor, dest));
  if (t) return { lobsterId: actor.id, moveTo, action: 'attack', targetId: t.id };
  return { lobsterId: actor.id, moveTo, action: 'defend' };
};

function specialTargetsAoE(state: AtbBattleState, actor: AtbLobster, from: HexPos): number {
  return state.lobsters.filter(l => l.alive && l.team !== actor.team && hexDistance(from, l.pos) <= 3).length;
}
