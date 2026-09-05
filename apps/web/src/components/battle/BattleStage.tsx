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
  type HexListData,
  type HexPosition,
} from './unity-bridge';
import type { BattleEndedPayload, BattleSnapshot, CurrentTurn, Side, TurnResolvedPayload, WireBarEntry } from '@/lib/battle-protocol';

const BUILD_BASE = '/unity-build/Build/unity-build';

export interface BattleStageProps {
  snapshot: BattleSnapshot | null;
  playerSide: Side | 'spectator';
  /** Oldest resolved turn awaiting animation. */
  nextToAnimate: TurnResolvedPayload | null;
  current: CurrentTurn | null;
  bar: WireBarEntry[];
  ended: BattleEndedPayload | null;
  highlights: HexListData | null;
  onTurnAnimationComplete: (turn: number) => void;
  onHexClick: (hex: HexPosition) => void;
  onLobsterClick: (id: string) => void;
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

function UnityStage(props: BattleStageProps) {
  const { unityProvider, sendMessage, isLoaded, loadingProgression, initialisationError } = useUnityContext({
    loaderUrl: `${BUILD_BASE}.loader.js`,
    dataUrl: `${BUILD_BASE}.data.br`,
    frameworkUrl: `${BUILD_BASE}.framework.js.br`,
    codeUrl: `${BUILD_BASE}.wasm.br`,
  });
  const [unityReady, setUnityReady] = useState(false);
  const initedFor = useRef<string | null>(null);
  const animating = useRef<number | null>(null);
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
      onTurnAnimationComplete: (turn) => {
        animating.current = null;
        props.onTurnAnimationComplete(turn);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onLobsterClick, props.onHexClick, props.onTurnAnimationComplete]);

  useEffect(() => {
    if (initialisationError) props.onUnavailable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialisationError]);

  const ready = isLoaded && unityReady;

  // InitBattle once per session id (and again after a fresh snapshot on reconnect).
  useEffect(() => {
    if (!ready || !props.snapshot) return;
    const id = `${props.snapshot.session.id}:${props.snapshot.state.turn}`;
    if (initedFor.current?.startsWith(props.snapshot.session.id) && props.nextToAnimate) return; // mid-stream: don't re-init while turns are queued
    if (initedFor.current === id) return;
    if (initedFor.current?.startsWith(props.snapshot.session.id) && animating.current !== null) return;
    initedFor.current = id;
    send(UNITY_METHODS.INIT_BATTLE, buildInitData(props.snapshot, props.playerSide));
    props.onReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.snapshot?.session.id, props.snapshot?.state.turn === 0]);

  // Play the next resolved turn when idle.
  useEffect(() => {
    if (!ready || !props.nextToAnimate || animating.current !== null || !initedFor.current) return;
    animating.current = props.nextToAnimate.turn;
    send(UNITY_METHODS.PLAY_TURN, turnToPlayData(props.nextToAnimate));
  }, [ready, props.nextToAnimate, send]);

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
  }, [ready, props.current, props.nextToAnimate, props.bar, props.playerSide, send]);

  useEffect(() => {
    if (!ready) return;
    if (props.highlights) send(UNITY_METHODS.SHOW_SELECTION, props.highlights);
    else send(UNITY_METHODS.CLEAR_HIGHLIGHTS);
  }, [ready, props.highlights, send]);

  useEffect(() => {
    if (!ready || !props.ended || endedSent.current || props.nextToAnimate) return;
    endedSent.current = true;
    send(UNITY_METHODS.BATTLE_END, { winner: props.ended.winner, playerWon: props.playerSide !== 'spectator' && props.ended.winner === props.playerSide });
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
