/**
 * Browser Canvas renderer.
 *
 * Provides PixelGrid → Canvas/DataURL for client-side rendering.
 * This module is browser-only and should not be imported in Node/Bun contexts.
 */

import type { PixelGrid } from '../types';

/**
 * Render a PixelGrid to an HTMLCanvasElement.
 * Returns the canvas element for direct DOM insertion.
 *
 * @param grid The PixelGrid to render
 * @param scale Optional scale factor for display (default: 1, nearest-neighbor)
 */
export function gridToCanvas(grid: PixelGrid, scale = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = grid.width * scale;
  canvas.height = grid.height * scale;

  const ctx = canvas.getContext('2d')!;

  if (scale === 1) {
    const imageData = new ImageData(
      new Uint8ClampedArray(grid.data),
      grid.width,
      grid.height,
    );
    ctx.putImageData(imageData, 0, 0);
  } else {
    // Render at native size, then scale with nearest-neighbor
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = grid.width;
    tempCanvas.height = grid.height;
    const tempCtx = tempCanvas.getContext('2d')!;

    const imageData = new ImageData(
      new Uint8ClampedArray(grid.data),
      grid.width,
      grid.height,
    );
    tempCtx.putImageData(imageData, 0, 0);

    // Nearest-neighbor scaling
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
  }

  return canvas;
}

/**
 * Render a PixelGrid to a data URL (PNG format).
 * Useful for <img> src attributes and inline rendering.
 */
export function gridToDataUrl(grid: PixelGrid, scale = 1): string {
  const canvas = gridToCanvas(grid, scale);
  return canvas.toDataURL('image/png');
}

/**
 * Render a PixelGrid to a Blob (PNG format).
 */
export function gridToBlob(grid: PixelGrid, scale = 1): Promise<Blob> {
  const canvas = gridToCanvas(grid, scale);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to create blob'));
    }, 'image/png');
  });
}
