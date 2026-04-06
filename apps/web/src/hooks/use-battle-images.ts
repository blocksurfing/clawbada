'use client';

import { useState, useEffect, useRef } from 'react';
import type { BattleLobsterConfig } from '@/lib/battle-anim/types';
import { ARENA_BACKGROUNDS } from '@/lib/assets';

interface UseBattleImagesReturn {
  images: Map<string, HTMLImageElement>;
  arenaBackground: HTMLImageElement | null;
  loading: boolean;
  progress: number; // 0-1
}

/**
 * Preloads lobster PNGs and an arena background image for battle rendering.
 *
 * For each lobster, fetches from the render API endpoint.
 * For the arena background, loads from ARENA_BACKGROUNDS by tier/scene.
 * Tracks loading progress as a 0-1 fraction.
 */
export function useBattleImages(
  lobsters: BattleLobsterConfig[],
  arenaTier: number,
  arenaScene: number,
): UseBattleImagesReturn {
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(
    () => new Map(),
  );
  const [arenaBackground, setArenaBackground] =
    useState<HTMLImageElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const objectUrlsRef = useRef<string[]>([]);

  // Build a stable key from lobster configs so the effect re-runs only when inputs change
  const lobsterKey = lobsters
    .map((l) => `${l.id}:${l.dna}:${l.tier}`)
    .join('|');

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];

    // Total items = lobsters + 1 arena background
    const total = lobsters.length + 1;
    let loaded = 0;

    const updateProgress = () => {
      if (cancelled) return;
      loaded++;
      setProgress(loaded / total);
    };

    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';

    // Load lobster images
    const lobsterPromises = lobsters.map(
      (lobster) =>
        new Promise<[string, HTMLImageElement]>((resolve) => {
          const url = `${apiBase}/api/game/render/dna/${lobster.dna}?tier=${lobster.tier}&size=128`;

          fetch(url)
            .then((res) => {
              if (!res.ok) throw new Error(`Render failed: ${res.status}`);
              return res.blob();
            })
            .then((blob) => {
              const objUrl = URL.createObjectURL(blob);
              urls.push(objUrl);
              const img = new Image();
              img.onload = () => {
                updateProgress();
                resolve([lobster.id, img]);
              };
              img.onerror = () => {
                updateProgress();
                resolve([lobster.id, img]); // resolve with broken image rather than blocking
              };
              img.src = objUrl;
            })
            .catch(() => {
              // Return a blank image on fetch failure
              updateProgress();
              resolve([lobster.id, new Image()]);
            });
        }),
    );

    // Load arena background
    // arenaTier is 1-indexed (1=Evolved, 2=Elite, 3=Apex), array is 0-indexed
    const tierScenes = ARENA_BACKGROUNDS[arenaTier - 1];
    const bgPath = tierScenes
      ? tierScenes[arenaScene] ?? tierScenes[0]
      : ARENA_BACKGROUNDS[0][0];

    const bgPromise = new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        updateProgress();
        resolve(img);
      };
      img.onerror = () => {
        updateProgress();
        resolve(null); // fall back to gradient if bg image missing
      };
      img.src = bgPath;
    });

    setLoading(true);
    setProgress(0);

    Promise.all([Promise.all(lobsterPromises), bgPromise]).then(
      ([lobsterResults, bg]) => {
        if (cancelled) return;

        const map = new Map<string, HTMLImageElement>();
        for (const [id, img] of lobsterResults) {
          map.set(id, img);
        }

        objectUrlsRef.current = urls;
        setImages(map);
        setArenaBackground(bg);
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
      // Revoke all created object URLs
      for (const u of urls) {
        URL.revokeObjectURL(u);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobsterKey, arenaTier, arenaScene]);

  return { images, arenaBackground, loading, progress };
}
