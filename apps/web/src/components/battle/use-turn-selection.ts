'use client';

/**
 * Turn-building state for the acting player: tentative move, action, target.
 * Legality comes from the real game-logic rules run on a seedless copy of the
 * server snapshot (highlights only — the server still validates everything).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { v3 } from '@clawbada/game-logic';
import type { BattleSnapshot, CurrentTurn, TurnCommand } from '@/lib/battle-protocol';
import type { HexListData, HexPosition } from './unity-bridge';

export type ActionChoice = 'attack' | 'special' | 'defend' | 'none';

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
  setAction: (a: ActionChoice) => void;
  clearMove: () => void;
  onHexClick: (hex: HexPosition) => void;
  onLobsterClick: (id: string) => void;
  reset: () => void;
}

function seedless(snapshot: BattleSnapshot): v3.AtbBattleState {
  return v3.fromWire({ ...snapshot.state, vrfSeed: '0' });
}

export function useTurnSelection(snapshot: BattleSnapshot | null, current: CurrentTurn | null, enabled: boolean): TurnSelection {
  const [moveTo, setMoveTo] = useState<HexPosition | null>(null);
  const [action, setActionState] = useState<ActionChoice>('attack');
  const [targetId, setTargetId] = useState<string | null>(null);

  // New turn → fresh selection.
  useEffect(() => {
    setMoveTo(null);
    setTargetId(null);
    setActionState('attack');
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

  const onHexClick = useCallback((hex: HexPosition) => {
    if (!actor || !summary) return;
    if (summary.moves.some((m) => m.col === hex.col && m.row === hex.row)) { setMoveTo(hex); setTargetId(null); return; }
    if (actor.pos.col === hex.col && actor.pos.row === hex.row) { setMoveTo(null); setTargetId(null); }
  }, [actor, summary]);

  const onLobsterClick = useCallback((id: string) => {
    if (!actor || !state) return;
    if (id === actor.id) { setMoveTo(null); setTargetId(null); return; }
    const target = state.lobsters.find((l) => l.id === id);
    if (!target) return;
    if (target.team !== actor.team) {
      setTargetId(id);
      if (action !== 'special' || specialKind !== 'enemy') setActionState('attack');
    } else if (specialKind === 'ally' && canSpecial) {
      setTargetId(id);
      setActionState('special');
    }
  }, [actor, state, action, specialKind, canSpecial]);

  const setAction = useCallback((a: ActionChoice) => {
    setActionState(a);
    if (a === 'defend' || a === 'none') setTargetId(null);
  }, []);

  return {
    actor, moveTo, action, targetId, summary, canSpecial, specialKind, highlights, command,
    valid: validity.valid, invalidReason: validity.reason,
    setAction, clearMove: () => { setMoveTo(null); setTargetId(null); }, onHexClick, onLobsterClick,
    reset: () => { setMoveTo(null); setTargetId(null); setActionState('attack'); },
  };
}
