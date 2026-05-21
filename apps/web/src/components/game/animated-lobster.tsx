'use client';

import { useLobsterSpriteSheet } from '@/hooks/use-lobster-sprite-sheet';
import { useLobsterImage } from '@/hooks/use-lobster-image';
import { cn } from '@/lib/utils';

interface AnimatedLobsterProps {
  dna: string | bigint;
  evolutionTier?: number;
  /** Visible size in CSS pixels */
  displaySize?: number;
  /** Per-frame pixel size requested from API (multiple of 80) */
  frameSize?: number;
  /** Number of animation frames (8 or 16) */
  frames?: number;
  className?: string;
}

const SCALE_FOR_FALLBACK: Record<number, number> = { 96: 2, 128: 2, 192: 4, 256: 4, 320: 8, 384: 8 };

export function AnimatedLobster({
  dna,
  evolutionTier = 0,
  displaySize = 384,
  frameSize = 240,
  frames = 16,
  className,
}: AnimatedLobsterProps) {
  const { spriteUrl, loading, error } = useLobsterSpriteSheet(dna, evolutionTier, frameSize, frames);

  // Fallback to static image if sprite sheet fails
  const fallbackScale = SCALE_FOR_FALLBACK[displaySize] ?? 4;
  const { dataUrl: staticUrl } = useLobsterImage(
    error ? dna : undefined,
    evolutionTier,
    fallbackScale,
  );

  // Loading state
  if (loading && !spriteUrl) {
    return (
      <div
        className={cn('animate-pulse bg-ocean-mid/40', className)}
        style={{ width: displaySize, height: displaySize }}
      />
    );
  }

  // Error fallback — show static image
  if (error || !spriteUrl) {
    if (staticUrl) {
      return (
        <img
          src={staticUrl}
          alt="Lobster"
          width={displaySize}
          height={displaySize}
          className={cn('image-rendering-pixelated', className)}
          style={{ imageRendering: 'pixelated' }}
        />
      );
    }
    return (
      <div
        className={cn('bg-ocean-mid/30', className)}
        style={{ width: displaySize, height: displaySize }}
      />
    );
  }

  // Animated sprite sheet
  return (
    <div
      className={cn('sprite-animate', className)}
      style={{
        width: displaySize,
        height: displaySize,
        backgroundImage: `url(${spriteUrl})`,
        backgroundSize: `${frames * displaySize}px ${displaySize}px`,
        imageRendering: 'pixelated',
        '--sprite-frames': frames,
        '--sprite-width': `${displaySize}px`,
        '--sprite-duration': '1s',
      } as React.CSSProperties}
    />
  );
}
