/**
 * PNG I/O via sharp (Node/Bun).
 *
 * Converts PixelGrid ↔ PNG bytes using sharp for efficient encoding/decoding.
 */

import sharp from 'sharp';
import type { PixelGrid } from '../types';
import { createGrid } from './pixel-grid';

/**
 * Encode a PixelGrid to PNG bytes.
 */
export async function gridToPng(grid: PixelGrid): Promise<Uint8Array> {
  const buffer = await sharp(Buffer.from(grid.data), {
    raw: {
      width: grid.width,
      height: grid.height,
      channels: 4,
    },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return new Uint8Array(buffer);
}

/**
 * Decode a PNG file to a PixelGrid.
 */
export async function pngToGrid(pngData: Uint8Array): Promise<PixelGrid> {
  const { data, info } = await sharp(Buffer.from(pngData))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data),
  };
}

/**
 * Save a PixelGrid as a PNG file.
 */
export async function saveGridAsPng(grid: PixelGrid, filePath: string): Promise<void> {
  await sharp(Buffer.from(grid.data), {
    raw: {
      width: grid.width,
      height: grid.height,
      channels: 4,
    },
  })
    .png({ compressionLevel: 9 })
    .toFile(filePath);
}

/**
 * Load a PNG file into a PixelGrid.
 */
export async function loadPngAsGrid(filePath: string): Promise<PixelGrid> {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data),
  };
}
