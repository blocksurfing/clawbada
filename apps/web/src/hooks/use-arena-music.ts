'use client';

import { useEffect } from 'react';
import { startArenaMusic, stopArenaMusic } from '@/lib/arena-music';
import type { ArenaTier } from '@/lib/arena-music.generated';

/** Starts the arena bed once the tier is known, fades it out when the battle ends or the view unmounts. */
export function useArenaMusic(tier: ArenaTier | null | undefined, ended: boolean) {
  useEffect(() => {
    if (!tier) return;
    startArenaMusic(tier);
    return () => stopArenaMusic();
  }, [tier]);

  useEffect(() => { if (ended) stopArenaMusic(); }, [ended]);
}
