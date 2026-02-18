import { describe, test, expect } from 'bun:test';
import {
  dnaToRenderParams,
  registerTemplate,
  clearTemplateCache,
  renderLobster,
} from '../src/index';
import { encodeDNA, keccak256Packed, encodeAllele } from '@clawbada/game-logic';
import { LobsterClass, LegendStatus } from '@clawbada/game-logic';
import type { PixelTemplate, TemplatePixel, PixelGrid } from '../src/types';
import { PaletteRole } from '../src/types';
import { NATIVE_SIZE, BODY_PART_NAMES, NUM_BODY_PARTS, NUM_CLASSES } from '../src/constants';

// ──────────── Test Template Factory ────────────

/**
 * Build a minimal test template for a given body part and class affinity.
 * Creates a 5x5 filled square at (22,19)-(26,23).
 * Each body part is offset slightly to be distinguishable in composited output.
 */
function buildTestTemplate(bodyPartIdx: number, classAffinity: number): PixelTemplate {
  const offsetX = bodyPartIdx * 2; // Slight offset per body part
  const pixels: TemplatePixel[] = [];

  for (let y = 19; y <= 23; y++) {
    for (let x = 22 + offsetX; x <= 26 + offsetX; x++) {
      if (x >= NATIVE_SIZE) continue;
      const isEdge =
        x === 22 + offsetX || x === 26 + offsetX || y === 19 || y === 23;
      pixels.push({
        x,
        y,
        role: isEdge ? PaletteRole.Outline : PaletteRole.PrimaryBase,
      });
    }
  }

  return {
    bodyPart: BODY_PART_NAMES[bodyPartIdx] as string,
    classAffinity,
    version: 1,
    width: 48,
    height: 48,
    anchor: { x: 24, y: 20 },
    bounds: { x: 20 + offsetX, y: 18, w: 8, h: 5 },
    mutationZones: [
      {
        x: 20 + offsetX,
        y: 18,
        w: 8,
        h: 5,
        allowed: [
          'add_pixels',
          'remove_pixels',
          'shift_pixels',
          'thicken',
          'pattern_fill',
          'detail_overlay',
        ],
      },
    ],
    pixels,
  };
}

// ──────────── DNA Test Helpers ────────────

/**
 * Build a DNA with all body parts having the same class affinity and variant.
 */
function buildTestDNA(
  lobsterClass: number,
  classAffinity: number,
  variant: number,
  breedType = 0,
  legend: LegendStatus = LegendStatus.Normal,
): bigint {
  // 18 allele bytes: 6 body parts x 3 alleles (D, R1, R2)
  const alleles: number[] = [];
  for (let bp = 0; bp < 6; bp++) {
    // Dominant: target class affinity + variant
    alleles.push(encodeAllele({ classAffinity, variant }));
    // R1: same class but different variant
    alleles.push(encodeAllele({ classAffinity, variant: (variant + 1) % 16 }));
    // R2: different class
    alleles.push(encodeAllele({ classAffinity: (classAffinity + 1) % 10, variant: 0 }));
  }

  return encodeDNA(lobsterClass as LobsterClass, legend, breedType, alleles);
}

// ──────────── Setup: Register test templates for all body parts ────────────

function registerAllTestTemplates(): void {
  clearTemplateCache();
  for (let bp = 0; bp < NUM_BODY_PARTS; bp++) {
    for (let ca = 0; ca < NUM_CLASSES; ca++) {
      registerTemplate(buildTestTemplate(bp, ca));
    }
  }
}

// ──────────── Tests ────────────

