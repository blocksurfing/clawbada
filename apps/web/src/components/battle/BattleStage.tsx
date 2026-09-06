'use client';

/**
 * Unity WebGL host. Drives the renderer one turn at a time and reports
 * animation completion back so the HUD never runs ahead of the picture.
 * If the build is not deployed (loader 404) it reports `onUnavailable` and the
 * page falls back to the SVG board.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Unity, useUnityContext } from 'react-unity-webgl';
import {
  UNITY_GAME_OBJECT,
  UNITY_METHODS,
  barToData,
  buildInitData,
  registerUnityCallbacks,
  turnToPlayData,
  unitsToSync,
  IDLE_SELECTION,
  type HexListData,
  type HexPosition,
  type SelectionData,
} from './unity-bridge';
import type { BattleEndedPayload, BattleSnapshot, CurrentTurn, Side, TurnResolvedPayload, WireBarEntry } from '@/lib/battle-protocol';

const BUILD_BASE = '/unity-build/Build/unity-build';

export interface BattleStageProps {
  snapshot: BattleSnapshot | null;
  /** Bumps on every full server snapshot (initial load, reconnect) — the only times Unity re-inits. */
  snapshotSeq: number;
  playerSide: Side | 'spectator';
  /** Oldest resolved turn awaiting animation. */
  nextToAnimate: TurnResolvedPayload | null;
  current: CurrentTurn | null;
  bar: WireBarEntry[];
  ended: BattleEndedPayload | null;
  highlights: HexListData | null;
  /** Action-bar state (null → bar hidden). */
  selection?: SelectionData | null;
  /** Tentative move destination for the acting lobster (null → at its origin). */
  previewMove?: HexPosition | null;
  onTurnAnimationComplete: (turn: number) => void;
  onHexClick: (hex: HexPosition) => void;
  onLobsterClick: (id: string) => void;
  onActionSelected?: (action: string) => void;
  onUndoMove?: () => void;
  onUnavailable: () => void;
  onReady: () => void;
}

