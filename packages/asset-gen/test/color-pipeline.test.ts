import { describe, test, expect } from 'bun:test';
import { resolveColors, resolveColorsRaw } from '../src/pipeline/color-pipeline';
import { createRoleGrid } from '../src/variants/mutations';
import { getClassPalette } from '../src/palettes/class-palettes';
import { PaletteRole } from '../src/types';
import { NATIVE_SIZE, CHANNELS } from '../src/constants';
import { getPixel } from '../src/render/pixel-grid';
import { BREED_TYPE_SHIFTS } from '../src/palettes/breed-type-shifts';

/**
 * Helper: create a role grid with a single pixel at (x, y) with the given role.
 */
function singlePixelRoleGrid(x: number, y: number, role: number): Uint8Array {
  const grid = createRoleGrid();
  grid[y * NATIVE_SIZE + x] = role;
  return grid;
}

/**
 * Helper: create a role grid with a small block of pixels.
 */
function blockRoleGrid(
  startX: number,
  startY: number,
  w: number,
  h: number,
  role: number,
): Uint8Array {
  const grid = createRoleGrid();
  for (let y = startY; y < startY + h; y++) {
    for (let x = startX; x < startX + w; x++) {
      grid[y * NATIVE_SIZE + x] = role;
    }
  }
  return grid;
}

