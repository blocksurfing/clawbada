'use client';

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

interface UseLobsterImageResult {
  dataUrl: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * Returns a placeholder SVG data-URL for a lobster based on its DNA.
 * TODO: Replace with server-rendered pixel art via API route.
 */
export function useLobsterImage(
  dna: string | bigint | undefined,
  evolutionTier = 0,
  _scale = 4,
): UseLobsterImageResult {
  if (!dna) return { dataUrl: null, loading: false, error: null };

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

  const dataUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  return { dataUrl, loading: false, error: null };
}
