/**
 * @clawbada/asset-gen — Procedural Pixel Art Generator
 *
 * Public API for rendering lobster pixel art from DNA.
 */

import { decodeDNA, type DecodedDNA } from '@clawbada/game-logic';
import { NATIVE_SIZE, NUM_BODY_PARTS, BODY_PART_NAMES } from './constants';
import { loadTemplate, registerTemplate, clearTemplateCache } from './templates/loader';
import { generateVariant } from './variants/generator';
import { resolveColors, resolveColorsRaw } from './pipeline/color-pipeline';
import { compositeLayerArray, renderBodyPart } from './pipeline/compositor';
import { applyEvolutionEffects } from './pipeline/evolution-effects';
import { applyLegendEffects } from './pipeline/legend-effects';
import { upscale } from './utils/upscale';
import { createGrid, blitOver, cloneGrid, countPixels, computeBounds } from './render/pixel-grid';
import { gridToPng, saveGridAsPng, pngToGrid, loadPngAsGrid } from './render/renderer-sharp';
import { keccak256Packed } from '@clawbada/game-logic';
import type { PixelGrid, PixelTemplate, RenderOptions, RenderParams } from './types';
import type { RoleGrid } from './variants/mutations';

// ──────────── DNA → Render Params ────────────

/**
 * Extract visual rendering parameters from a DNA uint256.
 * Maps each body part's dominant allele to classAffinity + variant.
 */
export function dnaToRenderParams(dna: bigint, evolutionTier = 0): RenderParams {
  const decoded = decodeDNA(dna);

  const parts = decoded.bodyParts.map((bp, i) => ({
    bodyPart: i,
    classAffinity: bp.dominant.classAffinity,
    variant: bp.dominant.variant,
  }));

  return {
    lobsterClass: decoded.class,
    legendStatus: decoded.legend,
    breedType: decoded.breedType,
    parts,
  };
}

// ──────────── Primary API ────────────

/**
 * Render a complete lobster from DNA to a PixelGrid.
 *
 * Full pipeline: DNA decode → template lookup → variant generation →
 * color resolution → compositing → evolution effects → legend effects → upscale.
 */
export async function renderLobster(
  dna: bigint,
  evolutionTier = 0,
  options: RenderOptions = {},
): Promise<PixelGrid> {
  const {
    size = NATIVE_SIZE,
    evolutionEffects = true,
    legendEffects = true,
    partsFilter,
  } = options;

  const params = dnaToRenderParams(dna, evolutionTier);
  const layers: (PixelGrid | null)[] = new Array(NUM_BODY_PARTS).fill(null);

  // Render each body part
  for (const part of params.parts) {
    if (partsFilter && !partsFilter.includes(part.bodyPart)) continue;

    const template = await loadTemplate(part.bodyPart, part.classAffinity);
    layers[part.bodyPart] = renderBodyPart(template, part.variant, params.breedType);
  }

  // Composite all layers
  let result = compositeLayerArray(layers);

  // Evolution effects
  if (evolutionEffects && evolutionTier > 0) {
    const seed = keccak256Packed(dna, 'evolution');
    result = applyEvolutionEffects(result, evolutionTier, params.lobsterClass, seed);
  }

  // Legend effects
  if (legendEffects && params.legendStatus === 1) {
    const seed = keccak256Packed(dna, 'legend');
    result = applyLegendEffects(result, params.lobsterClass, seed);
  }

  // Upscale
  if (size !== NATIVE_SIZE) {
    result = upscale(result, size);
  }

  return result;
}

/**
 * Render a complete lobster and return PNG bytes.
 */
export async function renderLobsterPng(
  dna: bigint,
  evolutionTier = 0,
  options: RenderOptions = {},
): Promise<Uint8Array> {
  const grid = await renderLobster(dna, evolutionTier, options);
  return gridToPng(grid);
}

// ──────────── Single Part API ────────────

/**
 * Render a single body part at a given variant.
 *
 * @param bodyPart Body part index (0-5)
 * @param classAffinity Class affinity (0-9)
 * @param variant Variant number (0-15)
 * @param breedType Optional breed type for color shift (default: 0)
 */
export async function renderPart(
  bodyPart: number,
  classAffinity: number,
  variant: number,
  breedType = 0,
): Promise<PixelGrid> {
  const template = await loadTemplate(bodyPart, classAffinity);
  return renderBodyPart(template, variant, breedType);
}

// ──────────── Low-Level API ────────────

export {
  // Template system
  loadTemplate,
  registerTemplate,
  clearTemplateCache,

  // Variant generation
  generateVariant,

  // Color pipeline
  resolveColors,
  resolveColorsRaw,

  // Compositing
  compositeLayerArray,
  compositeLayerArray as compositeLayers,

  // Effects
  applyEvolutionEffects,
  applyLegendEffects,

  // Pixel grid operations
  createGrid,
  cloneGrid,
  blitOver,
  countPixels,
  computeBounds,

  // Upscaling
  upscale,

  // PNG I/O (sharp)
  gridToPng,
  pngToGrid,
  saveGridAsPng,
  loadPngAsGrid,
};

// Re-export types
export type {
  PixelGrid,
  PixelTemplate,
  RenderOptions,
  RenderParams,
  RGBA,
  HSL,
  ResolvedPalette,
  BreedTypeShift,
  TemplatePixel,
  MutationZone,
  MutationType,
} from './types';

export { PaletteRole } from './types';

// Re-export constants
export {
  NATIVE_SIZE,
  NUM_BODY_PARTS,
  NUM_CLASSES,
  VARIANTS_PER_TEMPLATE,
  TOTAL_ASSETS,
  LAYER_ORDER,
  BODY_PART_NAMES,
  CLASS_NAMES,
  ROLE_NAMES,
  VALID_SIZES,
} from './constants';
