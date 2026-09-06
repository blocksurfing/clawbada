'use client';

/**
 * Turn-building state for the acting player: tentative move, action, target.
 * Legality comes from the real game-logic rules run on a seedless copy of the
 * server snapshot (highlights only — the server still validates everything).
 *
 * Two input models share this hook:
 *  - autoSubmit (the in-canvas Unity HUD, LOKR-style): tapping a legal target,
 *    Defend or Wait submits the turn immediately; Special arms first (or submits
 *    at once when targetless); a tentative move is previewed and can be undone.
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

  // Exactly one legal target for the chosen action → pick it, so Attack/Special is one
  // click away (LOKR-style). The player can still switch by clicking another target.
  useEffect(() => {
    if (!summary || targetId) return;
    const ids = action === 'attack' ? summary.attackTargets : action === 'special' && specialKind !== 'none' ? summary.specialTargets : [];
    if (ids.length === 1) setTargetId(ids[0]);
  }, [summary, action, specialKind, targetId]);

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

  const highlights = useMemo<HexListData | null>(() => {
    if (!actor || !summary || !state) return null;
    const pos = (id: string) => {
      const l = state.lobsters.find((x) => x.id === id);
      return l ? { col: l.pos.col, row: l.pos.row } : null;
    };
    const enemy = action === 'attack' ? summary.attackTargets : action === 'special' && specialKind === 'enemy' ? summary.specialTargets : [];
    const ally = action === 'special' && specialKind === 'ally' ? summary.specialTargets : [];
    return {
      originCol: from?.col ?? actor.pos.col,
      originRow: from?.row ?? actor.pos.row,
      rangeHexes: summary.moves,
      enemyTargets: enemy.map(pos).filter((p): p is HexPosition => !!p),
      allyTargets: ally.map(pos).filter((p): p is HexPosition => !!p),
    };
  }, [actor, summary, state, action, specialKind, from]);

  /** Validate with the real rules and hand the command to the session. */
  const trySubmit = useCallback((cmd: TurnCommand): boolean => {
    if (!state || !enabled) return false;
    try {
      v3.validateTurn(state, cmd);
    } catch (err) {
      setHint(err instanceof Error ? err.message : String(err));
      return false;
    }
    const ok = onSubmit ? onSubmit(cmd) : false;
    if (ok) setHint(null);
    else setHint('Could not send the turn — check the connection');
    return ok;
  }, [state, enabled, onSubmit]);

  const withMove = useCallback((cmd: TurnCommand): TurnCommand => (moveTo ? { ...cmd, moveTo } : cmd), [moveTo]);

  const pressAction = useCallback((a: ActionChoice) => {
    if (!actor || !summary) return;
    if (!autoSubmit) {
      setActionState(a);
      if (a === 'defend' || a === 'none') setTargetId(null);
      return;
    }
    switch (a) {
      case 'attack': {
        setActionState('attack');
        const ids = summary.attackTargets;
        const t = targetId && ids.includes(targetId) ? targetId : ids.length === 1 ? ids[0] : null;
        if (t) { setTargetId(t); trySubmit(withMove({ lobsterId: actor.id, action: 'attack', targetId: t })); }
        else setHint(ids.length ? 'Tap an enemy to attack' : 'No enemy in range — move closer, Defend or Wait');
        return;
      }
      case 'special': {
        if (!canSpecial) { setHint('Special needs 3 charge'); return; }
        setActionState('special');
        if (specialKind === 'none') { trySubmit(withMove({ lobsterId: actor.id, action: 'special' })); return; }
        const ids = summary.specialTargets;
        const t = targetId && ids.includes(targetId) ? targetId : ids.length === 1 ? ids[0] : null;
        if (t) { setTargetId(t); trySubmit(withMove({ lobsterId: actor.id, action: 'special', targetId: t })); }
        else setHint(specialKind === 'ally' ? 'Tap an ally' : 'Tap an enemy in range');
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
  }, [actor, summary, autoSubmit, targetId, canSpecial, specialKind, trySubmit, withMove]);

  const onHexClick = useCallback((hex: HexPosition) => {
    if (!actor || !summary) return;
    if (summary.moves.some((m) => m.col === hex.col && m.row === hex.row)) { setMoveTo(hex); setTargetId(null); setHint(null); return; }
    if (actor.pos.col === hex.col && actor.pos.row === hex.row) { setMoveTo(null); setTargetId(null); }
  }, [actor, summary]);

  const onLobsterClick = useCallback((id: string) => {
    if (!actor || !state || !summary) return;
    if (id === actor.id) { setMoveTo(null); setTargetId(null); return; }
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
      if (action === 'special' && specialKind === 'enemy' && canSpecial && summary.specialTargets.includes(id)) {
        setTargetId(id);
        trySubmit(withMove({ lobsterId: actor.id, action: 'special', targetId: id }));
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
  }, [actor, state, summary, action, specialKind, canSpecial, autoSubmit, trySubmit, withMove]);

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
