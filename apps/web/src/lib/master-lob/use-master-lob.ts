'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v3 } from '@clawbada/game-logic';
import type { BattleSnapshot, CurrentTurn, Side } from '@/lib/battle-protocol';
import type { CoachState } from '@/components/battle/unity-bridge';
import { CoachCadence, chooseTip, classOf, loadSeen, resetIfExhausted, saveSeen, type CoachContext } from './coach';
import { TIPS } from './tips';

export interface CoachRequest { id: string; text: string; seq: number }

/**
 * Master Lob in a live battle: on each of the player's turns (once it can act, nothing left to animate) decide whether
 * he speaks and with which tip, and hand that to the Unity stage. Practice battles only, and only when the Dojo's
 * guidance toggle was on (`enabled`).
 */
export function useMasterLob(opts: {
  enabled: boolean;
  snapshot: BattleSnapshot | null;
  current: CurrentTurn | null;
  mySide: Side | null;
  canAct: boolean;
  introDone: boolean;
}): { request: CoachRequest | null; onCoachState: (s: CoachState) => void } {
  const { enabled, snapshot, current, mySide, canAct, introDone } = opts;
  const active = enabled && snapshot?.session.kind === 'practice' && !!mySide;
  const cadence = useMemo(() => new CoachCadence(), []);
  const seen = useRef<Set<string> | null>(null);
  const shownThisBattle = useRef(new Set<string>());
  const handledTurn = useRef<number | null>(null);
  const [request, setRequest] = useState<CoachRequest | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!active || !introDone || !canAct || !snapshot || !current || !mySide) return;
    if (handledTurn.current === current.turn) return;
    handledTurn.current = current.turn;
    if (!cadence.onPlayerTurn()) return;
    if (!seen.current) seen.current = loadSeen();
    let ctx: CoachContext | null = null;
    try {
      const state = v3.fromWire({ ...snapshot.state, vrfSeed: '0' });
      const actor = state.lobsters.find((l) => l.id === current.lobsterId);
      if (actor) {
        const living = state.lobsters.filter((l) => l.alive);
        ctx = { state, actor, mine: living.filter((l) => l.team === actor.team), enemies: living.filter((l) => l.team !== actor.team) };
      }
    } catch { /* no situational tips this turn */ }
    const team = new Set((ctx?.mine ?? []).map(classOf));
    resetIfExhausted(TIPS, team, seen.current);
    // His first word each battle is from the curriculum (the basics first); situational tips come after.
    const tip = chooseTip(TIPS, shownThisBattle.current.size === 0 ? null : ctx, team, seen.current, shownThisBattle.current);
    if (!tip) return;
    setRequest({ id: tip.id, text: tip.text, seq: ++seq.current });
  }, [active, introDone, canAct, snapshot, current, mySide, cadence]);

  const onCoachState = useCallback((s: CoachState) => {
    if (s.state === 'shown') {
      shownThisBattle.current.add(s.id);
      if (!seen.current) seen.current = loadSeen();
      seen.current.add(s.id);
      saveSeen(seen.current);
      cadence.spoke();
      console.log(`[MasterLob] said ${s.id}`);
    } else if (s.state === 'skipped') {
      // Not the moment (no free hex, already talking…): try again on the player's next turn.
      cadence.retryNext();
      console.log(`[MasterLob] skipped ${s.id}: ${s.detail}`);
    }
  }, [cadence]);

  return { request: active ? request : null, onCoachState };
}
