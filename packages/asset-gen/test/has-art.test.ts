import { describe, test, expect, beforeEach } from 'bun:test';
import { hasArt, renderLobster, registerTemplate, clearTemplateCache, countPixels } from '../src/index';
import { BODY_PART_NAMES } from '../src/constants';
import { PaletteRole } from '../src/types';
import type { PixelTemplate } from '../src/types';

/** One pixel of carapace art for class affinity 0 — the smallest template the loader accepts. */
function onePixelTemplate(): PixelTemplate {
  return {
    bodyPart: BODY_PART_NAMES[0] as string,
    classAffinity: 0,
    version: 1,
    width: 48,
    height: 48,
    anchor: { x: 24, y: 20 },
    bounds: { x: 24, y: 20, w: 1, h: 1 },
    mutationZones: [],
    pixels: [{ x: 24, y: 20, role: PaletteRole.PrimaryBase }],
  };
}

// DNA 0 decodes to class 0 with every part's dominant allele at class affinity 0, variant 0.
const PLAIN_DNA = 0n;
const CARAPACE_ONLY = { partsFilter: [0] };

describe('hasArt', () => {
  beforeEach(() => clearTemplateCache());

  test('is true for a lobster whose parts have templates installed', async () => {
    expect(await hasArt(PLAIN_DNA)).toBe(true);
  });

  test('a registered template stands in for the installed one', async () => {
    expect(countPixels(await renderLobster(PLAIN_DNA, 0, CARAPACE_ONLY))).toBeGreaterThan(1);
    registerTemplate(onePixelTemplate());
    expect(await hasArt(PLAIN_DNA)).toBe(true);
    expect(countPixels(await renderLobster(PLAIN_DNA, 0, CARAPACE_ONLY))).toBe(1);
  });

  test('clearing the cache brings the installed template back', async () => {
    registerTemplate(onePixelTemplate());
    expect(countPixels(await renderLobster(PLAIN_DNA, 0, CARAPACE_ONLY))).toBe(1);
    clearTemplateCache();
    expect(countPixels(await renderLobster(PLAIN_DNA, 0, CARAPACE_ONLY))).toBeGreaterThan(1);
  });
});
