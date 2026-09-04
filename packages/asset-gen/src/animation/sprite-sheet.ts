/**
 * Idle sprite sheet generator.
 *
 * Renders N frames of the idle animation into a horizontal sprite strip.
 * Each frame composites 6 body parts with per-part position offsets
 * interpolated from the idle keyframe data.
 */

import { NATIVE_SIZE, NUM_BODY_PARTS, LAYER_ORDER } from '../constants';
import { loadTemplate } from '../templates/loader';
import { renderBodyPart } from '../pipeline/compositor';
import { applyEvolutionEffects } from '../pipeline/evolution-effects';
import { applyLegendEffects } from '../pipeline/legend-effects';
import { createGrid, blitOver } from '../render/pixel-grid';
import { upscale } from '../utils/upscale';
import { gridToPng } from '../render/renderer-sharp';
import { dnaToRenderParams } from '../index';
import { keccak256Packed } from '@clawbada/game-logic';
import type { PixelGrid, PixelTemplate } from '../types';
import {
  ANIM_PAD,
  PADDED_SIZE,
  IDLE_TOTAL_FRAMES,
  getIdleOffset,
  sampleFrameIndices,
} from './idle-keyframes';

// Local copy of the private helper in ../index.ts (not exported from the barrel).
function filterTemplateByTier(template: PixelTemplate, evolutionTier: number): PixelTemplate {
  const filtered = template.pixels.filter((p) => (p.tier ?? 0) === evolutionTier);
  if (filtered.length === template.pixels.length) return template;
  return { ...template, pixels: filtered };
}

export interface IdleSpriteSheetOptions {
  /** Number of frames to sample (default: 16) */
  frames?: number;
  /** Output size per frame in pixels (default: 192) */
  size?: number;
  /** Apply evolution visual effects (default: true) */
  evolutionEffects?: boolean;
  /** Apply legend visual effects (default: true) */
  legendEffects?: boolean;
}

/**
 * Render an idle sprite sheet as a PixelGrid (horizontal strip).
 *
 * Output dimensions: (size × frames) wide × size tall.
 */
export async function renderIdleSpriteSheet(
  dna: bigint,
  evolutionTier = 0,
  options: IdleSpriteSheetOptions = {},
): Promise<PixelGrid> {
  const {
    frames = 16,
    size = 192,
    evolutionEffects = true,
    legendEffects = true,
  } = options;

  const params = dnaToRenderParams(dna, evolutionTier);

  // Step 1: Render each body part separately (static, no compositing yet)
  const partGrids: (PixelGrid | null)[] = new Array(NUM_BODY_PARTS).fill(null);

  for (const part of params.parts) {
    const loaded = await loadTemplate(part.bodyPart, part.classAffinity);
    if (!loaded) continue;

    const template = filterTemplateByTier(loaded, evolutionTier);
    partGrids[part.bodyPart] = renderBodyPart(template, part.variant, params.breedType);
  }

  // Step 2: Sample frame indices
  const frameIndices = sampleFrameIndices(frames, IDLE_TOTAL_FRAMES);

  // Step 3: Render each frame with per-part offsets
  const frameGrids: PixelGrid[] = [];

  for (const frameIdx of frameIndices) {
    // Create padded canvas (80×80) for animation overflow
    let canvas = createGrid(PADDED_SIZE, PADDED_SIZE);

    // Composite body parts in layer order with animated offsets
    for (const bodyPartIdx of LAYER_ORDER) {
      const partGrid = partGrids[bodyPartIdx];
      if (!partGrid) continue;

      const offset = getIdleOffset(bodyPartIdx, frameIdx);

      // Blit body part onto padded canvas at (ANIM_PAD + offset, ANIM_PAD + offset)
      blitOver(canvas, partGrid, ANIM_PAD + offset.dx, ANIM_PAD + offset.dy);
    }

    // Apply evolution effects (uses the padded canvas)
    if (evolutionEffects && evolutionTier > 0) {
      const seed = keccak256Packed(dna, 'evolution');
      canvas = applyEvolutionEffects(canvas, evolutionTier, params.lobsterClass, seed);
    }

    // Apply legend effects
    if (legendEffects && params.legendStatus === 1) {
      const seed = keccak256Packed(dna, 'legend');
      canvas = applyLegendEffects(canvas, params.lobsterClass, seed);
    }

    // Upscale the padded frame to target size
    // upscale() requires target to be a multiple of source (80).
    // Scale to nearest valid multiple, then we'll use it as-is (slight size variance is OK for pixel art).
    if (size !== PADDED_SIZE) {
      const scale = Math.max(1, Math.round(size / PADDED_SIZE));
      const actualSize = PADDED_SIZE * scale;
      canvas = upscale(canvas, actualSize);
    }
    frameGrids.push(canvas);
  }

  // Step 4: Stitch frames into horizontal strip
  const cellSize = frameGrids[0].width; // actual size after upscale rounding
  const stripWidth = cellSize * frames;
  const stripHeight = cellSize;
  const strip = createGrid(stripWidth, stripHeight);

  for (let i = 0; i < frameGrids.length; i++) {
    blitOver(strip, frameGrids[i], i * cellSize, 0);
  }

  return strip;
}

/**
 * Render an idle sprite sheet and return PNG bytes.
 */
export async function renderIdleSpriteSheetPng(
  dna: bigint,
  evolutionTier = 0,
  options: IdleSpriteSheetOptions = {},
): Promise<Uint8Array> {
  const grid = await renderIdleSpriteSheet(dna, evolutionTier, options);
  return gridToPng(grid);
}
