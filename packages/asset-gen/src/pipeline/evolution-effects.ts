/**
 * Evolution tier post-processing effects.
 *
 * Applied after all 6 layers are composited:
 *   Base:    95% scale, no effects
 *   Evolved: +15% saturation, 1px class-color glow outline
 *   Elite:   +30% saturation, 2px glow, 8-12 particle pixels
 *   Apex:    +30% saturation, 2-3px glow, 16-20 particles, energy trails
 */

import { NATIVE_SIZE, CHANNELS } from '../constants';
import { getClassPalette } from '../palettes/class-palettes';
import { saturate, lighten, lerpColor } from '../palettes/palette-utils';
import { randInt, subSeed } from '../utils/deterministic-rng';
import { keccak256Packed } from '@clawbada/game-logic';
import type { PixelGrid, RGBA } from '../types';
import {
  createGrid,
  cloneGrid,
  getPixel,
  setPixel,
  getAlpha,
  isOpaque,
  mapPixels,
  blitOver,
} from '../render/pixel-grid';

/**
 * Apply evolution tier effects to a composited lobster.
 *
 * @param grid The composited lobster image
 * @param tier Evolution tier (0=Base, 1=Evolved, 2=Elite, 3=Apex)
 * @param classId Lobster class (for glow color)
 * @param seed Deterministic seed (from DNA) for particle placement
 */
export function applyEvolutionEffects(
  grid: PixelGrid,
  tier: number,
  classId: number,
  seed: bigint,
): PixelGrid {
  if (tier === 0) {
    return applyBaseEffects(grid);
  }

  const result = cloneGrid(grid);

  // Saturation boost
  const satBoost = tier >= 2 ? 1.3 : 1.15;
  mapPixels(result, (color) => saturate(color, satBoost));

  // Glow outline
  const glowRadius = tier === 1 ? 1 : tier === 2 ? 2 : 3;
  const palette = getClassPalette(classId);
  const glowColor: RGBA = [...palette.primaryBase] as RGBA;
  glowColor[3] = tier === 1 ? 100 : tier === 2 ? 130 : 160;
  applyGlow(result, glowColor, glowRadius);

  // Particles (Elite and Apex only)
  if (tier >= 2) {
    const particleCount = tier === 2
      ? randInt(seed, 'particle_count', 8, 12)
      : randInt(seed, 'particle_count', 16, 20);
    const particleColor = lighten(palette.primaryBase, 0.3);
    particleColor[3] = tier === 2 ? 180 : 220;
    addParticles(result, particleColor, particleCount, seed);
  }

  // Energy trails (Apex only)
  if (tier === 3) {
    const trailColor: RGBA = [...palette.accent] as RGBA;
    trailColor[3] = 140;
    addEnergyTrails(result, trailColor, seed);
  }

  return result;
}

/** Base tier: slightly smaller (95% visual feel via subtle outline thinning). */
function applyBaseEffects(grid: PixelGrid): PixelGrid {
  // For Base tier, return as-is (the 95% scale is achieved by the templates
  // being designed at natural size — no post-processing needed).
  return cloneGrid(grid);
}

/**
 * Add a glow outline around all opaque pixels.
 * Glow pixels are placed in transparent areas adjacent to the silhouette.
 */
function applyGlow(grid: PixelGrid, color: RGBA, radius: number): void {
  // Collect positions that need glow
  const glowPositions: { x: number; y: number; dist: number }[] = [];

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (isOpaque(grid, x, y)) continue; // Skip existing pixels

      // Check distance to nearest opaque pixel
      let minDist = radius + 1;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const dist = Math.abs(dx) + Math.abs(dy); // Manhattan distance
          if (dist <= radius && dist < minDist && isOpaque(grid, x + dx, y + dy)) {
            minDist = dist;
          }
        }
      }

      if (minDist <= radius) {
        glowPositions.push({ x, y, dist: minDist });
      }
    }
  }

  // Apply glow with distance-based alpha falloff
  for (const pos of glowPositions) {
    const alpha = Math.round(color[3] * (1 - (pos.dist - 1) / radius));
    if (alpha > 0) {
      setPixel(grid, pos.x, pos.y, [color[0], color[1], color[2], alpha]);
    }
  }
}

/**
 * Add decorative particle pixels around the lobster.
 */
function addParticles(grid: PixelGrid, color: RGBA, count: number, seed: bigint): void {
  for (let i = 0; i < count; i++) {
    const s = subSeed(seed, `particle_${i}`);
    const x = randInt(s, 'x', 2, NATIVE_SIZE - 3);
    const y = randInt(s, 'y', 2, NATIVE_SIZE - 3);

    // Only place in transparent areas near the lobster
    if (isOpaque(grid, x, y)) continue;

    // Check if within 4px of an opaque pixel
    let nearLobster = false;
    for (let dy = -4; dy <= 4 && !nearLobster; dy++) {
      for (let dx = -4; dx <= 4 && !nearLobster; dx++) {
        if (isOpaque(grid, x + dx, y + dy)) nearLobster = true;
      }
    }

    if (nearLobster) {
      const alpha = randInt(s, 'alpha', 100, color[3]);
      setPixel(grid, x, y, [color[0], color[1], color[2], alpha]);
    }
  }
}

/**
 * Add energy trail lines emanating from the lobster (Apex only).
 * Short 2-4px lines extending outward from random edge points.
 */
function addEnergyTrails(grid: PixelGrid, color: RGBA, seed: bigint): void {
  const trailCount = randInt(seed, 'trail_count', 3, 5);

  // Find edge pixels of the lobster
  const edges: [number, number][] = [];
  for (let y = 0; y < NATIVE_SIZE; y++) {
    for (let x = 0; x < NATIVE_SIZE; x++) {
      if (!isOpaque(grid, x, y)) continue;
      if (
        !isOpaque(grid, x - 1, y) ||
        !isOpaque(grid, x + 1, y) ||
        !isOpaque(grid, x, y - 1) ||
        !isOpaque(grid, x, y + 1)
      ) {
        edges.push([x, y]);
      }
    }
  }

  if (edges.length === 0) return;

  for (let t = 0; t < trailCount; t++) {
    const ts = subSeed(seed, `trail_${t}`);
    const edgeIdx = randInt(ts, 'edge', 0, edges.length - 1);
    const [ex, ey] = edges[edgeIdx];
    const length = randInt(ts, 'len', 2, 4);
    const dx = randInt(ts, 'dx', -1, 1);
    const dy = randInt(ts, 'dy', -1, 1);

    if (dx === 0 && dy === 0) continue;

    for (let step = 1; step <= length; step++) {
      const px = ex + dx * step;
      const py = ey + dy * step;
      if (px < 0 || px >= NATIVE_SIZE || py < 0 || py >= NATIVE_SIZE) break;
      if (isOpaque(grid, px, py)) break;

      const alpha = Math.round(color[3] * (1 - step / (length + 1)));
      setPixel(grid, px, py, [color[0], color[1], color[2], alpha]);
    }
  }
}
