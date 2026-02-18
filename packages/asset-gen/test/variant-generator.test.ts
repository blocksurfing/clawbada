import { describe, test, expect } from 'bun:test';
import {
  templateToRoleGrid,
  roleGridToPixels,
  generateVariantRoleGrid,
} from '../src/variants/generator';
import { createRoleGrid, repairOutlines } from '../src/variants/mutations';
import type { PixelTemplate, TemplatePixel } from '../src/types';
import { PaletteRole } from '../src/types';
import { NATIVE_SIZE } from '../src/constants';

/**
 * Build the test template: a 5x5 filled square at (22,19)-(26,23) on a 48x48 canvas.
 * Edge pixels get role 0 (Outline), interior pixels get role 2 (PrimaryBase).
 */
function buildTestTemplate(): PixelTemplate {
  const pixels: TemplatePixel[] = [];
  for (let y = 19; y <= 23; y++) {
    for (let x = 22; x <= 26; x++) {
      const isEdge =
        x === 22 || x === 26 || y === 19 || y === 23;
      pixels.push({
        x,
        y,
        role: isEdge ? PaletteRole.Outline : PaletteRole.PrimaryBase,
      });
    }
  }

  return {
    bodyPart: 'carapace',
    classAffinity: 0,
    version: 1,
    width: 48,
    height: 48,
    anchor: { x: 24, y: 20 },
    bounds: { x: 20, y: 18, w: 8, h: 5 },
    mutationZones: [
      {
        x: 20,
        y: 18,
        w: 8,
        h: 5,
        allowed: [
          'add_pixels',
          'remove_pixels',
          'shift_pixels',
          'thicken',
          'pattern_fill',
          'detail_overlay',
        ],
      },
    ],
    pixels,
  };
}

const TEST_TEMPLATE = buildTestTemplate();

describe('templateToRoleGrid()', () => {
  test('converts template pixels to role grid correctly', () => {
    const grid = templateToRoleGrid(TEST_TEMPLATE);
    expect(grid.length).toBe(NATIVE_SIZE * NATIVE_SIZE);

    // Verify an outline edge pixel
    expect(grid[19 * NATIVE_SIZE + 22]).toBe(PaletteRole.Outline);

    // Verify an interior pixel
    expect(grid[20 * NATIVE_SIZE + 23]).toBe(PaletteRole.PrimaryBase);

    // Verify a transparent (empty) pixel outside the square
    expect(grid[0 * NATIVE_SIZE + 0]).toBe(0xFF);
  });

  test('non-template pixels are transparent (0xFF)', () => {
    const grid = templateToRoleGrid(TEST_TEMPLATE);
    // Check a pixel far from the filled region
    expect(grid[0]).toBe(0xFF);
    expect(grid[47 * NATIVE_SIZE + 47]).toBe(0xFF);
  });

  test('all template pixels are mapped', () => {
    const grid = templateToRoleGrid(TEST_TEMPLATE);
    let nonTransparentCount = 0;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] !== 0xFF) nonTransparentCount++;
    }
    expect(nonTransparentCount).toBe(TEST_TEMPLATE.pixels.length);
  });
});

describe('roleGridToPixels()', () => {
  test('converts role grid back to sparse pixel array', () => {
    const grid = templateToRoleGrid(TEST_TEMPLATE);
    const pixels = roleGridToPixels(grid);
    expect(pixels.length).toBe(TEST_TEMPLATE.pixels.length);
  });

  test('round-trip preserves pixel positions and roles', () => {
    const grid = templateToRoleGrid(TEST_TEMPLATE);
    const pixels = roleGridToPixels(grid);

    // Sort both arrays for comparison since order might differ
    const sortFn = (a: TemplatePixel, b: TemplatePixel) =>
      a.y * NATIVE_SIZE + a.x - (b.y * NATIVE_SIZE + b.x);

    const original = [...TEST_TEMPLATE.pixels].sort(sortFn);
    const roundTripped = [...pixels].sort(sortFn);

    expect(roundTripped.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(roundTripped[i].x).toBe(original[i].x);
      expect(roundTripped[i].y).toBe(original[i].y);
      expect(roundTripped[i].role).toBe(original[i].role);
    }
  });

  test('empty role grid returns empty pixel array', () => {
    const grid = createRoleGrid();
    const pixels = roleGridToPixels(grid);
    expect(pixels.length).toBe(0);
  });
});

