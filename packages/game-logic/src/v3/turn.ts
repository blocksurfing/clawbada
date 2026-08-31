/**
 * One ATB turn: validate the command against full board state, resolve it,
 * advance the bar, and append a hashed turn-log entry.
 *
 * Turn lifecycle for the acting lobster:
 *   start  → Defend stance ends; bleed ticks; a stunned lobster skips (stun → immunity)
 *   body   → optional Move (class range, no ending on an occupied hex), then one Action
 *   end    → charge (+1, Defend +1 bonus, Special → 0), status durations tick,
 *            stun immunity ticks, win check, bar projection
 */
import { DEFEND_COUNTER_BASE, MULT_DENOM } from '../constants';
import { deriveRandom, deriveVrfRoll, randomBool } from '../hash';
import { calculateAttackDamage, calculateDefendCounter, critChance, enhancedProcChance, getClassAdvantage } from '../battle-resolver';
import { nextActor, nextTick, projectBar } from './atb';
import { hexDistance, reachableCells, sameHex, shortestPath, type HexPos } from './board';
import { ATTACK_MAX_RANGE, CHARGE_CAP, CHARGE_PER_TURN, DEFEND_BONUS_CHARGE, DISTANCE_MULT, DISTANCE_MULT_LONG, MAX_TURNS, MOVE_RANGE, SPECIAL_COST, STUN_IMMUNITY_TURNS } from './constants';
import { applyIncomingDamage, dealDamage, effectiveStats, findLobster, hasStatus } from './effects';
import { hashState } from './log';
import { resolveSpecial, specialInRange, specialTargetKind } from './specials';
import type { AtbBattleState, AtbLobster, Team, TurnCommand, TurnResult } from './state';

export class TurnError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'TurnError';
  }
}

export function turnSeed(state: AtbBattleState, turn = state.turn): bigint {
  return deriveRandom(state.vrfSeed, `turn_${turn}`);
}

export function occupiedBy(state: AtbBattleState, except?: AtbLobster): HexPos[] {
  return state.lobsters.filter(l => l.alive && l !== except).map(l => l.pos);
}

/** Movement range for a class under this battle's rules (spec table unless overridden). */
export function moveRangeOf(state: AtbBattleState, cls: AtbLobster['class']): number {
  return state.rules.moveRange[cls] ?? MOVE_RANGE[cls];
}

/** Max attack range for a class under this battle's rules (spec: 3). */
export function attackRangeOf(state: AtbBattleState, cls: AtbLobster['class']): number {
  return state.rules.attackRange[cls] ?? ATTACK_MAX_RANGE;
}

/** Distance multiplier (×1000) for an attack by `cls` at `dist`; 0 = out of range. */
export function attackDistanceMult(state: AtbBattleState, cls: AtbLobster['class'], dist: number): bigint {
  if (dist > attackRangeOf(state, cls)) return 0n;
  return DISTANCE_MULT[dist] ?? DISTANCE_MULT_LONG;
}

export function legalMoves(state: AtbBattleState, actor: AtbLobster): HexPos[] {
  return reachableCells(state.layout, actor.pos, moveRangeOf(state, actor.class), occupiedBy(state, actor));
}

/** Taunting enemies adjacent to `from` — if any, they are the only legal enemy targets. */
export function tauntersAdjacent(state: AtbBattleState, actor: AtbLobster, from: HexPos): AtbLobster[] {
  return state.lobsters.filter(l => l.alive && l.team !== actor.team && hexDistance(from, l.pos) === 1 && l.statuses.some(s => s.type === 'taunt'));
}

/** Enemies attackable from `from` (distance 1–3); taunters adjacent to the attacker override. */
export function attackTargets(state: AtbBattleState, actor: AtbLobster, from: HexPos = actor.pos): AtbLobster[] {
  const taunters = tauntersAdjacent(state, actor, from);
  if (taunters.length > 0) return taunters;
  const range = attackRangeOf(state, actor.class);
  return state.lobsters.filter(l => l.alive && l.team !== actor.team && hexDistance(from, l.pos) <= range);
}

