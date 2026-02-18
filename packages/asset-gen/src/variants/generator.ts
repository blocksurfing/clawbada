/**
 * Variant generation from base templates.
 *
 * Input: base template + variant number (0-15)
 * Seed: keccak256Packed(classAffinity, bodyPart, variant, "assetgen-v1")
 *
 * Variant tiers:
 *   0-3   (simple):    simplify edges, remove detail (0-2 mutations)
 *   4-7   (moderate):  base + small additions/thickening (2-4 mutations)
 *   8-11  (detailed):  patterns, detail overlays (3-6 mutations)
 *   12-15 (elaborate): all mutation types, maximum elaboration (5-8 mutations)
 *
 * After each mutation: auto-repair outlines.
 */

import { NATIVE_SIZE } from '../constants';
import { BODY_PART_NAMES } from '../constants';
import { variantSeed, subSeed, randInt, randShuffle } from '../utils/deterministic-rng';
import {
  type RoleGrid,
  createRoleGrid,
  addPixels,
  removePixels,
  shiftPixels,
  thicken,
  patternFill,
  detailOverlay,
  repairOutlines,
} from './mutations';
import type { MutationType, MutationZone, PixelGrid, PixelTemplate, TemplatePixel } from '../types';
import { createGrid, setPixel } from '../render/pixel-grid';

/** Map of mutation type names to functions. */
const MUTATION_FNS: Record<
  MutationType,
  (grid: RoleGrid, zone: MutationZone, seed: bigint) => void
> = {
  add_pixels: addPixels,
  remove_pixels: removePixels,
  shift_pixels: shiftPixels,
  thicken,
  pattern_fill: patternFill,
  detail_overlay: detailOverlay,
};

/** Mutation type pools per variant tier. */
const SIMPLE_MUTATIONS: MutationType[] = ['remove_pixels', 'shift_pixels'];
const MODERATE_MUTATIONS: MutationType[] = ['add_pixels', 'thicken', 'shift_pixels'];
const DETAILED_MUTATIONS: MutationType[] = ['pattern_fill', 'detail_overlay', 'add_pixels', 'thicken'];
const ELABORATE_MUTATIONS: MutationType[] = [
  'add_pixels',
  'remove_pixels',
  'shift_pixels',
  'thicken',
  'pattern_fill',
  'detail_overlay',
];

interface VariantTierConfig {
  minMutations: number;
  maxMutations: number;
  pool: MutationType[];
}

function getVariantTier(variant: number): VariantTierConfig {
  if (variant < 4) return { minMutations: 0, maxMutations: 2, pool: SIMPLE_MUTATIONS };
  if (variant < 8) return { minMutations: 2, maxMutations: 4, pool: MODERATE_MUTATIONS };
  if (variant < 12) return { minMutations: 3, maxMutations: 6, pool: DETAILED_MUTATIONS };
  return { minMutations: 5, maxMutations: 8, pool: ELABORATE_MUTATIONS };
}

/**
 * Convert a PixelTemplate's sparse pixels to a RoleGrid.
 */
export function templateToRoleGrid(template: PixelTemplate): RoleGrid {
  const grid = createRoleGrid();
  for (const pixel of template.pixels) {
    grid[pixel.y * NATIVE_SIZE + pixel.x] = pixel.role;
  }
  return grid;
}

/**
 * Convert a RoleGrid back to sparse pixel array.
 */
export function roleGridToPixels(grid: RoleGrid): TemplatePixel[] {
  const pixels: TemplatePixel[] = [];
  for (let y = 0; y < NATIVE_SIZE; y++) {
    for (let x = 0; x < NATIVE_SIZE; x++) {
      const role = grid[y * NATIVE_SIZE + x];
      if (role !== 0xFF) {
        pixels.push({ x, y, role });
      }
    }
  }
  return pixels;
}

/**
 * Generate a procedural variant of a template.
 *
 * @param template The base template
 * @param variant Variant number (0-15)
 * @returns A RoleGrid with the mutated variant
 */
export function generateVariantRoleGrid(template: PixelTemplate, variant: number): RoleGrid {
  if (variant < 0 || variant >= 16) {
    throw new Error(`Variant must be 0-15, got ${variant}`);
  }

  const bodyPartIdx = BODY_PART_NAMES.indexOf(template.bodyPart as typeof BODY_PART_NAMES[number]);
  const seed = variantSeed(template.classAffinity, bodyPartIdx, variant);
  const roleGrid = templateToRoleGrid(template);

  // Variant 0 is always the unmodified base template
  if (variant === 0) {
    return roleGrid;
  }

  const tier = getVariantTier(variant);
  const mutationCount = randInt(seed, 'mutation_count', tier.minMutations, tier.maxMutations);

  if (mutationCount === 0 || template.mutationZones.length === 0) {
    return roleGrid;
  }

  for (let i = 0; i < mutationCount; i++) {
    const stepSeed = subSeed(seed, `step_${i}`);

    // Pick a random zone
    const zoneIdx = randInt(stepSeed, 'zone', 0, template.mutationZones.length - 1);
    const zone = template.mutationZones[zoneIdx];

    // Pick a mutation type from the tier pool, filtered by zone's allowed list
    const allowed = tier.pool.filter((m) => zone.allowed.includes(m));
    if (allowed.length === 0) continue;

    const shuffled = randShuffle(stepSeed, 'mut_shuffle', allowed);
    const mutationType = shuffled[0];

    // Apply mutation
    const fn = MUTATION_FNS[mutationType];
    fn(roleGrid, zone, stepSeed);

    // Repair outlines after each mutation
    repairOutlines(roleGrid);
  }

  return roleGrid;
}

/**
 * Generate a variant and return it as a PixelGrid with role values
 * stored in the red channel (for downstream color pipeline).
 *
 * This is the main entry point for variant generation.
 * The returned grid has role indices in the R channel and 255 in the A channel
 * for non-transparent pixels.
 */
export function generateVariant(template: PixelTemplate, variant: number): RoleGrid {
  return generateVariantRoleGrid(template, variant);
}
