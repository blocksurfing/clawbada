/**
 * Template loading and caching.
 *
 * Templates are loaded from JSON files in the data/ directory.
 * Filename convention: data/{bodyPart}/{className}.json
 */

import { BODY_PART_NAMES, CLASS_NAMES, NUM_BODY_PARTS, NUM_CLASSES, NATIVE_SIZE, V1_OFFSET } from '../constants';
import { validateTemplate } from './schema';
import type { PixelTemplate } from '../types';

/** Cache: key = "bodyPart:classAffinity". null = confirmed missing. */
const templateCache = new Map<string, PixelTemplate | null>();

function cacheKey(bodyPart: number, classAffinity: number): string {
  return `${bodyPart}:${classAffinity}`;
}

/**
 * Load a template from the data/ directory.
 * Returns null if the template file does not exist (graceful fallback for missing assets).
 *
 * @param bodyPart Body part index (0-5)
 * @param classAffinity Class affinity index (0-9)
 * @returns The validated PixelTemplate, or null if missing
 */
export async function loadTemplate(bodyPart: number, classAffinity: number): Promise<PixelTemplate | null> {
  const key = cacheKey(bodyPart, classAffinity);
  if (templateCache.has(key)) return templateCache.get(key)!;

  if (bodyPart < 0 || bodyPart >= NUM_BODY_PARTS) {
    throw new Error(`Invalid body part index: ${bodyPart}`);
  }
  if (classAffinity < 0 || classAffinity >= NUM_CLASSES) {
    throw new Error(`Invalid class affinity: ${classAffinity}`);
  }

  const partName = BODY_PART_NAMES[bodyPart];
  const className = CLASS_NAMES[classAffinity];
  const path = new URL(`./data/${partName}/${className}.json`, import.meta.url);

  let data: unknown;
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      templateCache.set(key, null);
      return null;
    }
    data = await file.json();
  } catch {
    templateCache.set(key, null);
    return null;
  }

  const errors = validateTemplate(data);
  if (errors.length > 0) {
    const msgs = errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
    throw new Error(`Invalid template ${partName}/${className}.json:\n${msgs}`);
  }

  const template = normalizeToV2(data as PixelTemplate);
  templateCache.set(key, template);
  return template;
}

/**
 * Normalize a v1 template to v2 format.
 * Centers 48x48 pixels in a 64x64 canvas (offset +8,+8), tags all pixels as tier 0.
 * v2 templates pass through unchanged.
 */
function normalizeToV2(template: PixelTemplate): PixelTemplate {
  if (template.version === 2) return template;

  return {
    ...template,
    version: 2,
    width: NATIVE_SIZE,
    height: NATIVE_SIZE,
    anchor: {
      x: template.anchor.x + V1_OFFSET,
      y: template.anchor.y + V1_OFFSET,
    },
    bounds: {
      x: template.bounds.x + V1_OFFSET,
      y: template.bounds.y + V1_OFFSET,
      w: template.bounds.w,
      h: template.bounds.h,
    },
    mutationZones: template.mutationZones.map((zone) => ({
      ...zone,
      x: zone.x + V1_OFFSET,
      y: zone.y + V1_OFFSET,
    })),
    pixels: template.pixels.map((p) => ({
      x: p.x + V1_OFFSET,
      y: p.y + V1_OFFSET,
      role: p.role,
      tier: 0,
    })),
  };
}

/**
 * Load all 60 templates (6 body parts × 10 classes).
 * Returns a flat array indexed by bodyPart * 10 + classAffinity.
 * Missing templates are null in the returned array.
 */
export async function loadAllTemplates(): Promise<(PixelTemplate | null)[]> {
  const templates: (PixelTemplate | null)[] = new Array(NUM_BODY_PARTS * NUM_CLASSES).fill(null);
  const promises: Promise<void>[] = [];

  for (let bp = 0; bp < NUM_BODY_PARTS; bp++) {
    for (let ca = 0; ca < NUM_CLASSES; ca++) {
      const idx = bp * NUM_CLASSES + ca;
      promises.push(
        loadTemplate(bp, ca).then((t) => {
          templates[idx] = t;
        }),
      );
    }
  }

  await Promise.all(promises);
  return templates;
}

/** Register a template directly into the cache (for testing or programmatic use). */
export function registerTemplate(template: PixelTemplate): void {
  const bodyPartIdx = BODY_PART_NAMES.indexOf(template.bodyPart as typeof BODY_PART_NAMES[number]);
  if (bodyPartIdx === -1) {
    throw new Error(`Unknown body part: ${template.bodyPart}`);
  }
  templateCache.set(cacheKey(bodyPartIdx, template.classAffinity), normalizeToV2(template));
}

/** Clear the template cache. */
export function clearTemplateCache(): void {
  templateCache.clear();
}

/** Check if a template exists in cache. */
export function hasTemplate(bodyPart: number, classAffinity: number): boolean {
  return templateCache.has(cacheKey(bodyPart, classAffinity));
}
