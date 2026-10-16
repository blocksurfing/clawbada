import { describe, test, expect, beforeEach } from 'bun:test';
import { hasArt, registerTemplate, clearTemplateCache } from '../src/index';
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

describe('hasArt', () => {
  beforeEach(() => clearTemplateCache());

  test('is false while none of the lobster\'s parts has a template', async () => {
    expect(await hasArt(PLAIN_DNA)).toBe(false);
  });

  test('is true as soon as one part has a template', async () => {
    expect(await hasArt(PLAIN_DNA)).toBe(false);
    registerTemplate(onePixelTemplate());
    expect(await hasArt(PLAIN_DNA)).toBe(true);
  });

  test('clearing the cache forgets a registered template', async () => {
    registerTemplate(onePixelTemplate());
    expect(await hasArt(PLAIN_DNA)).toBe(true);
    clearTemplateCache();
    expect(await hasArt(PLAIN_DNA)).toBe(false);
  });
});
