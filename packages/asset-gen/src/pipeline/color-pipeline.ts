/**
 * Color pipeline: role-indexed grid → colored RGBA PixelGrid.
 *
 * Steps:
 * 1. Look up class palette by body part's classAffinity
 * 2. Map each role index → RGBA via palette
 * 3. Apply breed type HSL shift
 */

import { NATIVE_SIZE, CHANNELS } from '../constants';
import { getClassPalette } from '../palettes/class-palettes';
import { getBreedTypeShift } from '../palettes/breed-type-shifts';
import { shiftHSL, tintColor } from '../palettes/palette-utils';
import type { PixelGrid, RGBA, ResolvedPalette } from '../types';
import type { RoleGrid } from '../variants/mutations';
import { createGrid } from '../render/pixel-grid';

/** Palette roles in order, for indexed access. */
function paletteToArray(palette: ResolvedPalette): RGBA[] {
  return [
    palette.outline,
    palette.primaryShadow,
    palette.primaryBase,
    palette.primaryHighlight,
    palette.secondaryBase,
    palette.secondaryHighlight,
    palette.accent,
  ];
}

/**
 * Resolve a role grid to a colored PixelGrid using the given class palette.
 */
export function resolveColors(
  roleGrid: RoleGrid,
  classAffinity: number,
  breedType: number,
): PixelGrid {
  const palette = getClassPalette(classAffinity);
  const paletteArr = paletteToArray(palette);
  const shift = getBreedTypeShift(breedType);
  const grid = createGrid(NATIVE_SIZE, NATIVE_SIZE);

  for (let y = 0; y < NATIVE_SIZE; y++) {
    for (let x = 0; x < NATIVE_SIZE; x++) {
      const role = roleGrid[y * NATIVE_SIZE + x];
      if (role === 0xFF) continue; // Transparent

      let color = paletteArr[role] ?? paletteArr[2]; // Fallback to primaryBase

      // Apply breed type shift
      color = shiftHSL(color, shift.hueRotation, shift.saturationMult, shift.lightnessMult);

      // Apply tint if present
      if (shift.tint && shift.tintStrength) {
        color = tintColor(color, shift.tint, shift.tintStrength);
      }

      const i = (y * NATIVE_SIZE + x) * CHANNELS;
      grid.data[i] = color[0];
      grid.data[i + 1] = color[1];
      grid.data[i + 2] = color[2];
      grid.data[i + 3] = color[3];
    }
  }

  return grid;
}

/**
 * Apply a palette directly to a role grid without breed type shift.
 * Useful for preview and testing.
 */
export function resolveColorsRaw(roleGrid: RoleGrid, classAffinity: number): PixelGrid {
  const palette = getClassPalette(classAffinity);
  const paletteArr = paletteToArray(palette);
  const grid = createGrid(NATIVE_SIZE, NATIVE_SIZE);

  for (let y = 0; y < NATIVE_SIZE; y++) {
    for (let x = 0; x < NATIVE_SIZE; x++) {
      const role = roleGrid[y * NATIVE_SIZE + x];
      if (role === 0xFF) continue;

      const color = paletteArr[role] ?? paletteArr[2];
      const i = (y * NATIVE_SIZE + x) * CHANNELS;
      grid.data[i] = color[0];
      grid.data[i + 1] = color[1];
      grid.data[i + 2] = color[2];
      grid.data[i + 3] = color[3];
    }
  }

  return grid;
}
