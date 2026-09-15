'use client';

import { useEffect } from 'react';
import { startArenaMusic, stopArenaMusic } from '@/lib/arena-music';
import type { ArenaTier } from '@/lib/arena-music.generated';

/**
 * Starts the arena bed once the arena is actually on screen — not when the snapshot arrives,
 * which is seconds before Unity has loaded — and fades it out when the battle ends or the
 * view unmounts. `visible` is Unity-ready, or the plain-board fallback being shown.
 */
export function useArenaMusic(tier: ArenaTier | null | undefined, visible: boolean, ended: boolean) {
  useEffect(() => {
    if (!tier || !visible) return;
    startArenaMusic(tier);
    return () => stopArenaMusic();
  }, [tier, visible]);

  useEffect(() => { if (ended) stopArenaMusic(); }, [ended]);
}
