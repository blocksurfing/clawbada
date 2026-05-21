/**
 * Color pipeline: role-indexed grid → colored RGBA PixelGrid.
 *
 * Steps:
 * 1. Look up class palette by body part's classAffinity
 * 2. Map each role index → RGBA via palette
 * 3. Apply breed type HSL shift
 */

import { NATIVE_SIZE, CHANNELS, NUM_ROLES } from '../constants';
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
    palette.secondaryShadow,
    palette.secondaryBase,
    palette.secondaryHighlight,
    palette.accentShadow,
    palette.accentBase,
    palette.accentHighlight,
    palette.universalOutline,
  ];
}

/**
 * Resolve a role grid to a colored PixelGrid using the given class palette.
 *
 * @param customColors Optional custom color array for roles 7+ (from v2 templates).
 *   Each entry is [R, G, B]. Custom colors are NOT shifted by breed type.
 */
export function resolveColors(
  roleGrid: RoleGrid,
  classAffinity: number,
  breedType: number,
  customColors?: [number, number, number][],
): PixelGrid {
  const palette = getClassPalette(classAffinity);
  const paletteArr = paletteToArray(palette);
  const shift = getBreedTypeShift(breedType);
  const grid = createGrid(NATIVE_SIZE, NATIVE_SIZE);

  for (let y = 0; y < NATIVE_SIZE; y++) {
    for (let x = 0; x < NATIVE_SIZE; x++) {
      const role = roleGrid[y * NATIVE_SIZE + x];
      if (role === 0xFF) continue; // Transparent

      let color: RGBA;

      if (role >= NUM_ROLES && customColors && customColors[role - NUM_ROLES]) {
        // Custom color roles (NUM_ROLES+): use template-defined color, no breed shift
        const cc = customColors[role - NUM_ROLES];
        color = [cc[0], cc[1], cc[2], 255];
      } else {
        color = paletteArr[role] ?? paletteArr[2]; // Fallback to primaryBase

        // Apply breed type shift
        color = shiftHSL(color, shift.hueRotation, shift.saturationMult, shift.lightnessMult);

        // Apply tint if present
        if (shift.tint && shift.tintStrength) {
          color = tintColor(color, shift.tint, shift.tintStrength);
        }
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