describe('resolveColorsRaw()', () => {
  test('maps role indices to correct RGBA values from class palette', () => {
    const classAffinity = 0; // Bulwark
    const palette = getClassPalette(classAffinity);

    // Test each role index maps to the correct palette color
    const roleColors: [number, [number, number, number, number]][] = [
      [PaletteRole.Outline, palette.outline],
      [PaletteRole.PrimaryShadow, palette.primaryShadow],
      [PaletteRole.PrimaryBase, palette.primaryBase],
      [PaletteRole.PrimaryHighlight, palette.primaryHighlight],
      [PaletteRole.SecondaryShadow, palette.secondaryShadow],
      [PaletteRole.SecondaryBase, palette.secondaryBase],
      [PaletteRole.SecondaryHighlight, palette.secondaryHighlight],
      [PaletteRole.AccentShadow, palette.accentShadow],
      [PaletteRole.AccentBase, palette.accentBase],
      [PaletteRole.AccentHighlight, palette.accentHighlight],
    ];

    for (const [role, expectedColor] of roleColors) {
      const roleGrid = singlePixelRoleGrid(10, 10, role);
      const result = resolveColorsRaw(roleGrid, classAffinity);
      const pixel = getPixel(result, 10, 10);

      expect(pixel[0]).toBe(expectedColor[0]);
      expect(pixel[1]).toBe(expectedColor[1]);
      expect(pixel[2]).toBe(expectedColor[2]);
      expect(pixel[3]).toBe(expectedColor[3]);
    }
  });

  test('transparent pixels remain transparent', () => {
    const grid = createRoleGrid(); // All 0xFF = transparent
    const result = resolveColorsRaw(grid, 0);

    // Check several pixels — all should be [0,0,0,0]
    expect(getPixel(result, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(result, 24, 24)).toEqual([0, 0, 0, 0]);
    expect(getPixel(result, 47, 47)).toEqual([0, 0, 0, 0]);
  });

  test('works with different class affinities', () => {
    const role = PaletteRole.PrimaryBase;

    // Class 0 (Bulwark) and class 9 (Ember) should produce different colors
    const grid = singlePixelRoleGrid(5, 5, role);
    const resultBulwark = resolveColorsRaw(grid, 0);
    const resultEmber = resolveColorsRaw(grid, 9);

    const pixBulwark = getPixel(resultBulwark, 5, 5);
    const pixEmber = getPixel(resultEmber, 5, 5);

    // At least one channel should differ
    const differs =
      pixBulwark[0] !== pixEmber[0] ||
      pixBulwark[1] !== pixEmber[1] ||
      pixBulwark[2] !== pixEmber[2];
    expect(differs).toBe(true);
  });
});

describe('resolveColors()', () => {
  test('breed type 0 (identity) produces same result as resolveColorsRaw', () => {
    const classAffinity = 0;
    const roleGrid = blockRoleGrid(10, 10, 3, 3, PaletteRole.PrimaryBase);

    const rawResult = resolveColorsRaw(roleGrid, classAffinity);
    const colorResult = resolveColors(roleGrid, classAffinity, 0); // breed type 0 = identity

    // Every pixel should match
    for (let y = 10; y < 13; y++) {
      for (let x = 10; x < 13; x++) {
        const rawPix = getPixel(rawResult, x, y);
        const colorPix = getPixel(colorResult, x, y);
        expect(colorPix).toEqual(rawPix);
      }
    }
  });

  test('different breed types produce different colors', () => {
    const classAffinity = 0;
    const roleGrid = singlePixelRoleGrid(15, 15, PaletteRole.PrimaryBase);

    const result0 = resolveColors(roleGrid, classAffinity, 0);
    const result1 = resolveColors(roleGrid, classAffinity, 1); // Warm shift

    const pix0 = getPixel(result0, 15, 15);
    const pix1 = getPixel(result1, 15, 15);

    // Breed type 1 has hue rotation of +10, so colors should differ
    const differs =
      pix0[0] !== pix1[0] || pix0[1] !== pix1[1] || pix0[2] !== pix1[2];
    expect(differs).toBe(true);
  });

  test('transparent pixels remain transparent regardless of breed type', () => {
    const grid = createRoleGrid(); // All transparent
    const result = resolveColors(grid, 0, 5); // breed type 5 (Sandy) with tint

    expect(getPixel(result, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(result, 24, 24)).toEqual([0, 0, 0, 0]);
  });

  test('breed types with tint apply tint to non-transparent pixels', () => {
    const classAffinity = 0;
    const roleGrid = singlePixelRoleGrid(20, 20, PaletteRole.PrimaryBase);

    // Breed type 5 (Sandy) has tint [255, 200, 150, 255] with strength 0.08
    const resultNoTint = resolveColors(roleGrid, classAffinity, 0);
    const resultTinted = resolveColors(roleGrid, classAffinity, 5);

    const pixNoTint = getPixel(resultNoTint, 20, 20);
    const pixTinted = getPixel(resultTinted, 20, 20);

    // Both should be opaque
    expect(pixNoTint[3]).toBe(255);
    expect(pixTinted[3]).toBe(255);

    // Tinted result should differ from non-tinted
    const differs =
      pixNoTint[0] !== pixTinted[0] ||
      pixNoTint[1] !== pixTinted[1] ||
      pixNoTint[2] !== pixTinted[2];
    expect(differs).toBe(true);
  });

  test('breed types shift tone but never rotate hue (class palettes are identity)', () => {
    // 2026-03 palette overhaul: a lobster's hue IS its class. Breed types may only move
    // saturation / lightness / a light tint, so no entry in the table rotates hue.
    for (const [i, entry] of BREED_TYPE_SHIFTS.entries()) {
      expect(entry.hueRotation, `breed type ${i} must not rotate hue`).toBe(0);
    }

    const classAffinity = 3; // Tempest
    const roleGrid = singlePixelRoleGrid(5, 5, PaletteRole.PrimaryBase);
    const pixBase = getPixel(resolveColors(roleGrid, classAffinity, 0), 5, 5);
    const diff = (breedType: number) => {
      const p = getPixel(resolveColors(roleGrid, classAffinity, breedType), 5, 5);
      return Math.abs(pixBase[0] - p[0]) + Math.abs(pixBase[1] - p[1]) + Math.abs(pixBase[2] - p[2]);
    };

    // The strongest tone shifts are still clearly visible on the class base color
    // (measured 32-35 on Tempest's 60,80,90): 15 Sunbleached (tint), 37 Ghost fade (sat 0.55).
    expect(diff(15)).toBeGreaterThan(20);
    expect(diff(37)).toBeGreaterThan(20);
    // Reserved breed types (48-63) are identity transforms.
    expect(diff(48)).toBe(0);
    expect(diff(63)).toBe(0);
  });
});
