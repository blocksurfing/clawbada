'use client';

/**
 * Turn-building state for the acting player: tentative move, action, target.
 * Legality comes from the real game-logic rules run on a seedless copy of the
 * server snapshot (highlights only — the server still validates everything).
 *
 * Two input models share this hook:
 *  - autoSubmit (the in-canvas Unity HUD): Defend, Wait and a targetless Special send on one
 *    press. A TARGETED action is two-step (user, 2026-09-25 — targeting decides matches): the
 *    first tap on a target SELECTS it (ringed, info panel, a melee Special's step previewed) and
 *    nothing is sent; tapping the same target again, or pressing the armed action again, confirms.
 *    No target is ever chosen for the player. A tentative move is previewed and can be undone.
 *  - explicit (the React fallback panel): pick action + target, then Confirm.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { v3, CLASS_NAMES, CLASS_SPECIAL_NAMES, type LobsterClass } from '@clawbada/game-logic';
import type { BattleSnapshot, CurrentTurn, TurnCommand } from '@/lib/battle-protocol';
import type { HexListData, HexPosition } from './unity-bridge';

export type ActionChoice = 'attack' | 'special' | 'defend' | 'none';

export interface TurnSelectionOptions {
  /** Submit as soon as a legal command is complete (Unity action bar). */
  autoSubmit?: boolean;
  /** Sends the command; returns true when it went out. */
  onSubmit?: (command: TurnCommand) => boolean;
}

export interface TurnSelection {
  actor: v3.AtbLobster | null;
  moveTo: HexPosition | null;
  action: ActionChoice;
  targetId: string | null;
  summary: v3.LegalSummary | null;
  canSpecial: boolean;
  specialKind: 'none' | 'enemy' | 'ally';
  highlights: HexListData | null;
  command: TurnCommand | null;
  valid: boolean;
  invalidReason: string | null;
  /** Player-facing guidance from the last press/tap (autoSubmit mode). */
  hint: string | null;
  setAction: (a: ActionChoice) => void;
  /** Action-bar press with LOKR semantics (see file header). */
  pressAction: (a: ActionChoice) => void;
  clearMove: () => void;
  onHexClick: (hex: HexPosition) => void;
  onLobsterClick: (id: string) => void;
  reset: () => void;
}

function seedless(snapshot: BattleSnapshot): v3.AtbBattleState {
  return v3.fromWire({ ...snapshot.state, vrfSeed: '0' });
}

