import { describe, test, expect } from 'bun:test';
import { compositeLayerArray } from '../src/pipeline/compositor';
import { createGrid, setPixel, getPixel } from '../src/render/pixel-grid';
import { LAYER_ORDER, NATIVE_SIZE, NUM_BODY_PARTS } from '../src/constants';
import type { PixelGrid } from '../src/types';

/**
 * Helper: create a small 4x4 grid embedded in a 48x48 canvas
 * with a single colored pixel at (px, py).
 */
function layerWithPixel(
  px: number,
  py: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): PixelGrid {
  const grid = createGrid(NATIVE_SIZE, NATIVE_SIZE);
  setPixel(grid, px, py, [r, g, b, a]);
  return grid;
}

describe('compositeLayerArray()', () => {
  test('composites layers in LAYER_ORDER (back to front)', () => {
    // LAYER_ORDER = [0, 5, 2, 4, 3, 1]
    // Carapace(0) -> Legs(5) -> Tail(2) -> Eyes(4) -> Antennae(3) -> Claws(1)
    //
    // Place different opaque colors at the same pixel for body parts 0 and 1.
    // Since Claws (1) is rendered LAST (front), it should win at that pixel.
    const layers: (PixelGrid | null)[] = new Array(NUM_BODY_PARTS).fill(null);

    // Carapace (index 0) — rendered first in layer order
    layers[0] = layerWithPixel(10, 10, 255, 0, 0); // Red

    // Claws (index 1) — rendered last in layer order
    layers[1] = layerWithPixel(10, 10, 0, 0, 255); // Blue

    const result = compositeLayerArray(layers);

    // Claws layer (rendered last) should overwrite carapace at same pixel
    expect(getPixel(result, 10, 10)).toEqual([0, 0, 255, 255]);
  });

  test('carapace rendered before claws (back-to-front order)', () => {
    // Verify that Carapace (0) is behind Claws (1) in rendering order
    const carapaceOrderIdx = LAYER_ORDER.indexOf(0);
    const clawsOrderIdx = LAYER_ORDER.indexOf(1);
    expect(carapaceOrderIdx).toBeLessThan(clawsOrderIdx);

    // When both layers have an opaque pixel at the same position,
    // the later layer in LAYER_ORDER should prevail
    const layers: (PixelGrid | null)[] = new Array(NUM_BODY_PARTS).fill(null);
    layers[0] = layerWithPixel(20, 20, 100, 0, 0);
    layers[1] = layerWithPixel(20, 20, 0, 100, 0);

    const result = compositeLayerArray(layers);
    expect(getPixel(result, 20, 20)).toEqual([0, 100, 0, 255]);
  });

  test('missing layers (null) are skipped', () => {
    const layers: (PixelGrid | null)[] = new Array(NUM_BODY_PARTS).fill(null);

    // Only set one layer, rest are null
    layers[0] = layerWithPixel(5, 5, 200, 100, 50);

    const result = compositeLayerArray(layers);
    expect(getPixel(result, 5, 5)).toEqual([200, 100, 50, 255]);
    // Other pixels should be transparent
    expect(getPixel(result, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  test('all null layers produce empty grid', () => {
    const layers: (PixelGrid | null)[] = new Array(NUM_BODY_PARTS).fill(null);
    const result = compositeLayerArray(layers);

    // Every pixel should be [0,0,0,0]
    for (let y = 0; y < NATIVE_SIZE; y++) {
      for (let x = 0; x < NATIVE_SIZE; x++) {
        const [r, g, b, a] = getPixel(result, x, y);
        if (r !== 0 || g !== 0 || b !== 0 || a !== 0) {
          // Fail with informative message
          expect([r, g, b, a]).toEqual([0, 0, 0, 0]);
        }
      }
    }
  });

  test('non-overlapping layers do not interfere', () => {
    const layers: (PixelGrid | null)[] = new Array(NUM_BODY_PARTS).fill(null);

    // Carapace at (5, 5)
    layers[0] = layerWithPixel(5, 5, 255, 0, 0);
    // Claws at (10, 10)
    layers[1] = layerWithPixel(10, 10, 0, 255, 0);
    // Tail at (15, 15)
    layers[2] = layerWithPixel(15, 15, 0, 0, 255);

    const result = compositeLayerArray(layers);

    // Each pixel should retain its original color
    expect(getPixel(result, 5, 5)).toEqual([255, 0, 0, 255]);
    expect(getPixel(result, 10, 10)).toEqual([0, 255, 0, 255]);
    expect(getPixel(result, 15, 15)).toEqual([0, 0, 255, 255]);

    // Empty space should be transparent
    expect(getPixel(result, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(result, 30, 30)).toEqual([0, 0, 0, 0]);
  });

  test('semi-transparent layer blends with layer behind it', () => {
    const layers: (PixelGrid | null)[] = new Array(NUM_BODY_PARTS).fill(null);

    // Carapace: solid red at (12, 12)
    layers[0] = layerWithPixel(12, 12, 255, 0, 0, 255);

    // Legs (index 5, rendered second in layer order after carapace):
    // semi-transparent green at same position
    layers[5] = layerWithPixel(12, 12, 0, 255, 0, 128);

    const result = compositeLayerArray(layers);
    const pixel = getPixel(result, 12, 12);

    // Should be a blend of red and green
    expect(pixel[3]).toBe(255); // Full alpha (opaque dst + any src = opaque)
    // Red channel should be reduced (blended with green's R=0)
    expect(pixel[0]).toBeLessThan(255);
    expect(pixel[0]).toBeGreaterThan(50);
    // Green channel should be increased from 0
    expect(pixel[1]).toBeGreaterThan(50);
  });

  test('all 6 layers composite without error', () => {
    const layers: (PixelGrid | null)[] = [];

    // Create a layer for each body part at non-overlapping positions
    for (let i = 0; i < NUM_BODY_PARTS; i++) {
      layers[i] = layerWithPixel(i * 5, i * 5, i * 40, 100, 200);
    }

    const result = compositeLayerArray(layers);

    // Verify each non-overlapping pixel is present
    for (let i = 0; i < NUM_BODY_PARTS; i++) {
      const pixel = getPixel(result, i * 5, i * 5);
      expect(pixel[3]).toBe(255); // All should be opaque
    }
  });

  test('result grid has correct dimensions', () => {
    const layers: (PixelGrid | null)[] = new Array(NUM_BODY_PARTS).fill(null);
    layers[0] = layerWithPixel(0, 0, 255, 0, 0);

    const result = compositeLayerArray(layers);
    expect(result.width).toBe(NATIVE_SIZE);
    expect(result.height).toBe(NATIVE_SIZE);
    expect(result.data.length).toBe(NATIVE_SIZE * NATIVE_SIZE * 4);
  });
});