export function BattleStage(props: BattleStageProps) {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BUILD_BASE}.loader.js`, { method: 'HEAD' })
      .then((r) => { if (!cancelled) setAvailable(r.ok); })
      .catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (available === false) props.onUnavailable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  if (available === null) return <div className="aspect-video w-full rounded-lg bg-ocean-mid/40 animate-pulse" />;
  if (available === false) return null;
  return <UnityStage {...props} />;
}

const ANIMATION_WATCHDOG_MS = 8_000;

function UnityStage(props: BattleStageProps) {
  const { unityProvider, sendMessage, isLoaded, loadingProgression, initialisationError } = useUnityContext({
    loaderUrl: `${BUILD_BASE}.loader.js`,
    dataUrl: `${BUILD_BASE}.data.unityweb`,
    frameworkUrl: `${BUILD_BASE}.framework.js.unityweb`,
    codeUrl: `${BUILD_BASE}.wasm.unityweb`,
  });
  const [unityReady, setUnityReady] = useState(false);
  const initedFor = useRef<string | null>(null);
  const animating = useRef<number | null>(null);
  /** If Unity never reports a turn's animation as finished (exception inside a coroutine,
   *  tab throttled, missing prefab), release the HUD anyway so the battle stays playable. */
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStartedTurn = useRef<number | null>(null);
  const endedSent = useRef(false);
  const send = useCallback((method: string, data?: unknown) => {
    if (data === undefined) sendMessage(UNITY_GAME_OBJECT, method);
    else sendMessage(UNITY_GAME_OBJECT, method, JSON.stringify(data));
  }, [sendMessage]);

  // Unity → React callbacks.
  useEffect(() => {
    return registerUnityCallbacks({
      onUnityReady: () => setUnityReady(true),
      onLobsterSelected: props.onLobsterClick,
      onHexClicked: props.onHexClick,
      onActionSelected: props.onActionSelected,
      onUndoMove: props.onUndoMove,
      onTurnAnimationComplete: (turn) => {
        if (watchdog.current) { clearTimeout(watchdog.current); watchdog.current = null; }
        animating.current = null;
        props.onTurnAnimationComplete(turn);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onLobsterClick, props.onHexClick, props.onTurnAnimationComplete, props.onActionSelected, props.onUndoMove]);

  useEffect(() => {
    if (initialisationError) {
      console.error('[BattleStage] Unity failed to initialise — falling back to the plain board', initialisationError);
      props.onUnavailable();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialisationError]);

  const ready = isLoaded && unityReady;

  // InitBattle once per server snapshot (initial load, and again on a reconnect snapshot).
  // Never keyed on the turn: re-initialising mid-battle respawns the rigs and rebinds the HUD.
  useEffect(() => {
    if (!ready || !props.snapshot) return;
    const id = `${props.snapshot.session.id}:${props.snapshotSeq}`;
    if (initedFor.current === id) return;
    if (initedFor.current?.startsWith(props.snapshot.session.id) && (props.nextToAnimate || animating.current !== null)) return; // wait for the picture to settle
    initedFor.current = id;
    send(UNITY_METHODS.INIT_BATTLE, buildInitData(props.snapshot, props.playerSide));
    // Statuses / defending are not part of InitBattle; the HUD needs them from the start.
    send(UNITY_METHODS.SYNC_UNITS, unitsToSync(props.snapshot));
    props.onReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.snapshot?.session.id, props.snapshotSeq, props.nextToAnimate]);

  // Play the next resolved turn when idle.
  useEffect(() => {
    if (!ready || !props.nextToAnimate || animating.current !== null || !initedFor.current) return;
    const turn = props.nextToAnimate.turn;
    animating.current = turn;
    send(UNITY_METHODS.PLAY_TURN, turnToPlayData(props.nextToAnimate));
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = setTimeout(() => {
      if (animating.current !== turn) return;
      console.warn(`[BattleStage] Unity did not report turn ${turn} animation complete within ${ANIMATION_WATCHDOG_MS}ms — releasing the HUD`);
      animating.current = null;
      props.onTurnAnimationComplete(turn);
    }, ANIMATION_WATCHDOG_MS);
  }, [ready, props.nextToAnimate, send]);

  // Server truth for every unit once nothing is animating: after each animated turn the
  // snapshot state changes, and Unity replaces its optimistic HP/charge/statuses with it.
  useEffect(() => {
    if (!ready || !props.snapshot || !initedFor.current || props.nextToAnimate || animating.current !== null) return;
    send(UNITY_METHODS.SYNC_UNITS, unitsToSync(props.snapshot));
  }, [ready, props.snapshot?.state, props.nextToAnimate, send]);

  // Announce the current turn once the picture has caught up.
  useEffect(() => {
    if (!ready || !props.current?.lobsterId || props.nextToAnimate || animating.current !== null) return;
    if (lastStartedTurn.current === props.current.turn) return;
    lastStartedTurn.current = props.current.turn;
    send(UNITY_METHODS.START_TURN, {
      turn: props.current.turn,
      lobsterId: props.current.lobsterId,
      side: props.current.side,
      deadlineMs: props.current.deadline ?? 0,
      isPlayer: props.playerSide !== 'spectator' && props.current.side === props.playerSide,
    });
    send(UNITY_METHODS.UPDATE_BAR, barToData(props.current.turn, props.bar));
    // Shot clock: Unity counts down locally from what is left right now.
    if (props.playerSide !== 'spectator' && props.current.side === props.playerSide && props.current.deadline) {
      send(UNITY_METHODS.SET_CLOCK, { remainingMs: Math.max(0, props.current.deadline - Date.now()) });
    }
  }, [ready, props.current, props.nextToAnimate, props.bar, props.playerSide, send]);

  useEffect(() => {
    if (!ready) return;
    if (props.highlights) send(UNITY_METHODS.SHOW_SELECTION, props.highlights);
    else send(UNITY_METHODS.CLEAR_HIGHLIGHTS);
  }, [ready, props.highlights, send]);

  // Action-bar state: every change of the player's selection, idle outside their turn.
  useEffect(() => {
    if (!ready || !initedFor.current) return;
    const sel = props.selection ?? IDLE_SELECTION;
    send(UNITY_METHODS.SET_SELECTION, sel);
    console.log(`[BattleStage] selection player=${sel.isPlayerTurn} act=${sel.action} canAct=${sel.canAct} targets=${sel.targetCount} pending=${sel.pendingAck}`);
  }, [ready, props.selection, send]);

  // Tentative move: slide the acting lobster to the chosen cell, or back to its origin.
  useEffect(() => {
    if (!ready || !initedFor.current || !props.selection?.isPlayerTurn || !props.current?.lobsterId) return;
    if (props.nextToAnimate || animating.current !== null) return;
    const actor = props.snapshot?.state.lobsters.find((l) => l.id === props.current!.lobsterId);
    if (!actor) return;
    const to = props.previewMove ?? actor.pos;
    send(UNITY_METHODS.PREVIEW_MOVE, { lobsterId: actor.id, col: to.col, row: to.row });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.previewMove, props.current?.lobsterId, props.selection?.isPlayerTurn, props.nextToAnimate, send]);

  useEffect(() => {
    if (!ready || !props.ended || endedSent.current || props.nextToAnimate) return;
    endedSent.current = true;
    send(UNITY_METHODS.BATTLE_END, {
      winner: props.ended.winner,
      playerWon: props.playerSide !== 'spectator' && props.ended.winner === props.playerSide,
      reason: props.ended.reason,
    });
  }, [ready, props.ended, props.nextToAnimate, props.playerSide, send]);

  return (
    <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-ocean-deep">
      <Unity unityProvider={unityProvider} className="w-full h-full" />
      {!isLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-secondary">
          <div className="w-48 h-1.5 rounded-full bg-ocean-mid overflow-hidden">
            <div className="h-full bg-claw-gold transition-all" style={{ width: `${Math.round(loadingProgression * 100)}%` }} />
          </div>
          <span className="font-pixel text-[10px]">Loading arena {Math.round(loadingProgression * 100)}%</span>
        </div>
      )}
    </div>
  );
}
