'use client';

import { useState, useEffect, useRef } from 'react';

interface UseLobsterSpriteSheetResult {
  spriteUrl: string | null;
  loading: boolean;
  error: string | null;
  frames: number;
  frameSize: number;
}

/**
 * Fetches an idle animation sprite sheet PNG from the API.
 * Returns an object URL for use as a CSS background-image.
 */
export function useLobsterSpriteSheet(
  dna: string | bigint | undefined,
  evolutionTier = 0,
  frameSize = 160,
  frames = 16,
): UseLobsterSpriteSheetResult {
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const dnaStr = dna !== undefined ? String(dna) : undefined;

  useEffect(() => {
    if (!dnaStr) {
      setSpriteUrl(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const controller = new AbortController();

    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    const url = `${apiBase}/api/game/render/sprite/dna/${dnaStr}?tier=${evolutionTier}&size=${frameSize}&frames=${frames}`;

    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Sprite sheet fetch failed: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
        }
        const objUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objUrl;
        setSpriteUrl(objUrl);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message);
        setLoading(false);
      });

    return () => {
      controller.abort();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [dnaStr, evolutionTier, frameSize, frames]);

  if (!dna) return { spriteUrl: null, loading: false, error: null, frames, frameSize };

  return { spriteUrl, loading, error, frames, frameSize };
}
