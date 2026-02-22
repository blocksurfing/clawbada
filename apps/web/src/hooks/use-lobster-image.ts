'use client';

import { useState, useEffect, useRef } from 'react';
import { CLASS_NAMES_LIST } from '@clawbada/game-logic';

const CLASS_COLORS = [
  '#64748b', // 0 Bulwark  — slate
  '#22c55e', // 1 Mantis   — green
  '#3b82f6', // 2 Leviathan — blue
  '#8b5cf6', // 3 Tempest  — violet
  '#6366f1', // 4 Specter  — indigo
  '#f59e0b', // 5 Sentinel — amber
  '#ef4444', // 6 Reaver   — red
  '#1e293b', // 7 Abyss    — dark slate
  '#06b6d4', // 8 Kraken   — cyan
  '#f97316', // 9 Ember    — orange
] as const;

const TIER_GLYPHS = ['', '\u2605', '\u2605\u2605', '\u2605\u2605\u2605'] as const;

function extractClass(dna: string | bigint): number {
  const n = typeof dna === 'string' ? BigInt(dna) : dna;
  return Number((n >> 252n) & 0xFn);
}

/** Generate a placeholder SVG data-URL (used as fallback while loading or on error). */
function makePlaceholder(dna: string | bigint, evolutionTier: number): string {
  const cls = extractClass(dna);
  const color = CLASS_COLORS[cls] ?? '#6B7280';
  const name = CLASS_NAMES_LIST[cls] ?? '?';
  const tier = TIER_GLYPHS[evolutionTier] ?? '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <rect width="96" height="96" fill="${color}" rx="8"/>
  <text x="48" y="44" text-anchor="middle" fill="white" font-size="32">&#x1F99E;</text>
  <text x="48" y="66" text-anchor="middle" fill="white" font-size="11" font-family="system-ui,sans-serif" font-weight="600">${name}</text>
  ${tier ? `<text x="48" y="84" text-anchor="middle" fill="#fbbf24" font-size="12" font-family="system-ui,sans-serif">${tier}</text>` : ''}
</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Map scale multiplier to actual pixel sizes. */
const SCALE_TO_SIZE: Record<number, number> = { 1: 64, 2: 128, 4: 256, 8: 512 };

interface UseLobsterImageResult {
  dataUrl: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches a rendered lobster PNG from the API.
 * Falls back to an SVG placeholder while loading or on error.
 */
export function useLobsterImage(
  dna: string | bigint | undefined,
  evolutionTier = 0,
  scale = 4,
): UseLobsterImageResult {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Stable key for memoization
  const dnaStr = dna !== undefined ? String(dna) : undefined;
  const size = SCALE_TO_SIZE[scale] ?? 256;

  useEffect(() => {
    if (!dnaStr) {
      setDataUrl(null);
      setLoading(false);
      setError(null);
      return;
    }

    // Show placeholder immediately while loading
    setDataUrl(makePlaceholder(dnaStr, evolutionTier));
    setLoading(true);
    setError(null);

    const controller = new AbortController();

    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    const url = `${apiBase}/api/game/render/dna/${dnaStr}?tier=${evolutionTier}&size=${size}`;

    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Render failed: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        // Clean up previous object URL
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
        }
        const objUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objUrl;
        setDataUrl(objUrl);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message);
        setLoading(false);
        // Keep the placeholder visible on error
      });

    return () => {
      controller.abort();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [dnaStr, evolutionTier, size]);

  if (!dna) return { dataUrl: null, loading: false, error: null };

  return { dataUrl, loading, error };
}
