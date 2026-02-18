import { CHANNELS, NATIVE_SIZE } from '../constants';
import type { PixelGrid, RGBA } from '../types';

/** Create an empty (fully transparent) PixelGrid. */
export function createGrid(width = NATIVE_SIZE, height = NATIVE_SIZE): PixelGrid {
  return {
    width,
    height,
    data: new Uint8Array(width * height * CHANNELS),
  };
}

/** Clone a PixelGrid (deep copy of data). */
export function cloneGrid(grid: PixelGrid): PixelGrid {
  return {
    width: grid.width,
    height: grid.height,
    data: new Uint8Array(grid.data),
  };
}

/** Get the byte offset for pixel (x, y). */
function offset(grid: PixelGrid, x: number, y: number): number {
  return (y * grid.width + x) * CHANNELS;
}

/** Check if (x, y) is within grid bounds. */
export function inBounds(grid: PixelGrid, x: number, y: number): boolean {
  return x >= 0 && x < grid.width && y >= 0 && y < grid.height;
}

/** Get the RGBA color at (x, y). Returns [0,0,0,0] if out of bounds. */
export function getPixel(grid: PixelGrid, x: number, y: number): RGBA {
  if (!inBounds(grid, x, y)) return [0, 0, 0, 0];
  const i = offset(grid, x, y);
  return [grid.data[i], grid.data[i + 1], grid.data[i + 2], grid.data[i + 3]];
}

/** Set the RGBA color at (x, y). No-op if out of bounds. */
export function setPixel(grid: PixelGrid, x: number, y: number, color: RGBA): void {
  if (!inBounds(grid, x, y)) return;
  const i = offset(grid, x, y);
  grid.data[i] = color[0];
  grid.data[i + 1] = color[1];
  grid.data[i + 2] = color[2];
  grid.data[i + 3] = color[3];
}

/** Get the alpha value at (x, y). Returns 0 if out of bounds. */
export function getAlpha(grid: PixelGrid, x: number, y: number): number {
  if (!inBounds(grid, x, y)) return 0;
  return grid.data[offset(grid, x, y) + 3];
}

/** Check if a pixel is non-transparent (alpha > 0). */
export function isOpaque(grid: PixelGrid, x: number, y: number): boolean {
  return getAlpha(grid, x, y) > 0;
}

/**
 * Alpha-composite src onto dst (in place) using standard "over" blending.
 * src is drawn at (offsetX, offsetY) relative to dst's origin.
 */
export function blitOver(
  dst: PixelGrid,
  src: PixelGrid,
  offsetX = 0,
  offsetY = 0,
): void {
  for (let sy = 0; sy < src.height; sy++) {
    const dy = sy + offsetY;
    if (dy < 0 || dy >= dst.height) continue;

    for (let sx = 0; sx < src.width; sx++) {
      const dx = sx + offsetX;
      if (dx < 0 || dx >= dst.width) continue;

      const si = (sy * src.width + sx) * CHANNELS;
      const srcA = src.data[si + 3];
      if (srcA === 0) continue;

      const di = (dy * dst.width + dx) * CHANNELS;

      if (srcA === 255) {
        // Fully opaque — direct copy
        dst.data[di] = src.data[si];
        dst.data[di + 1] = src.data[si + 1];
        dst.data[di + 2] = src.data[si + 2];
        dst.data[di + 3] = 255;
      } else {
        // Standard alpha compositing
        const sa = srcA / 255;
        const da = dst.data[di + 3] / 255;
        const outA = sa + da * (1 - sa);

        if (outA > 0) {
          dst.data[di] = Math.round((src.data[si] * sa + dst.data[di] * da * (1 - sa)) / outA);
          dst.data[di + 1] = Math.round((src.data[si + 1] * sa + dst.data[di + 1] * da * (1 - sa)) / outA);
          dst.data[di + 2] = Math.round((src.data[si + 2] * sa + dst.data[di + 2] * da * (1 - sa)) / outA);
          dst.data[di + 3] = Math.round(outA * 255);
        }
      }
    }
  }
}

/** Fill the entire grid with a single color. */
export function fillGrid(grid: PixelGrid, color: RGBA): void {
  for (let i = 0; i < grid.data.length; i += CHANNELS) {
    grid.data[i] = color[0];
    grid.data[i + 1] = color[1];
    grid.data[i + 2] = color[2];
    grid.data[i + 3] = color[3];
  }
}

/** Clear the grid (set all pixels to transparent). */
export function clearGrid(grid: PixelGrid): void {
  grid.data.fill(0);
}

/**
 * Count non-transparent pixels in the grid.
 */
export function countPixels(grid: PixelGrid): number {
  let count = 0;
  for (let i = 3; i < grid.data.length; i += CHANNELS) {
    if (grid.data[i] > 0) count++;
  }
  return count;
}

/**
 * Compute bounding box of non-transparent pixels.
 * Returns null if grid is fully transparent.
 */
export function computeBounds(
  grid: PixelGrid,
): { x: number; y: number; w: number; h: number } | null {
  let minX = grid.width;
  let minY = grid.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (getAlpha(grid, x, y) > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Check if a pixel is on the edge of the silhouette (has at least one
 * transparent 4-connected neighbor while being opaque itself).
 */
export function isEdgePixel(grid: PixelGrid, x: number, y: number): boolean {
  if (!isOpaque(grid, x, y)) return false;
  return (
    !isOpaque(grid, x - 1, y) ||
    !isOpaque(grid, x + 1, y) ||
    !isOpaque(grid, x, y - 1) ||
    !isOpaque(grid, x, y + 1)
  );
}

/**
 * Apply a per-pixel transform to all non-transparent pixels.
 * The transform receives and returns RGBA. Mutates in place.
 */
export function mapPixels(grid: PixelGrid, fn: (color: RGBA, x: number, y: number) => RGBA): void {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const i = offset(grid, x, y);
      if (grid.data[i + 3] === 0) continue;
      const result = fn([grid.data[i], grid.data[i + 1], grid.data[i + 2], grid.data[i + 3]], x, y);
      grid.data[i] = result[0];
      grid.data[i + 1] = result[1];
      grid.data[i + 2] = result[2];
      grid.data[i + 3] = result[3];
    }
  }
}