/** Legal Special targets from `from`; for targetless Specials returns [] (cast is still legal if charged). */
export function specialTargets(state: AtbBattleState, actor: AtbLobster, from: HexPos = actor.pos): AtbLobster[] {
  const kind = specialTargetKind(actor.class);
  if (kind === 'none') return [];
  const probe = { ...actor, pos: from };
  if (kind === 'enemy') {
    const taunters = tauntersAdjacent(state, actor, from);
    if (taunters.length > 0) return taunters.filter(l => specialInRange(probe, l));
  }
  return state.lobsters.filter(l => l.alive && (kind === 'enemy' ? l.team !== actor.team : l.team === actor.team) && specialInRange(probe, l));
}

export function canCastSpecial(state: AtbBattleState, actor: AtbLobster): boolean {
  return actor.charge >= state.rules.specialCost;
}

interface Validated {
  actor: AtbLobster;
  dest: HexPos;
  target: AtbLobster | null;
}

/** Throws TurnError on any illegal command — the engine rejects the whole turn. */
export function validateTurn(state: AtbBattleState, cmd: TurnCommand): Validated {
  if (state.finished) throw new TurnError('finished', 'Battle is over');
  const actor = nextActor(state);
  if (!actor) throw new TurnError('no_actor', 'No living lobster');
  return validateTurnFor(state, actor, cmd);
}

/** Validation against a known actor — used by applyTurn before any state is mutated. */
function validateTurnFor(state: AtbBattleState, actor: AtbLobster, cmd: TurnCommand): Validated {
  if (cmd.lobsterId !== actor.id) throw new TurnError('not_your_turn', `It is ${actor.id}'s turn, not ${cmd.lobsterId}`);
  if (hasStatus(actor, 'stun')) throw new TurnError('stunned', `${actor.id} is stunned and skips this turn`);

  let dest = actor.pos;
  if (cmd.moveTo && !sameHex(cmd.moveTo, actor.pos)) {
    if (!legalMoves(state, actor).some(c => sameHex(c, cmd.moveTo!))) throw new TurnError('illegal_move', `${actor.id} cannot reach (${cmd.moveTo.col},${cmd.moveTo.row})`);
    dest = cmd.moveTo;
  }

  let target: AtbLobster | null = null;
  switch (cmd.action) {
    case 'none':
    case 'defend':
      break;
    case 'attack': {
      if (!cmd.targetId) throw new TurnError('missing_target', 'Attack needs a target');
      const t = findLobster(state, cmd.targetId);
      if (!t || !t.alive || t.team === actor.team) throw new TurnError('bad_target', 'Attack target must be a living enemy');
      if (hexDistance(dest, t.pos) > attackRangeOf(state, actor.class)) throw new TurnError('out_of_range', `${t.id} is out of attack range`);
      if (!attackTargets(state, actor, dest).some(x => x.id === t.id)) throw new TurnError('taunted', `${actor.id} must target an adjacent taunting enemy`);
      target = t;
      break;
    }
    case 'special': {
      if (!canCastSpecial(state, actor)) throw new TurnError('no_charge', `${actor.id} needs ${state.rules.specialCost} charge`);
      const kind = specialTargetKind(actor.class);
      if (kind === 'none') break;
      if (!cmd.targetId) throw new TurnError('missing_target', 'Special needs a target');
      const t = findLobster(state, cmd.targetId);
      if (!t || !t.alive) throw new TurnError('bad_target', 'Special target must be alive');
      if (kind === 'enemy' && t.team === actor.team) throw new TurnError('bad_target', 'Special target must be an enemy');
      if (kind === 'ally' && t.team !== actor.team) throw new TurnError('bad_target', 'Special target must be an ally');
      if (!specialInRange({ ...actor, pos: dest }, t)) throw new TurnError('out_of_range', `${t.id} is out of Special range`);
      if (kind === 'enemy' && !specialTargets(state, actor, dest).some(x => x.id === t.id)) throw new TurnError('taunted', `${actor.id} must target an adjacent taunting enemy`);
      target = t;
      break;
    }
    default:
      throw new TurnError('bad_action', `Unknown action ${(cmd as TurnCommand).action}`);
  }
  return { actor, dest, target };
}

