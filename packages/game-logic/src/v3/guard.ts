/**
 * Untrusted-input guard and legal-move enumeration for the live engine and HUD.
 * `validateTurn` throws on well-typed but illegal commands; this module sits in
 * front of it for arbitrary JSON, and enumerates the complete legal set the same
 * way validateTurn judges it (rankTurns is a *scored* subset — it drops Specials
 * it values at ≤ 0 — so it is not used here).
 */
import type { HexPos } from './board';
import { specialTargetKind } from './specials';
import type { AtbBattleState, AtbLobster, TurnCommand } from './state';
import { attackTargets, canCastSpecial, legalMoves, specialTargets } from './turn';

const ACTIONS = new Set(['attack', 'defend', 'special', 'none']);

function isInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x);
}

/** Structural parse of a TurnCommand from untrusted JSON. Never throws; returns null on any defect. */
export function parseTurnCommand(x: unknown): TurnCommand | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.lobsterId !== 'string' || o.lobsterId.length === 0 || o.lobsterId.length > 64) return null;
  if (typeof o.action !== 'string' || !ACTIONS.has(o.action)) return null;
  const cmd: TurnCommand = { lobsterId: o.lobsterId, action: o.action as TurnCommand['action'] };
  if (o.moveTo !== undefined && o.moveTo !== null) {
    const m = o.moveTo as Record<string, unknown>;
    if (!m || typeof m !== 'object' || !isInt(m.col) || !isInt(m.row) || m.col < 0 || m.row < 0 || m.col > 255 || m.row > 255) return null;
    cmd.moveTo = { col: m.col, row: m.row };
  }
  if (o.targetId !== undefined && o.targetId !== null) {
    if (typeof o.targetId !== 'string' || o.targetId.length === 0 || o.targetId.length > 64) return null;
    cmd.targetId = o.targetId;
  }
  return cmd;
}

/** Every legal command for `actor` right now: each reachable cell × {attacks, specials, defend, none}. */
export function legalCommands(state: AtbBattleState, actor: AtbLobster): TurnCommand[] {
  const out: TurnCommand[] = [];
  const cells: (HexPos | undefined)[] = [undefined, ...legalMoves(state, actor)];
  const canSpecial = canCastSpecial(state, actor);
  const kind = specialTargetKind(actor.class);
  for (const moveTo of cells) {
    const from = moveTo ?? actor.pos;
    for (const t of attackTargets(state, actor, from)) out.push({ lobsterId: actor.id, moveTo, action: 'attack', targetId: t.id });
    if (canSpecial) {
      if (kind === 'none') out.push({ lobsterId: actor.id, moveTo, action: 'special' });
      else for (const t of specialTargets(state, actor, from)) out.push({ lobsterId: actor.id, moveTo, action: 'special', targetId: t.id });
    }
    out.push({ lobsterId: actor.id, moveTo, action: 'defend' });
    out.push({ lobsterId: actor.id, moveTo, action: 'none' });
  }
  return out;
}

export interface LegalSummary {
  lobsterId: string;
  /** Cells the lobster may move to this turn (not including its own). */
  moves: HexPos[];
  /** Enemy ids attackable from `from`. */
  attackTargets: string[];
  /** Special targets from `from` ([] for targetless Specials). */
  specialTargets: string[];
  canSpecial: boolean;
  specialKind: 'none' | 'enemy' | 'ally';
}

/** HUD-shaped view of what is legal from a given (tentative) position. */
export function legalSummary(state: AtbBattleState, actor: AtbLobster, from: HexPos = actor.pos): LegalSummary {
  return {
    lobsterId: actor.id,
    moves: legalMoves(state, actor),
    attackTargets: attackTargets(state, actor, from).map(l => l.id),
    specialTargets: specialTargets(state, actor, from).map(l => l.id),
    canSpecial: canCastSpecial(state, actor),
    specialKind: specialTargetKind(actor.class),
  };
}
