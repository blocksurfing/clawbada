import type { ArenaGradientStop } from './types';

/** Gradient fallback backgrounds per tier (used when background image isn't loaded). */
export const ARENA_BG_GRADIENTS: Record<number, ArenaGradientStop[]> = {
  // Evolved: coral reef
  1: [
    { stop: 0, color: '#0e4a5a' },
    { stop: 0.3, color: '#1a6a6a' },
    { stop: 0.6, color: '#2a7a6a' },
    { stop: 1, color: '#e07060' },
  ],
  // Elite: deep bioluminescent
  2: [
    { stop: 0, color: '#050a20' },
    { stop: 0.3, color: '#0a1840' },
    { stop: 0.7, color: '#102850' },
    { stop: 1, color: '#1a3060' },
  ],
  // Apex: volcanic caldera
  3: [
    { stop: 0, color: '#0a0505' },
    { stop: 0.3, color: '#1a0a05' },
    { stop: 0.6, color: '#2a1505' },
    { stop: 1, color: '#4a2010' },
  ],
};
