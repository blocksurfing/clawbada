import { describe, test, expect } from 'bun:test';
import {
  createGrid,
  setPixel,
  getPixel,
  blitOver,
  cloneGrid,
  countPixels,
  computeBounds,
  isEdgePixel,
  fillGrid,
  clearGrid,
} from '../src/render/pixel-grid';
import type { RGBA } from '../src/types';

describe('createGrid()', () => {
  test('creates grid with default 48x48 size', () => {
    const grid = createGrid();
    expect(grid.width).toBe(48);
    expect(grid.height).toBe(48);
    expect(grid.data.length).toBe(48 * 48 * 4);
  });

  test('creates grid with custom size', () => {
    const grid = createGrid(8, 8);
    expect(grid.width).toBe(8);
    expect(grid.height).toBe(8);
    expect(grid.data.length).toBe(8 * 8 * 4);
  });

  test('all pixels initialized to zero (transparent)', () => {
    const grid = createGrid(4, 4);
    for (let i = 0; i < grid.data.length; i++) {
      expect(grid.data[i]).toBe(0);
    }
  });
});

describe('setPixel() / getPixel()', () => {
  test('round-trip: set then get returns same color', () => {
    const grid = createGrid(8, 8);
    const color: RGBA = [255, 128, 64, 200];
    setPixel(grid, 3, 5, color);
    expect(getPixel(grid, 3, 5)).toEqual(color);
  });

  test('setPixel out of bounds is a no-op', () => {
    const grid = createGrid(4, 4);
    const before = new Uint8Array(grid.data);
    setPixel(grid, -1, 0, [255, 0, 0, 255]);
    setPixel(grid, 4, 0, [255, 0, 0, 255]);
    setPixel(grid, 0, -1, [255, 0, 0, 255]);
    setPixel(grid, 0, 4, [255, 0, 0, 255]);
    // Data unchanged
    expect(grid.data).toEqual(before);
  });

  test('getPixel out of bounds returns [0,0,0,0]', () => {
    const grid = createGrid(4, 4);
    setPixel(grid, 0, 0, [100, 200, 50, 255]);
    expect(getPixel(grid, -1, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(grid, 4, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(grid, 0, -1)).toEqual([0, 0, 0, 0]);
    expect(getPixel(grid, 0, 4)).toEqual([0, 0, 0, 0]);
  });
});

describe('blitOver()', () => {
  test('fully opaque src replaces dst', () => {
    const dst = createGrid(4, 4);
    const src = createGrid(4, 4);
    setPixel(dst, 1, 1, [100, 100, 100, 255]);
    setPixel(src, 1, 1, [200, 50, 25, 255]);
    blitOver(dst, src);
    expect(getPixel(dst, 1, 1)).toEqual([200, 50, 25, 255]);
  });

  test('transparent src does not affect dst', () => {
    const dst = createGrid(4, 4);
    const src = createGrid(4, 4);
    const original: RGBA = [100, 100, 100, 255];
    setPixel(dst, 1, 1, original);
    // src pixel at (1,1) is all zeros (transparent) by default
    blitOver(dst, src);
    expect(getPixel(dst, 1, 1)).toEqual(original);
  });

  test('semi-transparent blending', () => {
    const dst = createGrid(4, 4);
    const src = createGrid(4, 4);
    // White opaque destination
    setPixel(dst, 0, 0, [255, 255, 255, 255]);
    // Red 50% transparent source
    setPixel(src, 0, 0, [255, 0, 0, 128]);

    blitOver(dst, src);

    const result = getPixel(dst, 0, 0);
    // With standard alpha compositing:
    // sa = 128/255 ~0.502, da = 1.0, outA = 0.502 + 1.0 * (1 - 0.502) = 1.0
    // R = (255 * 0.502 + 255 * 1.0 * 0.498) / 1.0 = 255
    // G = (0 * 0.502 + 255 * 1.0 * 0.498) / 1.0 ~ 127
    // B = same as G ~ 127
    expect(result[3]).toBe(255); // Full alpha
    expect(result[0]).toBe(255); // R stays 255
    // Green and blue should be blended down from 255
    expect(result[1]).toBeGreaterThan(100);
    expect(result[1]).toBeLessThan(160);
    expect(result[2]).toBeGreaterThan(100);
    expect(result[2]).toBeLessThan(160);
  });

  test('blitOver with offset positions correctly', () => {
    const dst = createGrid(8, 8);
    const src = createGrid(4, 4);
    setPixel(src, 0, 0, [255, 0, 0, 255]);
    blitOver(dst, src, 3, 5);
    // src(0,0) should land at dst(3,5)
    expect(getPixel(dst, 3, 5)).toEqual([255, 0, 0, 255]);
    // Original position should be empty
    expect(getPixel(dst, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe('cloneGrid()', () => {
  test('deep copy: modifying clone does not affect original', () => {
    const original = createGrid(4, 4);
    setPixel(original, 1, 1, [10, 20, 30, 255]);

    const clone = cloneGrid(original);
    expect(getPixel(clone, 1, 1)).toEqual([10, 20, 30, 255]);

    // Modify clone
    setPixel(clone, 1, 1, [99, 99, 99, 99]);
    // Original unchanged
    expect(getPixel(original, 1, 1)).toEqual([10, 20, 30, 255]);
    // Clone has new value
    expect(getPixel(clone, 1, 1)).toEqual([99, 99, 99, 99]);
  });

  test('clone has same dimensions', () => {
    const original = createGrid(16, 32);
    const clone = cloneGrid(original);
    expect(clone.width).toBe(16);
    expect(clone.height).toBe(32);
    expect(clone.data.length).toBe(original.data.length);
  });
});

describe('countPixels()', () => {
  test('empty grid has zero non-transparent pixels', () => {
    const grid = createGrid(4, 4);
    expect(countPixels(grid)).toBe(0);
  });

  test('counts only non-transparent pixels', () => {
    const grid = createGrid(4, 4);
    setPixel(grid, 0, 0, [255, 0, 0, 255]);
    setPixel(grid, 1, 0, [0, 255, 0, 128]);
    setPixel(grid, 2, 0, [0, 0, 255, 1]); // Barely opaque still counts
    expect(countPixels(grid)).toBe(3);
  });

  test('pixels with alpha=0 are not counted', () => {
    const grid = createGrid(4, 4);
    setPixel(grid, 0, 0, [255, 255, 255, 0]); // Transparent despite RGB values
    expect(countPixels(grid)).toBe(0);
  });
});

describe('computeBounds()', () => {
  test('returns null for empty grid', () => {
    const grid = createGrid(8, 8);
    expect(computeBounds(grid)).toBeNull();
  });

  test('returns correct bounding box for single pixel', () => {
    const grid = createGrid(8, 8);
    setPixel(grid, 3, 5, [255, 0, 0, 255]);
    expect(computeBounds(grid)).toEqual({ x: 3, y: 5, w: 1, h: 1 });
  });

  test('returns correct bounding box for multiple pixels', () => {
    const grid = createGrid(16, 16);
    setPixel(grid, 2, 3, [255, 0, 0, 255]);
    setPixel(grid, 10, 12, [0, 255, 0, 255]);
    setPixel(grid, 5, 7, [0, 0, 255, 255]);
    expect(computeBounds(grid)).toEqual({ x: 2, y: 3, w: 9, h: 10 });
  });

  test('handles pixels at grid edges', () => {
    const grid = createGrid(4, 4);
    setPixel(grid, 0, 0, [255, 0, 0, 255]);
    setPixel(grid, 3, 3, [0, 255, 0, 255]);
    expect(computeBounds(grid)).toEqual({ x: 0, y: 0, w: 4, h: 4 });
  });
});

describe('isEdgePixel()', () => {
  test('identifies edge pixel with transparent neighbor', () => {
    const grid = createGrid(8, 8);
    // Create a 3x3 filled block at (2,2) to (4,4)
    for (let y = 2; y <= 4; y++) {
      for (let x = 2; x <= 4; x++) {
        setPixel(grid, x, y, [255, 0, 0, 255]);
      }
    }
    // Corner and edge pixels should be edge
    expect(isEdgePixel(grid, 2, 2)).toBe(true); // corner
    expect(isEdgePixel(grid, 3, 2)).toBe(true); // top edge
    expect(isEdgePixel(grid, 4, 4)).toBe(true); // corner
  });

  test('identifies interior pixel (all 4 neighbors opaque)', () => {
    const grid = createGrid(8, 8);
    // Create a 3x3 filled block at (2,2) to (4,4)
    for (let y = 2; y <= 4; y++) {
      for (let x = 2; x <= 4; x++) {
        setPixel(grid, x, y, [255, 0, 0, 255]);
      }
    }
    // Center pixel (3,3) has all 4 neighbors opaque
    expect(isEdgePixel(grid, 3, 3)).toBe(false);
  });

  test('transparent pixel is not an edge pixel', () => {
    const grid = createGrid(4, 4);
    expect(isEdgePixel(grid, 1, 1)).toBe(false);
  });

  test('single isolated pixel is an edge pixel', () => {
    const grid = createGrid(8, 8);
    setPixel(grid, 4, 4, [255, 0, 0, 255]);
    expect(isEdgePixel(grid, 4, 4)).toBe(true);
  });
});

describe('fillGrid()', () => {
  test('fills entire grid with a color', () => {
    const grid = createGrid(4, 4);
    const color: RGBA = [10, 20, 30, 255];
    fillGrid(grid, color);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(getPixel(grid, x, y)).toEqual(color);
      }
    }
  });

  test('fill overwrites existing pixels', () => {
    const grid = createGrid(4, 4);
    setPixel(grid, 0, 0, [255, 0, 0, 255]);
    fillGrid(grid, [0, 0, 255, 128]);
    expect(getPixel(grid, 0, 0)).toEqual([0, 0, 255, 128]);
  });
});

describe('clearGrid()', () => {
  test('clears all pixels to transparent', () => {
    const grid = createGrid(4, 4);
    fillGrid(grid, [255, 128, 64, 200]);
    clearGrid(grid);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(getPixel(grid, x, y)).toEqual([0, 0, 0, 0]);
      }
    }
  });

  test('cleared grid has zero pixel count', () => {
    const grid = createGrid(4, 4);
    fillGrid(grid, [255, 0, 0, 255]);
    expect(countPixels(grid)).toBe(16);
    clearGrid(grid);
    expect(countPixels(grid)).toBe(0);
  });
});