function newResult(state: AtbBattleState, actor: AtbLobster, tick: bigint): TurnResult {
  return {
    turn: state.turn, tick, lobsterId: actor.id, skipped: null, path: [], action: null, targetId: null, isEnhanced: false,
    damage: [], heals: [], statuses: [], chargeAfter: actor.charge, bar: [], finished: false, winner: null,
  };
}

/**
 * Advance the battle by one turn. Pass `null` (or anything) when the next actor
 * is stunned — the skip is resolved regardless of the command.
 */
export function applyTurn(state: AtbBattleState, cmd: TurnCommand | null): TurnResult {
  if (state.finished) throw new TurnError('finished', 'Battle is over');
  const actor = nextActor(state);
  if (!actor) throw new TurnError('no_actor', 'No living lobster');

  // Validate before touching any state, so a rejected command leaves the battle untouched.
  const stunned = hasStatus(actor, 'stun');
  let validated: Validated | null = null;
  if (!stunned) {
    if (!cmd) throw new TurnError('missing_command', `${actor.id} must act`);
    validated = validateTurnFor(state, actor, cmd);
  }

  const tick = nextTick(actor);
  state.turn += 1;
  state.tick = tick;
  actor.lastTick = tick;
  actor.turnsTaken += 1;
  actor.defending = false;
  actor.recentHits = 0; // focus-falloff window resets on the target's own turn
  const out = newResult(state, actor, tick);
  const seed = turnSeed(state);

  // Start of turn: bleed (credited to the enemy team — only enemies inflict it).
  for (const s of actor.statuses)
    if (s.type === 'bleed' && actor.alive) {
      const before = actor.hp;
      dealDamage(actor, s.value, 'bleed', out);
      state.damageDealt[actor.team === 'A' ? 'B' : 'A'] += before < s.value ? before : s.value;
    }

  let logAction: TurnCommand['action'] | 'skip' = 'skip';
  let logMove: HexPos | undefined;
  let logTarget: string | undefined;

  if (!actor.alive) {
    out.skipped = null; // died to bleed; no action
  } else if (stunned) {
    actor.statuses = actor.statuses.filter(s => s.type !== 'stun');
    actor.stunImmunity = STUN_IMMUNITY_TURNS + 1; // +1: decremented at the end of this same turn
    out.skipped = 'stun';
    out.statuses.push({ targetId: actor.id, status: 'stun', applied: false });
  } else {
    const { dest, target } = validated!;
    cmd = cmd!;
    if (!sameHex(dest, actor.pos)) {
      out.path = shortestPath(state.layout, actor.pos, dest);
      actor.pos = dest;
      logMove = dest;
    }
    out.action = cmd.action;
    logAction = cmd.action;
    switch (cmd.action) {
      case 'attack':
        resolveAttack(state, actor, target!, seed, out);
        logTarget = target!.id;
        break;
      case 'defend':
        actor.defending = true;
        break;
      case 'special': {
        out.isEnhanced = randomBool(seed, 'enhanced', enhancedProcChance(actor.purity), 10_000n);
        out.targetId = target?.id ?? null;
        logTarget = target?.id;
        resolveSpecial(state, actor, target, seed, out.isEnhanced, out);
        break;
      }
      case 'none':
        break;
    }
    // Charge economy.
    if (cmd.action === 'special') actor.charge = 0;
    else actor.charge = Math.min(CHARGE_CAP, actor.charge + CHARGE_PER_TURN + (cmd.action === 'defend' ? DEFEND_BONUS_CHARGE : 0));
  }
  out.chargeAfter = actor.charge;

  // End of turn: durations tick for statuses that pre-date this turn; immunity ticks.
  if (actor.alive) {
    actor.statuses = actor.statuses
      .map(s => (s.since < state.turn ? { ...s, turns: s.turns - 1 } : s))
      .filter(s => {
        if (s.turns > 0) return true;
        out.statuses.push({ targetId: actor.id, status: s.type, applied: false });
        return false;
      });
    if (actor.stunImmunity > 0) actor.stunImmunity -= 1;
  }

  checkWin(state);
  out.finished = state.finished;
  out.winner = state.winner;
  out.bar = state.finished ? [] : projectBar(state);
  state.log.push({ turn: state.turn, tick: tick.toString(), lobsterId: actor.id, moveTo: logMove, action: logAction, targetId: logTarget, postStateHash: hashState(state) });
  return out;
}

