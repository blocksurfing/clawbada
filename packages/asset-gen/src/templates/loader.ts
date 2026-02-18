/**
 * Template loading and caching.
 *
 * Templates are loaded from JSON files in the data/ directory.
 * Filename convention: data/{bodyPart}/{className}.json
 */

import { BODY_PART_NAMES, CLASS_NAMES, NUM_BODY_PARTS, NUM_CLASSES } from '../constants';
import { validateTemplate } from './schema';
import type { PixelTemplate } from '../types';

/** Cache: key = "bodyPart:classAffinity" */
const templateCache = new Map<string, PixelTemplate>();

function cacheKey(bodyPart: number, classAffinity: number): string {
  return `${bodyPart}:${classAffinity}`;
}

/**
 * Load a template from the data/ directory.
 *
 * @param bodyPart Body part index (0-5)
 * @param classAffinity Class affinity index (0-9)
 * @returns The validated PixelTemplate
 */
export async function loadTemplate(bodyPart: number, classAffinity: number): Promise<PixelTemplate> {
  const key = cacheKey(bodyPart, classAffinity);
  const cached = templateCache.get(key);
  if (cached) return cached;

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
    data = await file.json();
  } catch {
    throw new Error(`Failed to load template: ${partName}/${className}.json`);
  }

  const errors = validateTemplate(data);
  if (errors.length > 0) {
    const msgs = errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
    throw new Error(`Invalid template ${partName}/${className}.json:\n${msgs}`);
  }

  const template = data as PixelTemplate;
  templateCache.set(key, template);
  return template;
}

/**
 * Load all 60 templates (6 body parts × 10 classes).
 * Returns a flat array indexed by bodyPart * 10 + classAffinity.
 */
export async function loadAllTemplates(): Promise<PixelTemplate[]> {
  const templates: PixelTemplate[] = [];
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
  templateCache.set(cacheKey(bodyPartIdx, template.classAffinity), template);
}

/** Clear the template cache. */
export function clearTemplateCache(): void {
  templateCache.clear();
}

/** Check if a template exists in cache. */
export function hasTemplate(bodyPart: number, classAffinity: number): boolean {
  return templateCache.has(cacheKey(bodyPart, classAffinity));
}
