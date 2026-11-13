import { describe, test, expect, beforeEach } from 'bun:test';
import { encodeAllele, encodeDNA, LegendStatus } from '@clawbada/game-logic';
import { renderLobster, clearTemplateCache, countPixels } from '../src/index';
import { loadAllTemplates } from '../src/templates/loader';
import { BODY_PART_NAMES, CLASS_NAMES, NUM_BODY_PARTS, NUM_CLASSES } from '../src/constants';

const TIERS = [0, 1, 2, 3];

/** A lobster of one class through and through: every allele of every part is that class, variant 0. */
function pureDna(lobsterClass: number): bigint {
  const allele = encodeAllele({ classAffinity: lobsterClass, variant: 0 });
  return encodeDNA(lobsterClass, LegendStatus.Normal, 0, new Array(NUM_BODY_PARTS * 3).fill(allele));
}

describe('the installed part templates (src/templates/data)', () => {
  beforeEach(() => clearTemplateCache());

  test('all 60 are there, each filed under its own part and class', async () => {
    const templates = await loadAllTemplates();
    expect(templates).toHaveLength(NUM_BODY_PARTS * NUM_CLASSES);
    for (let part = 0; part < NUM_BODY_PARTS; part++) {
      for (let cls = 0; cls < NUM_CLASSES; cls++) {
        const where = `${BODY_PART_NAMES[part]}/${CLASS_NAMES[cls]}.json`;
        const template = templates[part * NUM_CLASSES + cls];
        expect(template, where).not.toBeNull();
        expect(template!.bodyPart, where).toBe(BODY_PART_NAMES[part]);
        expect(template!.classAffinity, where).toBe(cls);
      }
    }
  });

  test('every template has pixels for every evolution tier (a tier is its own design, not an addition)', async () => {
    for (const template of await loadAllTemplates()) {
      for (const tier of TIERS) {
        const pixels = template!.pixels.filter((p) => (p.tier ?? 0) === tier).length;
        expect(pixels, `${template!.bodyPart}/${CLASS_NAMES[template!.classAffinity]}.json tier ${tier}`).toBeGreaterThan(0);
      }
    }
  });

  test('every class draws at every tier', async () => {
    for (let cls = 0; cls < NUM_CLASSES; cls++) {
      for (const tier of TIERS) {
        const drawn = countPixels(await renderLobster(pureDna(cls), tier));
        expect(drawn, `${CLASS_NAMES[cls]} tier ${tier}`).toBeGreaterThan(0);
      }
    }
  });
});