describe('generateVariantRoleGrid()', () => {
  test('variant 0 returns unmodified base', () => {
    const baseGrid = templateToRoleGrid(TEST_TEMPLATE);
    const variant0 = generateVariantRoleGrid(TEST_TEMPLATE, 0);

    expect(variant0.length).toBe(baseGrid.length);
    for (let i = 0; i < baseGrid.length; i++) {
      expect(variant0[i]).toBe(baseGrid[i]);
    }
  });

  test('throws for variant out of range', () => {
    expect(() => generateVariantRoleGrid(TEST_TEMPLATE, -1)).toThrow();
    expect(() => generateVariantRoleGrid(TEST_TEMPLATE, 16)).toThrow();
  });

  test('variant > 0 produces different output than variant 0 (for templates with mutation zones)', () => {
    const variant0 = generateVariantRoleGrid(TEST_TEMPLATE, 0);

    // Try several higher variants; at least one should differ from variant 0
    // (since mutation zones are defined and all mutation types are allowed)
    let foundDifference = false;
    for (let v = 1; v <= 15; v++) {
      const variantN = generateVariantRoleGrid(TEST_TEMPLATE, v);
      let differs = false;
      for (let i = 0; i < variant0.length; i++) {
        if (variant0[i] !== variantN[i]) {
          differs = true;
          break;
        }
      }
      if (differs) {
        foundDifference = true;
        break;
      }
    }
    expect(foundDifference).toBe(true);
  });

  test('determinism: same inputs produce same output across multiple calls', () => {
    const result1 = generateVariantRoleGrid(TEST_TEMPLATE, 5);
    const result2 = generateVariantRoleGrid(TEST_TEMPLATE, 5);

    expect(result1.length).toBe(result2.length);
    for (let i = 0; i < result1.length; i++) {
      expect(result1[i]).toBe(result2[i]);
    }
  });

  test('determinism across all variant numbers', () => {
    for (let v = 0; v <= 15; v++) {
      const a = generateVariantRoleGrid(TEST_TEMPLATE, v);
      const b = generateVariantRoleGrid(TEST_TEMPLATE, v);
      for (let i = 0; i < a.length; i++) {
        expect(a[i]).toBe(b[i]);
      }
    }
  });
});

describe('repairOutlines()', () => {
  test('edge pixels get outline role (0)', () => {
    const grid = createRoleGrid();

    // Create a small 3x3 block where all pixels have role 2 (PrimaryBase)
    for (let y = 10; y <= 12; y++) {
      for (let x = 10; x <= 12; x++) {
        grid[y * NATIVE_SIZE + x] = PaletteRole.PrimaryBase;
      }
    }

    repairOutlines(grid);

    // Edge pixels should now be outline (0)
    // Top row: (10,10), (11,10), (12,10) — all edge
    expect(grid[10 * NATIVE_SIZE + 10]).toBe(PaletteRole.Outline);
    expect(grid[10 * NATIVE_SIZE + 11]).toBe(PaletteRole.Outline);
    expect(grid[10 * NATIVE_SIZE + 12]).toBe(PaletteRole.Outline);

    // Bottom row: (10,12), (11,12), (12,12) — all edge
    expect(grid[12 * NATIVE_SIZE + 10]).toBe(PaletteRole.Outline);
    expect(grid[12 * NATIVE_SIZE + 12]).toBe(PaletteRole.Outline);

    // Side pixels: (10,11), (12,11) — edge
    expect(grid[11 * NATIVE_SIZE + 10]).toBe(PaletteRole.Outline);
    expect(grid[11 * NATIVE_SIZE + 12]).toBe(PaletteRole.Outline);

    // Center pixel (11,11) should remain PrimaryBase (not edge)
    expect(grid[11 * NATIVE_SIZE + 11]).toBe(PaletteRole.PrimaryBase);
  });

  test('does not modify interior pixels', () => {
    const grid = createRoleGrid();

    // Create a 5x5 block with PrimaryHighlight in the interior
    for (let y = 5; y <= 9; y++) {
      for (let x = 5; x <= 9; x++) {
        grid[y * NATIVE_SIZE + x] = PaletteRole.PrimaryHighlight;
      }
    }

    repairOutlines(grid);

    // Interior pixel (7,7) has all 4 neighbors opaque — should keep its role
    expect(grid[7 * NATIVE_SIZE + 7]).toBe(PaletteRole.PrimaryHighlight);
  });

  test('already-outline edge pixels remain outline', () => {
    const grid = createRoleGrid();

    // Single pixel — it is its own edge
    grid[20 * NATIVE_SIZE + 20] = PaletteRole.Outline;

    repairOutlines(grid);

    expect(grid[20 * NATIVE_SIZE + 20]).toBe(PaletteRole.Outline);
  });
});
