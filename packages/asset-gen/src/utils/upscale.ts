import { CHANNELS } from '../constants';
import type { PixelGrid } from '../types';

/**
 * Nearest-neighbor upscale a PixelGrid by an integer factor.
 * Preserves pixel-art crispness — no interpolation.
 */
export function upscale(grid: PixelGrid, targetSize: number): PixelGrid {
  if (targetSize === grid.width && targetSize === grid.height) {
    return grid;
  }

  if (targetSize % grid.width !== 0 || targetSize % grid.height !== 0) {
    throw new Error(
      `Target size ${targetSize} must be a multiple of both width (${grid.width}) and height (${grid.height})`,
    );
  }

  const scaleX = targetSize / grid.width;
  const scaleY = targetSize / grid.height;
  const out = new Uint8Array(targetSize * targetSize * CHANNELS);

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const si = (y * grid.width + x) * CHANNELS;
      const r = grid.data[si];
      const g = grid.data[si + 1];
      const b = grid.data[si + 2];
      const a = grid.data[si + 3];

      if (a === 0) continue;

      for (let dy = 0; dy < scaleY; dy++) {
        for (let dx = 0; dx < scaleX; dx++) {
          const di = ((y * scaleY + dy) * targetSize + (x * scaleX + dx)) * CHANNELS;
          out[di] = r;
          out[di + 1] = g;
          out[di + 2] = b;
          out[di + 3] = a;
        }
      }
    }
  }

  return { width: targetSize, height: targetSize, data: out };
}
