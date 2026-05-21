'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Unity, useUnityContext } from 'react-unity-webgl';
import {
  registerUnityCallbacks,
  UNITY_METHODS,
  type BattleInitData,
  type PhaseData,
  type RoundResult,
  type PositioningCommit,
  type CombatCommit,
  type UnityCallbackHandler,
} from './unity-bridge';

interface UnityBattleProps {
  battleInit: BattleInitData;
  onPositioningCommit: (commit: PositioningCommit) => void;
  onCombatCommit: (commit: CombatCommit) => void;
  phase?: PhaseData | null;
  roundResult?: RoundResult | null;
  battleEnd?: { winner: 'a' | 'b'; playerWon: boolean } | null;
}

/**
 * Unity WebGL battle component.
 * Renders the hex grid arena and handles all battle visualization.
 * Communication with game server flows through React (parent) via props/callbacks.
 */
export function UnityBattle({
  battleInit,
  onPositioningCommit,
  onCombatCommit,
  phase,
  roundResult,
  battleEnd,
}: UnityBattleProps) {
  const [isReady, setIsReady] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const sentInit = useRef(false);

  const { unityProvider, sendMessage, isLoaded, loadingProgression } = useUnityContext({
    loaderUrl: '/unity-build/Build/battle.loader.js',
    dataUrl: '/unity-build/Build/battle.data.br',
    frameworkUrl: '/unity-build/Build/battle.framework.js.br',
    codeUrl: '/unity-build/Build/battle.wasm.br',
  });

  // Track loading progress
  useEffect(() => {
    setLoadingProgress(Math.round(loadingProgression * 100));
  }, [loadingProgression]);

  // Register JS callbacks for Unity → React communication
  useEffect(() => {
    const handlers: UnityCallbackHandler = {
      onPositioningCommit,
      onCombatCommit,
      onLobsterSelected: () => {},
      onUnityReady: () => setIsReady(true),
      onAnimationComplete: () => {},
    };
    const cleanup = registerUnityCallbacks(handlers);
    return cleanup;
  }, [onPositioningCommit, onCombatCommit]);

  // Send init data to Unity once it's ready
  useEffect(() => {
    if (isReady && !sentInit.current) {
      sentInit.current = true;
      sendMessage('BattleBridge', UNITY_METHODS.INIT_BATTLE, JSON.stringify(battleInit));
    }
  }, [isReady, battleInit, sendMessage]);

  // Push phase updates to Unity
  useEffect(() => {
    if (isReady && phase) {
      sendMessage('BattleBridge', UNITY_METHODS.START_PHASE, JSON.stringify(phase));
    }
  }, [isReady, phase, sendMessage]);

  // Push round results to Unity for animation playback
  useEffect(() => {
    if (isReady && roundResult) {
      sendMessage('BattleBridge', UNITY_METHODS.PLAY_ROUND, JSON.stringify(roundResult));
    }
  }, [isReady, roundResult, sendMessage]);

  // Push battle end to Unity
  useEffect(() => {
    if (isReady && battleEnd) {
      sendMessage('BattleBridge', UNITY_METHODS.BATTLE_END, JSON.stringify(battleEnd));
    }
  }, [isReady, battleEnd, sendMessage]);

  // Handle timer updates
  const updateTimer = useCallback((timeRemaining: number) => {
    if (isReady) {
      sendMessage('BattleBridge', UNITY_METHODS.UPDATE_TIMER, JSON.stringify({ timeRemaining }));
    }
  }, [isReady, sendMessage]);

  // Expose timer update for parent to call
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__clawbadaUpdateTimer = updateTimer;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return () => { delete (window as any).__clawbadaUpdateTimer; };
  }, [updateTimer]);

  return (
    <div className="relative w-full aspect-[16/9] rounded-lg overflow-hidden bg-black">
      {/* Loading screen */}
      {!isLoaded && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-ocean-deep">
          <div className="font-pixel text-lg text-claw-gold mb-4">ENTERING THE ARENA</div>
          <div className="w-48 h-2 bg-ocean-mid rounded-full overflow-hidden">
            <div
              className="h-full bg-claw-gold rounded-full transition-all duration-300"
              style={{ width: `${loadingProgress}%` }}
            />
          </div>
          <div className="text-xs text-text-secondary mt-2">{loadingProgress}%</div>
        </div>
      )}

      {/* Unity canvas */}
      <Unity
        unityProvider={unityProvider}
        style={{
          width: '100%',
          height: '100%',
          visibility: isLoaded ? 'visible' : 'hidden',
        }}
      />
    </div>
  );
}
