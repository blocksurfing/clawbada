/**
 * Legend post-processing effects (10 class-specific treatments).
 *
 * Applied after evolution effects for lobsters with LegendStatus.Legend.
 * Each class gets a unique visual treatment at the pixel level.
 */

import { NATIVE_SIZE, CHANNELS } from '../constants';
import { getClassPalette } from '../palettes/class-palettes';
import {
  lighten,
  darken,
  saturate,
  lerpColor,
  clamp255,
  hexToRGBA,
} from '../palettes/palette-utils';
import { randInt, subSeed, randBool } from '../utils/deterministic-rng';
import type { PixelGrid, RGBA } from '../types';
import {
  cloneGrid,
  getPixel,
  setPixel,
  isOpaque,
  mapPixels,
  isEdgePixel,
} from '../render/pixel-grid';

/**
 * Apply legend effects to a composited, evolution-processed lobster.
 *
 * @param grid The lobster image (after evolution effects)
 * @param classId Lobster class (0-9)
 * @param seed Deterministic seed from DNA
 * @returns New grid with legend treatment applied
 */
export function applyLegendEffects(
  grid: PixelGrid,
  classId: number,
  seed: bigint,
): PixelGrid {
  switch (classId) {
    case 0: return bulwarkLegend(grid, seed);   // Crystalline overlay + rune pixels
    case 1: return mantisLegend(grid, seed);    // Star-field pattern replace
    case 2: return leviathanLegend(grid, seed); // Deep ocean shimmer
    case 3: return tempestLegend(grid, seed);   // Lightning crackle
    case 4: return specterLegend(grid, seed);   // Ethereal fade / ghosting
    case 5: return sentinelLegend(grid, seed);  // Golden radiance
    case 6: return reaverLegend(grid, seed);    // Blood splatter accent
    case 7: return abyssLegend(grid, seed);     // Void corruption
    case 8: return krakenLegend(grid, seed);    // Ink tendrils
    case 9: return emberLegend(grid, seed);     // Molten crack lines + white-hot
    default: return cloneGrid(grid);
  }
}

/** Bulwark: crystalline overlay — some interior pixels get brightened, angular pattern. */
function bulwarkLegend(grid: PixelGrid, seed: bigint): PixelGrid {
  const result = cloneGrid(grid);
  const runeColor: RGBA = [220, 230, 255, 200];

  mapPixels(result, (color, x, y) => {
    // Crystalline facet pattern: diagonal lines
    if ((x + y) % 5 === 0 && !isEdgePixel(result, x, y)) {
      return lerpColor(color, runeColor, 0.3);
    }
    // Subtle brighten across all pixels
    return lighten(color, 0.05);
  });

  // Add rune accent pixels at seeded positions
  addAccentPixels(result, runeColor, 6, seed);
  return result;
}

/** Mantis: star-field — some interior pixels replaced with bright dots. */
function mantisLegend(grid: PixelGrid, seed: bigint): PixelGrid {
  const result = cloneGrid(grid);
  const starColors: RGBA[] = [
    [255, 255, 200, 255],
    [200, 255, 200, 230],
    [255, 255, 255, 255],
  ];

  for (let i = 0; i < 12; i++) {
    const s = subSeed(seed, `star_${i}`);
    const x = randInt(s, 'x', 4, NATIVE_SIZE - 5);
    const y = randInt(s, 'y', 4, NATIVE_SIZE - 5);

    if (isOpaque(result, x, y) && !isEdgePixel(result, x, y)) {
      const color = starColors[i % starColors.length];
      setPixel(result, x, y, color);
    }
  }

  // Subtle green tint boost
  mapPixels(result, (color) => saturate(color, 1.1));
  return result;
}

/** Leviathan: deep ocean shimmer — horizontal gradient overlay. */
function leviathanLegend(grid: PixelGrid, seed: bigint): PixelGrid {
  const result = cloneGrid(grid);
  const shimmerColor: RGBA = [100, 150, 255, 160];

  mapPixels(result, (color, x, y) => {
    // Wave-like shimmer based on y position
    const wave = Math.sin((y / NATIVE_SIZE) * Math.PI * 3) * 0.15;
    if (wave > 0) {
      return lerpColor(color, shimmerColor, wave);
    }
    return color;
  });

  return result;
}

/** Tempest: lightning crackle — bright zigzag lines through the body. */
function tempestLegend(grid: PixelGrid, seed: bigint): PixelGrid {
  const result = cloneGrid(grid);
  const lightningColor: RGBA = [200, 240, 255, 240];

  // Draw 2-3 lightning paths
  const pathCount = randInt(seed, 'paths', 2, 3);
  for (let p = 0; p < pathCount; p++) {
    const ps = subSeed(seed, `lightning_${p}`);
    let x = randInt(ps, 'startx', 10, NATIVE_SIZE - 10);
    let y = randInt(ps, 'starty', 5, 10);

    for (let step = 0; step < 15; step++) {
      if (isOpaque(result, x, y)) {
        setPixel(result, x, y, lightningColor);
      }
      x += randInt(ps, `dx_${step}`, -1, 1);
      y += 2;
      if (y >= NATIVE_SIZE) break;
    }
  }

  return result;
}

/** Specter: ethereal fade — edges become semi-transparent. */
function specterLegend(grid: PixelGrid, seed: bigint): PixelGrid {
  const result = cloneGrid(grid);

  mapPixels(result, (color, x, y) => {
    if (isEdgePixel(result, x, y)) {
      return [color[0], color[1], color[2], Math.round(color[3] * 0.5)];
    }
    // Slight purple tint
    return lerpColor(color, [160, 120, 255, color[3]], 0.08);
  });

  return result;
}

