'use client';

/**
 * Turn-building state for the acting player: tentative move, action, target.
 * Legality comes from the real game-logic rules run on a seedless copy of the
 * server snapshot (highlights only — the server still validates everything).
 *
 * Two input models share this hook:
 *  - autoSubmit (the in-canvas Unity HUD, LOKR-style): tapping a legal target,
 *    Defend or Wait submits the turn immediately; Attack and Special only ARM (a targetless
 *    Special submits at once). A targeted action is never sent without the player tapping
 *    that target. A tentative move is previewed and can be undone.
 *  - explicit (the React fallback panel): pick action + target, then Confirm.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { v3 } from '@clawbada/game-logic';
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
  const autoSubmit = !!opts.autoSubmit;
  const onSubmit = opts.onSubmit;

  // New turn → fresh selection.
  useEffect(() => {
    setMoveTo(null);
    setTargetId(null);
    setActionState('attack');
    setHint(null);
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
  const specialReach = useMemo(() => {
    const reach = new Map<string, HexPosition>();
    if (!state || !actor || !summary || !canSpecial || specialKind !== 'enemy') return reach;
    const direct = new Set(summary.specialTargets);
    const byDistance = [...summary.moves].sort((a, b) => v3.hexDistance(actor.pos, a) - v3.hexDistance(actor.pos, b));
    for (const cell of byDistance) {
      for (const id of v3.legalSummary(state, actor, cell).specialTargets) {
        if (!direct.has(id) && !reach.has(id)) reach.set(id, { col: cell.col, row: cell.row });
      }
    }
    return reach;
  }, [state, actor, summary, canSpecial, specialKind]);

  const highlights = useMemo<HexListData | null>(() => {
    if (!actor || !summary || !state) return null;
    const pos = (id: string) => {
      const l = state.lobsters.find((x) => x.id === id);
      return l ? { col: l.pos.col, row: l.pos.row } : null;
    };
    const enemy = action === 'attack' ? summary.attackTargets : action === 'special' && specialKind === 'enemy' ? [...summary.specialTargets, ...specialReach.keys()] : [];
    const ally = action === 'special' && specialKind === 'ally' ? summary.specialTargets : [];
    return {
      originCol: from?.col ?? actor.pos.col,
      originRow: from?.row ?? actor.pos.row,
      rangeHexes: summary.moves,
      enemyTargets: enemy.map(pos).filter((p): p is HexPosition => !!p),
      allyTargets: ally.map(pos).filter((p): p is HexPosition => !!p),
    };
  }, [actor, summary, state, action, specialKind, from, specialReach]);

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
    else { console.warn('[TurnSelection] turn not sent — socket not open', cmd); setHint('Could not send the turn — check the connection'); }
    return ok;
  }, [state, enabled, onSubmit]);

  const withMove = useCallback((cmd: TurnCommand): TurnCommand => (moveTo ? { ...cmd, moveTo } : cmd), [moveTo]);

  const pressAction = useCallback((a: ActionChoice) => {
    if (!actor || !summary) { console.warn(`[TurnSelection] press ${a} ignored — no actor/summary`); return; }
    if (!autoSubmit) {
      setActionState(a);
      if (a === 'defend' || a === 'none') setTargetId(null);
      return;
    }
    switch (a) {
      case 'attack': {
        setActionState('attack');
        // Arms only: the attack is sent when the player taps the enemy (never auto-picked).
        const ids = summary.attackTargets;
        setTargetId(null);
        setHint(ids.length ? 'Tap an enemy to attack' : 'No enemy in range — move closer, Defend or Wait');
        return;
      }
      case 'special': {
        if (!canSpecial) { setHint('Special needs 3 charge'); return; }
        setActionState('special');
        if (specialKind === 'none') { trySubmit(withMove({ lobsterId: actor.id, action: 'special' })); return; }
        // A targeted Special only ARMS here — it never picks its own target. Auto-casting on the only
        // adjacent enemy spent Specials on the wrong lobster (the one beside you rather than the
        // nearly-dead one a step away). The player taps the target; highlights show every option.
        const reachable = summary.specialTargets.length + specialReach.size;
        if (specialKind === 'ally') setHint('Tap an ally');
        else setHint(reachable ? 'Tap a highlighted enemy' : 'No enemy within reach this turn — Attack, Defend or Wait');
        return;
      }
      case 'defend':
        setActionState('defend');
        setTargetId(null);
        trySubmit(withMove({ lobsterId: actor.id, action: 'defend' }));
        return;
      case 'none':
        setActionState('none');
        setTargetId(null);
        trySubmit(withMove({ lobsterId: actor.id, action: 'none' }));
        return;
    }
  }, [actor, summary, autoSubmit, targetId, canSpecial, specialKind, specialReach, trySubmit, withMove]);

  const onHexClick = useCallback((hex: HexPosition) => {
    if (!actor || !summary) return;
    if (summary.moves.some((m) => m.col === hex.col && m.row === hex.row)) { setMoveTo(hex); setTargetId(null); setHint(null); return; }
    if (actor.pos.col === hex.col && actor.pos.row === hex.row) { setMoveTo(null); setTargetId(null); }
  }, [actor, summary]);

  const onLobsterClick = useCallback((id: string) => {
    if (!actor || !state || !summary) return;
    if (id === actor.id) {
      // Self is a legal target for ally Specials (Rally): with the Special armed, tapping
      // the actor casts it on itself instead of cancelling the tentative move.
      if (autoSubmit && action === 'special' && specialKind === 'ally' && canSpecial && summary.specialTargets.includes(id)) {
        setTargetId(id);
        trySubmit(withMove({ lobsterId: actor.id, action: 'special', targetId: id }));
        return;
      }
      setMoveTo(null); setTargetId(null); return;
    }
    const target = state.lobsters.find((l) => l.id === id);
    if (!target) return;
    const enemy = target.team !== actor.team;

    if (!autoSubmit) {
      if (enemy) {
        setTargetId(id);
        if (action !== 'special' || specialKind !== 'enemy') setActionState('attack');
      } else if (specialKind === 'ally' && canSpecial) {
        setTargetId(id);
        setActionState('special');
      }
      return;
    }

    // LOKR: tapping a legal target resolves the turn.
    if (enemy) {
      const specialArmed = action === 'special' && specialKind === 'enemy' && canSpecial;
      if (specialArmed && summary.specialTargets.includes(id)) {
        setTargetId(id);
        trySubmit(withMove({ lobsterId: actor.id, action: 'special', targetId: id }));
      } else if (specialArmed && specialReach.has(id)) {
        // Step next to it and cast, in one turn.
        const cell = specialReach.get(id)!;
        setMoveTo(cell);
        setTargetId(id);
        trySubmit({ lobsterId: actor.id, moveTo: cell, action: 'special', targetId: id });
      } else if (specialArmed) {
        // Never swap a Special for a plain Attack behind the player's back.
        setHint('Out of reach for the Special this turn — tap Attack to attack instead');
      } else if (summary.attackTargets.includes(id)) {
        setActionState('attack');
        setTargetId(id);
        trySubmit(withMove({ lobsterId: actor.id, action: 'attack', targetId: id }));
      } else {
        setHint('Out of range — move closer first');
      }
    } else if (specialKind === 'ally' && canSpecial && summary.specialTargets.includes(id)) {
      setActionState('special');
      setTargetId(id);
      trySubmit(withMove({ lobsterId: actor.id, action: 'special', targetId: id }));
    } else if (specialKind === 'ally' && !canSpecial) {
      setHint('Special needs 3 charge');
    }
  }, [actor, state, summary, action, specialKind, canSpecial, autoSubmit, specialReach, trySubmit, withMove]);

  const setAction = useCallback((a: ActionChoice) => {
    setActionState(a);
    if (a === 'defend' || a === 'none') setTargetId(null);
  }, []);

  return {
    actor, moveTo, action, targetId, summary, canSpecial, specialKind, highlights, command,
    valid: validity.valid, invalidReason: validity.reason, hint,
    setAction, pressAction,
    clearMove: () => { setMoveTo(null); setTargetId(null); setHint(null); },
    onHexClick, onLobsterClick,
    reset: () => { setMoveTo(null); setTargetId(null); setActionState('attack'); setHint(null); },
  };
}
