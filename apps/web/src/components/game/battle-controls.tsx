'use client';

import { Play, Pause, SkipForward, SkipBack, FastForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface BattleControlsProps {
  isPlaying: boolean;
  currentRound: number;
  totalRounds: number;
  speed: number;
  onPlay(): void;
  onPause(): void;
  onNextRound(): void;
  onPrevRound(): void;
  onSetSpeed(speed: number): void;
  className?: string;
}

const SPEED_OPTIONS = [0.5, 1, 2] as const;

export function BattleControls({
  isPlaying,
  currentRound,
  totalRounds,
  speed,
  onPlay,
  onPause,
  onNextRound,
  onPrevRound,
  onSetSpeed,
  className,
}: BattleControlsProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-black/40 backdrop-blur-sm',
        className,
      )}
    >
      {/* Round indicator */}
      <span className="text-xs font-medium text-white/60 tabular-nums min-w-[80px]">
        Round {currentRound}/{totalRounds}
      </span>

      {/* Transport controls */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onPrevRound}
          disabled={currentRound <= 1}
          className="text-white/70 hover:text-white hover:bg-white/10"
          aria-label="Previous round"
        >
          <SkipBack className="size-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={isPlaying ? onPause : onPlay}
          className="text-white hover:bg-white/10"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <Pause className="size-4" />
          ) : (
            <Play className="size-4" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onNextRound}
          disabled={currentRound >= totalRounds}
          className="text-white/70 hover:text-white hover:bg-white/10"
          aria-label="Next round"
        >
          <SkipForward className="size-3.5" />
        </Button>
      </div>

      {/* Speed selector */}
      <div className="flex items-center gap-0.5 min-w-[80px] justify-end">
        <FastForward className="size-3 text-white/40 mr-1" />
        {SPEED_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onSetSpeed(s)}
            className={cn(
              'px-1.5 py-0.5 text-xs rounded transition-colors',
              s === speed
                ? 'bg-white/20 text-white font-bold'
                : 'text-white/50 hover:text-white/80 hover:bg-white/10',
            )}
            aria-label={`Speed ${s}x`}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}