export function useTurnSelection(
  snapshot: BattleSnapshot | null,
  current: CurrentTurn | null,
  enabled: boolean,
  opts: TurnSelectionOptions = {},
): TurnSelection {
  const [moveTo, setMoveTo] = useState<HexPosition | null>(null);
  const [action, setActionState] = useState<ActionChoice>('attack');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  // True when `moveTo` was set by SELECTING a melee-Special target (the step to its landing hex),
  // not by the player tapping a hex. A player's own move always wins; a selection's step is undone
  // when the selection changes.
  const [autoMoved, setAutoMoved] = useState(false);
  const autoSubmit = !!opts.autoSubmit;
  const onSubmit = opts.onSubmit;

  // New turn → fresh selection.
  useEffect(() => {
    setMoveTo(null);
    setTargetId(null);
    setActionState('attack');
    setHint(null);
    setAutoMoved(false);
  }, [current?.turn, current?.lobsterId]);

  const state = useMemo(() => (snapshot && enabled ? seedless(snapshot) : null), [snapshot, enabled]);
  const actor = useMemo(() => (state && current?.lobsterId ? state.lobsters.find((l) => l.id === current.lobsterId) ?? null : null), [state, current?.lobsterId]);
  const from = moveTo ?? actor?.pos ?? null;
  const summary = useMemo(() => (state && actor && from ? v3.legalSummary(state, actor, from) : null), [state, actor, from]);
  const canSpecial = summary?.canSpecial ?? false;
  const specialKind = summary?.specialKind ?? 'none';

  // No target is ever chosen for the player (user, 2026-09-25: targeting decides matches, so it
  // must never fire without the player picking it). There used to be a "one legal target → pick
  // it" effect here; with the tap-to-act HUD it turned the next button press into a submit.

  const command = useMemo<TurnCommand | null>(() => {
    if (!actor) return null;
    const cmd: TurnCommand = { lobsterId: actor.id, action };
    if (moveTo) cmd.moveTo = moveTo;
    if ((action === 'attack' || (action === 'special' && specialKind !== 'none')) && targetId) cmd.targetId = targetId;
    return cmd;
  }, [actor, action, moveTo, targetId, specialKind]);

  const validity = useMemo(() => {
    if (!state || !command) return { valid: false, reason: null as string | null };
    try {
      v3.validateTurn(state, command);
      return { valid: true, reason: null };
    } catch (err) {
      return { valid: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }, [state, command]);

  // A melee Special (Ambush, Crush, Rend, Devour) only reaches adjacent enemies, but a turn is
  // move-then-act: an enemy the lobster can step next to this turn is a legal target too. For each
  // such enemy, the reachable hex nearest the lobster's own — tapping it moves there and casts (for
  // the Mantis that is the Ambush leap). Enemies already in reach from `from` need no entry.
  // What is legal from where the lobster actually stands (a selection's step is not a real move yet).
  const home = useMemo(() => (state && actor ? v3.legalSummary(state, actor, actor.pos) : null), [state, actor]);
  const manualMove = !!moveTo && !autoMoved;

  const specialReach = useMemo(() => {
    const reach = new Map<string, HexPosition>();
    if (!state || !actor || !home || !canSpecial || specialKind !== 'enemy') return reach;
    const direct = new Set(home.specialTargets);
    const byDistance = [...home.moves].sort((a, b) => v3.hexDistance(actor.pos, a) - v3.hexDistance(actor.pos, b));
    for (const cell of byDistance) {
      for (const id of v3.legalSummary(state, actor, cell).specialTargets) {
        if (!direct.has(id) && !reach.has(id)) reach.set(id, { col: cell.col, row: cell.row });
      }
    }
    return reach;
  }, [state, actor, home, canSpecial, specialKind]);

  const highlights = useMemo<HexListData | null>(() => {
    if (!actor || !summary || !state) return null;
    const pos = (id: string) => {
      const l = state.lobsters.find((x) => x.id === id);
      return l ? { col: l.pos.col, row: l.pos.row } : null;
    };
    const specialEnemies = manualMove || !home ? summary.specialTargets : [...home.specialTargets, ...specialReach.keys()];
    const enemy = action === 'attack' ? (manualMove || !home ? summary.attackTargets : home.attackTargets) : action === 'special' && specialKind === 'enemy' ? specialEnemies : [];
    const ally = action === 'special' && specialKind === 'ally' ? summary.specialTargets : [];
    return {
      originCol: from?.col ?? actor.pos.col,
      originRow: from?.row ?? actor.pos.row,
      rangeHexes: summary.moves,
      enemyTargets: enemy.map(pos).filter((p): p is HexPosition => !!p),
      allyTargets: ally.map(pos).filter((p): p is HexPosition => !!p),
    };
  }, [actor, summary, home, manualMove, state, action, specialKind, from, specialReach]);

  /** Validate with the real rules and hand the command to the session. */
  const trySubmit = useCallback((cmd: TurnCommand): boolean => {
    // Every way out of here that is not a send is logged: in the Unity view the hint is the
    // only feedback, and a press that goes nowhere reads as a frozen game.
    if (!state || !enabled) { console.warn(`[TurnSelection] press ignored — cannot act now (${!state ? 'no state' : 'not enabled'})`, cmd); return false; }
    try {
      v3.validateTurn(state, cmd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[TurnSelection] turn rejected locally: ${msg}`, cmd);
      setHint(msg);
      return false;
    }
    const ok = onSubmit ? onSubmit(cmd) : false;
    if (ok) setHint(null);
    else { console.warn('[TurnSelection] turn not sent — socket not open', cmd); setHint('Could not send the turn. Check the connection'); }
    return ok;
  }, [state, enabled, onSubmit]);

  // Only the player's own move rides along with an untargeted action; a selection's step does not.
  const withMove = useCallback((cmd: TurnCommand): TurnCommand => (manualMove && moveTo ? { ...cmd, moveTo } : cmd), [manualMove, moveTo]);

  const specialName = actor ? CLASS_SPECIAL_NAMES[actor.class as LobsterClass] ?? 'Special' : 'Special';

  /** Where `act` on `id` would be cast from: the player's own move, no move, or a melee Special's step. */
  const planTarget = useCallback((id: string, act: 'attack' | 'special'): { ok: true; step: HexPosition | null } | { ok: false; why: string } => {
    if (!summary || !home) return { ok: false, why: 'Not your turn' };
    if (act === 'attack') {
      const legal = manualMove ? summary.attackTargets : home.attackTargets;
      return legal.includes(id) ? { ok: true, step: null } : { ok: false, why: manualMove ? 'Out of range from that hex. Move elsewhere or undo' : 'Out of range. Move closer first' };
    }
    if (manualMove) return summary.specialTargets.includes(id) ? { ok: true, step: null } : { ok: false, why: `Out of reach for ${specialName} from that hex. Undo the move to let it step in` };
    if (home.specialTargets.includes(id)) return { ok: true, step: null };
    const cell = specialReach.get(id);
    return cell ? { ok: true, step: cell } : { ok: false, why: `Out of reach for ${specialName} this turn. Press Attack to attack instead` };
  }, [summary, home, manualMove, specialReach, specialName]);

  /** First step: select a target. Nothing is sent. */
  const selectTarget = useCallback((id: string, act: 'attack' | 'special') => {
    if (!actor || !state) return;
    const plan = planTarget(id, act);
    if (!plan.ok) { setHint(plan.why); return; }
    setActionState(act);
    setTargetId(id);
    if (!manualMove) { setMoveTo(plan.step); setAutoMoved(!!plan.step); }
    const picked = state.lobsters.find((l) => l.id === id);
    const who = picked ? CLASS_NAMES[picked.class as LobsterClass] ?? 'Target' : 'Target';
    const button = act === 'attack' ? 'Attack' : specialName;
    setHint(`${plan.step ? 'Steps in · ' : ''}${who} selected. Tap it again or press ${button} to confirm`);
    console.log(`[TurnSelection] select ${act} → ${id}${plan.step ? ` step(${plan.step.col},${plan.step.row})` : ''}`);
  }, [actor, state, planTarget, manualMove, specialName]);

  /** Second step: send the selected target. */
  const confirmTarget = useCallback(() => {
    if (!actor || !targetId || (action !== 'attack' && action !== 'special')) return;
    const cmd: TurnCommand = { lobsterId: actor.id, action, targetId };
    if (moveTo) cmd.moveTo = moveTo;
    console.log(`[TurnSelection] confirm ${action} → ${targetId}`);
    trySubmit(cmd);
  }, [actor, targetId, action, moveTo, trySubmit]);

  /** Drop the selection (and a selection's step, never the player's own move). */
  const clearTarget = useCallback(() => {
    setTargetId(null);
    if (autoMoved) { setMoveTo(null); setAutoMoved(false); }
  }, [autoMoved]);

  const pressAction = useCallback((a: ActionChoice) => {
    if (!actor || !summary) { console.warn(`[TurnSelection] press ${a} ignored — no actor/summary`); return; }
    if (!autoSubmit) {
      setActionState(a);
      if (a === 'defend' || a === 'none') setTargetId(null);
      return;
    }
    switch (a) {
      case 'attack': {
        if (action === 'attack' && targetId) { confirmTarget(); return; }
        setActionState('attack');
        // Re-arming keeps a selected enemy if Attack can reach it too; otherwise the player taps one.
        if (targetId && planTarget(targetId, 'attack').ok) { selectTarget(targetId, 'attack'); return; }
        clearTarget();
        const ids = manualMove ? summary.attackTargets : home?.attackTargets ?? [];
        setHint(ids.length ? 'Tap an enemy to select it' : 'No enemy in range. Move closer, Defend or Wait');
        return;
      }
      case 'special': {
        if (!canSpecial) { setHint('Special needs 3 charge'); return; }
        if (specialKind === 'none') { setActionState('special'); clearTarget(); trySubmit(withMove({ lobsterId: actor.id, action: 'special' })); return; }
        if (action === 'special' && targetId) { confirmTarget(); return; }
        setActionState('special');
        if (targetId && planTarget(targetId, 'special').ok) { selectTarget(targetId, 'special'); return; }
        clearTarget();
        if (specialKind === 'ally') { setHint('Tap an ally to select it'); return; }
        const reachable = (manualMove ? summary.specialTargets.length : (home?.specialTargets.length ?? 0) + specialReach.size);
        setHint(reachable ? 'Tap a highlighted enemy to select it' : 'No enemy within reach this turn. Attack, Defend or Wait');
        return;
      }
      case 'defend':
        setActionState('defend');
        clearTarget();
        trySubmit(withMove({ lobsterId: actor.id, action: 'defend' }));
        return;
      case 'none':
        setActionState('none');
        clearTarget();
        trySubmit(withMove({ lobsterId: actor.id, action: 'none' }));
        return;
    }
  }, [actor, summary, home, autoSubmit, action, targetId, canSpecial, specialKind, specialReach, manualMove, planTarget, selectTarget, confirmTarget, clearTarget, trySubmit, withMove]);

  const onHexClick = useCallback((hex: HexPosition) => {
    if (!actor || !summary) return;
    // Any hex the player taps is THEIR move: it replaces a selection's step and drops the target.
    if (summary.moves.some((m) => m.col === hex.col && m.row === hex.row)) { setMoveTo(hex); setAutoMoved(false); setTargetId(null); setHint(null); return; }
    if (actor.pos.col === hex.col && actor.pos.row === hex.row) { setMoveTo(null); setAutoMoved(false); setTargetId(null); }
  }, [actor, summary]);

  const onLobsterClick = useCallback((id: string) => {
    if (!actor || !state || !summary) return;
    const target = state.lobsters.find((l) => l.id === id);
    if (!target) return;
    const enemy = target.team !== actor.team;

    if (!autoSubmit) {
      if (id === actor.id && !(specialKind === 'ally' && canSpecial)) { setMoveTo(null); setTargetId(null); return; }
      if (enemy) {
        setTargetId(id);
        if (action !== 'special' || specialKind !== 'enemy') setActionState('attack');
      } else if (specialKind === 'ally' && canSpecial) {
        setTargetId(id);
        setActionState('special');
      }
      return;
    }

    // Two-step: the second tap on the SELECTED target confirms it.
    if (targetId === id && (action === 'attack' || action === 'special')) { confirmTarget(); return; }

    if (enemy) {
      // An armed enemy Special stays the Special: an unreachable enemy gets a hint, never an Attack.
      const act = action === 'special' && specialKind === 'enemy' && canSpecial ? 'special' : 'attack';
      selectTarget(id, act);
    } else if (specialKind === 'ally' && canSpecial && action === 'special') {
      selectTarget(id, 'special');
    } else if (id === actor.id) {
      // Tapping yourself with nothing armed for allies = cancel the move and the selection.
      setMoveTo(null); setAutoMoved(false); setTargetId(null); setHint(null);
    } else if (specialKind === 'ally' && canSpecial) {
      setHint(`Press ${specialName} first, then tap the ally`);
    } else if (specialKind === 'ally') {
      setHint('Special needs 3 charge');
    }
  }, [actor, state, summary, action, targetId, specialKind, canSpecial, autoSubmit, specialName, selectTarget, confirmTarget]);

  const setAction = useCallback((a: ActionChoice) => {
    setActionState(a);
    if (a === 'defend' || a === 'none') setTargetId(null);
  }, []);

  return {
    actor, moveTo, action, targetId, summary, canSpecial, specialKind, highlights, command,
    valid: validity.valid, invalidReason: validity.reason, hint,
    setAction, pressAction,
    clearMove: () => { setMoveTo(null); setAutoMoved(false); setTargetId(null); setHint(null); },
    onHexClick, onLobsterClick,
    reset: () => { setMoveTo(null); setAutoMoved(false); setTargetId(null); setActionState('attack'); setHint(null); },
  };
}