function resolveAttack(state: AtbBattleState, actor: AtbLobster, target: AtbLobster, seed: bigint, out: TurnResult): void {
  const a = effectiveStats(actor);
  const t = effectiveStats(target);
  const dist = hexDistance(actor.pos, target.pos);
  const isCrit = randomBool(seed, 'crit', critChance(a.critical), 10_000n);
  const base = calculateAttackDamage(a.attack, t.armor, getClassAdvantage(actor.class, target.class), isCrit, deriveVrfRoll(seed, 'atk_vrf'));
  let dmg = (base * attackDistanceMult(state, actor.class, dist)) / MULT_DENOM;
  // Guard penalty: shooting past an adjacent enemy frontliner is punished.
  if (state.rules.guardPenaltyBps > 0n && dist >= 2 && state.lobsters.some(l => l.alive && l.team !== actor.team && hexDistance(actor.pos, l.pos) === 1))
    dmg = (dmg * (10_000n - state.rules.guardPenaltyBps)) / 10_000n;
  out.targetId = target.id;
  applyIncomingDamage(state, actor, target, dmg, 'attack', out, { isCrit });

  // Defend counter: only from a defending target that survived, only vs adjacent attackers.
  if (target.defending && target.alive && dist === 1 && DEFEND_COUNTER_BASE > 0n) {
    const counter = calculateDefendCounter(t.attack, a.armor, getClassAdvantage(target.class, actor.class), deriveVrfRoll(seed, 'counter_vrf'));
    applyIncomingDamage(state, target, actor, counter, 'counter', out);
  }
}

function teamAlive(state: AtbBattleState, team: Team): boolean {
  return state.lobsters.some(l => l.team === team && l.alive);
}

function hpPercent(state: AtbBattleState, team: Team): bigint {
  let cur = 0n, max = 0n;
  for (const l of state.lobsters) if (l.team === team) { cur += l.hp > l.maxHp ? l.maxHp : l.hp; max += l.maxHp; }
  return max === 0n ? 0n : (cur * 10_000n) / max;
}

function checkWin(state: AtbBattleState): void {
  const aAlive = teamAlive(state, 'A');
  const bAlive = teamAlive(state, 'B');
  if (!aAlive || !bAlive) {
    state.finished = true;
    state.winner = aAlive ? 'A' : bAlive ? 'B' : 'draw';
    return;
  }
  if (state.turn >= MAX_TURNS) {
    state.finished = true;
    // Tiebreaks at the cap: remaining HP%, then damage dealt (so a passive team
    // cannot secure a draw by refusing to engage), then draw.
    const a = hpPercent(state, 'A'), b = hpPercent(state, 'B');
    if (a !== b) state.winner = a > b ? 'A' : 'B';
    else if (state.damageDealt.A !== state.damageDealt.B) state.winner = state.damageDealt.A > state.damageDealt.B ? 'A' : 'B';
    else state.winner = 'draw';
  }
}