describe('dnaToRenderParams()', () => {
  test('correctly extracts lobster class from DNA', () => {
    const dna = buildTestDNA(3, 3, 5);
    const params = dnaToRenderParams(dna);
    expect(params.lobsterClass).toBe(3); // Tempest
  });

  test('correctly extracts breed type from DNA', () => {
    const dna = buildTestDNA(0, 0, 0, 42);
    const params = dnaToRenderParams(dna);
    expect(params.breedType).toBe(42);
  });

  test('correctly extracts legend status from DNA', () => {
    const dna = buildTestDNA(0, 0, 0, 0, LegendStatus.Legend);
    const params = dnaToRenderParams(dna);
    expect(params.legendStatus).toBe(1);
  });

  test('extracts 6 body parts from DNA', () => {
    const dna = buildTestDNA(0, 0, 7);
    const params = dnaToRenderParams(dna);
    expect(params.parts.length).toBe(6);
  });

  test('each body part has correct bodyPart index', () => {
    const dna = buildTestDNA(0, 0, 0);
    const params = dnaToRenderParams(dna);
    for (let i = 0; i < 6; i++) {
      expect(params.parts[i].bodyPart).toBe(i);
    }
  });

  test('body parts reflect dominant allele class affinity and variant', () => {
    const classAffinity = 5;
    const variant = 12;
    const dna = buildTestDNA(5, classAffinity, variant);
    const params = dnaToRenderParams(dna);

    for (const part of params.parts) {
      expect(part.classAffinity).toBe(classAffinity);
      expect(part.variant).toBe(variant);
    }
  });
});

describe('Deterministic rendering', () => {
  test('same DNA produces identical output across 10 iterations', async () => {
    registerAllTestTemplates();

    const dna = buildTestDNA(0, 0, 3, 0);
    const reference = await renderLobster(dna, 0, {
      evolutionEffects: false,
      legendEffects: false,
    });

    for (let i = 0; i < 10; i++) {
      const result = await renderLobster(dna, 0, {
        evolutionEffects: false,
        legendEffects: false,
      });

      expect(result.width).toBe(reference.width);
      expect(result.height).toBe(reference.height);
      expect(result.data.length).toBe(reference.data.length);

      // Byte-for-byte comparison
      for (let j = 0; j < reference.data.length; j++) {
        if (result.data[j] !== reference.data[j]) {
          throw new Error(
            `Mismatch at byte ${j} on iteration ${i}: ` +
              `expected ${reference.data[j]}, got ${result.data[j]}`,
          );
        }
      }
    }
  });

  test('different DNA produces different output', async () => {
    registerAllTestTemplates();

    const dna1 = buildTestDNA(0, 0, 3, 0);
    const dna2 = buildTestDNA(9, 9, 12, 5);

    const result1 = await renderLobster(dna1, 0, {
      evolutionEffects: false,
      legendEffects: false,
    });
    const result2 = await renderLobster(dna2, 0, {
      evolutionEffects: false,
      legendEffects: false,
    });

    // Find at least one differing byte
    let hasDifference = false;
    for (let j = 0; j < result1.data.length; j++) {
      if (result1.data[j] !== result2.data[j]) {
        hasDifference = true;
        break;
      }
    }
    expect(hasDifference).toBe(true);
  });

  test('same DNA with different breed types produces different colors', async () => {
    registerAllTestTemplates();

    const dna1 = buildTestDNA(0, 0, 3, 0); // breed type 0
    const dna2 = buildTestDNA(0, 0, 3, 44); // breed type 44 (complement flip)

    const result1 = await renderLobster(dna1, 0, {
      evolutionEffects: false,
      legendEffects: false,
    });
    const result2 = await renderLobster(dna2, 0, {
      evolutionEffects: false,
      legendEffects: false,
    });

    let hasDifference = false;
    for (let j = 0; j < result1.data.length; j++) {
      if (result1.data[j] !== result2.data[j]) {
        hasDifference = true;
        break;
      }
    }
    expect(hasDifference).toBe(true);
  });

  test('deterministic across different variant numbers', async () => {
    registerAllTestTemplates();

    // Use a DNA with variant=8 (detailed tier)
    const dna = buildTestDNA(2, 2, 8, 0);

    const ref = await renderLobster(dna, 0, {
      evolutionEffects: false,
      legendEffects: false,
    });

    // Run 5 more times
    for (let i = 0; i < 5; i++) {
      const result = await renderLobster(dna, 0, {
        evolutionEffects: false,
        legendEffects: false,
      });

      let identical = true;
      for (let j = 0; j < ref.data.length; j++) {
        if (result.data[j] !== ref.data[j]) {
          identical = false;
          break;
        }
      }
      expect(identical).toBe(true);
    }
  });
});
