'use client';

import { useMemo, useState } from 'react';
import type { BattleLobsterConfig } from '@/lib/battle-anim/types';
import { SPRITE_SIZE } from '@/lib/battle-anim/positions';
import { getTeamPos } from '@/lib/battle-anim/positions';
import { useBattleImages } from '@/hooks/use-battle-images';
import { useBattlePlayback } from '@/hooks/use-battle-playback';
import { BattleCanvas } from './battle-canvas';
import { BattleOverlay } from './battle-overlay';
import { BattleControls } from './battle-controls';
import { cn } from '@/lib/utils';

// ── Round data shape (matches API) ──

interface RoundData {
  round: number;
  actions: Array<{
    actorTeam: string;
    actorSlot: number;
    moveType: number;
    targetSlot: number;
    damage: string;
    isCrit: boolean;
    isEnhanced: boolean;
  }>;
  teamAHp: string[];
  teamBHp: string[];
}

// ── Props ──

interface BattleViewerProps {
  rounds: RoundData[];
  lobsters: BattleLobsterConfig[];
  tier: number;
  scene?: number;
  autoPlay?: boolean;
  compact?: boolean;
}

export function BattleViewer({
  rounds,
  lobsters,
  tier,
  scene = 0,
  autoPlay = false,
  compact = false,
}: BattleViewerProps) {
  const [speed, setSpeed] = useState(1);

  // Preload images
  const { images, arenaBackground, loading, progress } = useBattleImages(
    lobsters,
    tier,
    scene,
  );

  // Playback state
  const {
    stateRef,
    callbacksRef,
    controls,
    isPlaying,
    currentRound,
    totalRounds,
    phase,
  } = useBattlePlayback({
    rounds,
    lobsters,
    tier,
    scene,
    autoPlay,
    speed,
  });

  // Pre-compute lobster positions for overlay (canonical coords)
  const lobsterPositions = useMemo(() => {
    const positions = getTeamPos(tier, scene);
    const result: Record<string, { x: number; y: number }> = {};

    for (const lobster of lobsters) {
      const posArray =
        lobster.side === 'a' ? positions.a : positions.b;
      const pos = posArray[lobster.slot] ?? { x: 0, y: 0 };
      result[lobster.id] = { x: pos.x, y: pos.y };
    }

    return result;
  }, [lobsters, tier, scene]);

  // Handle speed changes through both state and playback
  const handleSetSpeed = (s: number) => {
    setSpeed(s);
    controls.setSpeed(s);
  };

  // Loading state
  if (loading) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center bg-black/30 rounded-lg',
          compact ? 'p-4' : 'p-8',
        )}
        style={{ aspectRatio: '16 / 9' }}
      >
        <div className="text-white/60 text-sm mb-3">Loading battle...</div>
        <div className="w-48 h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-amber-400/80 transition-all duration-200"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <div className="text-white/40 text-xs mt-1.5 tabular-nums">
          {Math.round(progress * 100)}%
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-2',
        compact ? 'max-w-md' : 'max-w-2xl',
      )}
    >
      {/* Arena container (canvas + overlay) */}
      <div className="relative rounded-lg overflow-hidden shadow-lg">
        <BattleCanvas
          stateRef={stateRef}
          images={images}
          arenaBackground={arenaBackground}
          tier={tier}
        />
        <BattleOverlay
          callbacksRef={callbacksRef}
          lobsterPositions={lobsterPositions}
        />
      </div>

      {/* Controls */}
      <BattleControls
        isPlaying={isPlaying}
        currentRound={currentRound}
        totalRounds={totalRounds}
        speed={speed}
        onPlay={controls.play}
        onPause={controls.pause}
        onNextRound={controls.nextRound}
        onPrevRound={controls.prevRound}
        onSetSpeed={handleSetSpeed}
      />
    </div>
  );
}
