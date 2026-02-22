/**
 * 6-layer compositing pipeline.
 *
 * Layer order (back to front): Carapace → Legs → Tail → Eyes → Antennae → Claws
 * Each body part is rendered independently, then alpha-composited.
 */

import { LAYER_ORDER, NATIVE_SIZE, NUM_BODY_PARTS, BODY_PART_NAMES } from '../constants';
import { createGrid, blitOver } from '../render/pixel-grid';
import { generateVariant } from '../variants/generator';
import { resolveColors } from './color-pipeline';
import type { PixelGrid, PixelTemplate, RenderParams } from '../types';
import type { RoleGrid } from '../variants/mutations';

/** A rendered body part layer ready for compositing. */
export interface RenderedLayer {
  bodyPart: number;
  grid: PixelGrid;
}

/**
 * Render a single body part from template + variant + colors.
 */
export function renderBodyPart(
  template: PixelTemplate,
  variant: number,
  breedType: number,
): PixelGrid {
  const roleGrid = generateVariant(template, variant);
  return resolveColors(roleGrid, template.classAffinity, breedType, template.customColors);
}

/**
 * Render a body part from a pre-generated role grid.
 */
export function renderBodyPartFromRoleGrid(
  roleGrid: RoleGrid,
  classAffinity: number,
  breedType: number,
): PixelGrid {
  return resolveColors(roleGrid, classAffinity, breedType);
}

/**
 * Composite multiple rendered layers into a single image.
 * Layers are composited in LAYER_ORDER (back to front).
 *
 * @param layers Map of bodyPart index → rendered PixelGrid
 * @returns Final composited 64×64 PixelGrid
 */
export function compositeLayers(layers: Map<number, PixelGrid>): PixelGrid {
  const canvas = createGrid(NATIVE_SIZE, NATIVE_SIZE);

  for (const bodyPartIdx of LAYER_ORDER) {
    const layer = layers.get(bodyPartIdx);
    if (!layer) continue;
    blitOver(canvas, layer, 0, 0);
  }

  return canvas;
}

/**
 * Composite an array of 6 layers (indexed by body part) into a single image.
 * Convenience wrapper that accepts an array instead of a Map.
 */
export function compositeLayerArray(layers: (PixelGrid | null)[]): PixelGrid {
  const canvas = createGrid(NATIVE_SIZE, NATIVE_SIZE);

  for (const bodyPartIdx of LAYER_ORDER) {
    const layer = layers[bodyPartIdx];
    if (!layer) continue;
    blitOver(canvas, layer, 0, 0);
  }

  return canvas;
}

/**
 * Full render pipeline: templates + render params → composited lobster.
 *
 * @param templates Function to get template by (bodyPart, classAffinity)
 * @param params Render parameters extracted from DNA
 * @returns Composited PixelGrid
 */
export function renderFromParams(
  getTemplate: (bodyPart: number, classAffinity: number) => PixelTemplate | null,
  params: RenderParams,
): PixelGrid {
  const layers: (PixelGrid | null)[] = new Array(NUM_BODY_PARTS).fill(null);

  for (const part of params.parts) {
    const template = getTemplate(part.bodyPart, part.classAffinity);
    if (!template) continue; // Skip missing templates
    layers[part.bodyPart] = renderBodyPart(template, part.variant, params.breedType);
  }

  return compositeLayerArray(layers);
}