/** Sentinel: golden radiance — warm brightening + golden edge highlight. */
function sentinelLegend(grid: PixelGrid, seed: bigint): PixelGrid {
  const result = cloneGrid(grid);
  const goldHighlight: RGBA = [255, 220, 100, 200];

  mapPixels(result, (color, x, y) => {
    const brightened = lighten(color, 0.08);
    if (isEdgePixel(result, x, y)) {
      return lerpColor(brightened, goldHighlight, 0.4);
    }
    return brightened;
  });

  return result;
}

/** Reaver: blood splatter — red accent dots scattered on interior. */
function reaverLegend(grid: PixelGrid, seed: bigint): PixelGrid {
  const result = cloneGrid(grid);
  const bloodColor: RGBA = [180, 20, 20, 230];

  for (let i = 0; i < 10; i++) {
    const s = subSeed(seed, `blood_${i}`);
    const x = randInt(s, 'x', 4, NATIVE_SIZE - 5);
    const y = randInt(s, 'y', 4, NATIVE_SIZE - 5);

    if (isOpaque(result, x, y) && !isEdgePixel(result, x, y)) {
      setPixel(result, x, y, bloodColor);
      // Small splat: try to color one neighbor too
      if (isOpaque(result, x + 1, y) && !isEdgePixel(result, x + 1, y)) {
        setPixel(result, x + 1, y, [bloodColor[0], bloodColor[1], bloodColor[2], 180]);
      }
    }
  }

  return result;
}

/** Abyss: void corruption — dark tendrils eating into the body. */
function abyssLegend(grid: PixelGrid, seed: bigint): PixelGrid {
  const result = cloneGrid(grid);
  const voidColor: RGBA = [5, 5, 5, 255];
  const glowGreen: RGBA = [57, 255, 20, 200];

  // Darken overall
  mapPixels(result, (color) => darken(color, 0.1));

  // Void corruption spots
  for (let i = 0; i < 8; i++) {
    const s = subSeed(seed, `void_${i}`);
    const x = randInt(s, 'x', 6, NATIVE_SIZE - 7);
    const y = randInt(s, 'y', 6, NATIVE_SIZE - 7);

    if (isOpaque(result, x, y) && !isEdgePixel(result, x, y)) {
      setPixel(result, x, y, voidColor);
    }
  }

  // Green bio-luminescent highlights
  addAccentPixels(result, glowGreen, 5, seed);
  return result;
}

/** Kraken: ink tendrils — dark streaks radiating outward. */
function krakenLegend(grid: PixelGrid, seed: bigint): PixelGrid {
  const result = cloneGrid(grid);
  const inkColor: RGBA = [10, 10, 30, 220];

  const tendrilCount = randInt(seed, 'tendrils', 3, 5);
  for (let t = 0; t < tendrilCount; t++) {
    const ts = subSeed(seed, `ink_${t}`);
    let x = randInt(ts, 'sx', 15, NATIVE_SIZE - 15);
    let y = randInt(ts, 'sy', 15, NATIVE_SIZE - 15);

    for (let step = 0; step < 6; step++) {
      if (isOpaque(result, x, y) && !isEdgePixel(result, x, y)) {
        setPixel(result, x, y, inkColor);
      }
      x += randInt(ts, `dx_${step}`, -1, 1);
      y += randInt(ts, `dy_${step}`, 0, 1);
      if (y >= NATIVE_SIZE) break;
    }
  }

  return result;
}

/** Ember: molten crack lines + white-hot interior highlights. */
function emberLegend(grid: PixelGrid, seed: bigint): PixelGrid {
  const result = cloneGrid(grid);
  const crackColor: RGBA = [255, 100, 0, 240];
  const whiteHot: RGBA = [255, 255, 220, 250];

  // Molten cracks: bright lines through interior
  const crackCount = randInt(seed, 'cracks', 3, 5);
  for (let c = 0; c < crackCount; c++) {
    const cs = subSeed(seed, `crack_${c}`);
    let x = randInt(cs, 'sx', 10, NATIVE_SIZE - 10);
    let y = randInt(cs, 'sy', 8, 15);

    for (let step = 0; step < 10; step++) {
      if (isOpaque(result, x, y) && !isEdgePixel(result, x, y)) {
        setPixel(result, x, y, crackColor);
      }
      x += randInt(cs, `dx_${step}`, -1, 1);
      y += 1;
      if (y >= NATIVE_SIZE - 2) break;
    }
  }

  // White-hot interior highlights
  addAccentPixels(result, whiteHot, 4, seed);

  // Overall warm boost
  mapPixels(result, (color) => saturate(color, 1.15));
  return result;
}

/** Helper: add seeded accent pixels to interior of the lobster. */
function addAccentPixels(grid: PixelGrid, color: RGBA, count: number, seed: bigint): void {
  for (let i = 0; i < count; i++) {
    const s = subSeed(seed, `accent_${i}`);
    const x = randInt(s, 'x', 5, NATIVE_SIZE - 6);
    const y = randInt(s, 'y', 5, NATIVE_SIZE - 6);

    if (isOpaque(grid, x, y) && !isEdgePixel(grid, x, y)) {
      setPixel(grid, x, y, color);
    }
  }
}
