'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { EMOJI_FALLBACKS } from '@/lib/assets';

interface PixelIconProps {
  /** Path to the pixel art icon (from ICONS constants) */
  src: string;
  /** Alt text for accessibility */
  alt: string;
  /** Size in px (default 32) */
  size?: number;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Renders a pixel art icon with automatic emoji fallback.
 *
 * When the PNG asset hasn't been delivered yet, falls back to the
 * emoji defined in EMOJI_FALLBACKS for that asset path.
 */
export function PixelIcon({ src, alt, size = 32, className }: PixelIconProps) {
  const [failed, setFailed] = useState(false);
  const fallback = EMOJI_FALLBACKS[src];

  if (failed && fallback) {
    return (
      <span
        className={cn('inline-flex items-center justify-center', className)}
        style={{ width: size, height: size, fontSize: size * 0.7, lineHeight: 1 }}
        role="img"
        aria-label={alt}
      >
        {fallback}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={cn('pixel-art', className)}
      onError={() => setFailed(true)}
    />
  );
}
