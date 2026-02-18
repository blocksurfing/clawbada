/**
 * Template validation for PixelTemplate JSON files.
 */

import { NATIVE_SIZE, NUM_CLASSES, NUM_ROLES } from '../constants';
import type { MutationType, PixelTemplate, TemplatePixel, MutationZone } from '../types';

const VALID_MUTATIONS: MutationType[] = [
  'add_pixels',
  'remove_pixels',
  'shift_pixels',
  'thicken',
  'pattern_fill',
  'detail_overlay',
];

const VALID_BODY_PARTS = ['carapace', 'claws', 'tail', 'antennae', 'eyes', 'legs'];

export interface ValidationError {
  path: string;
  message: string;
}

/** Validate a PixelTemplate object. Returns an array of errors (empty = valid). */
export function validateTemplate(template: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!template || typeof template !== 'object') {
    errors.push({ path: '', message: 'Template must be an object' });
    return errors;
  }

  const t = template as Record<string, unknown>;

  // Version
  if (t.version !== 1) {
    errors.push({ path: 'version', message: `Expected version 1, got ${t.version}` });
  }

  // Dimensions
  if (t.width !== NATIVE_SIZE) {
    errors.push({ path: 'width', message: `Expected ${NATIVE_SIZE}, got ${t.width}` });
  }
  if (t.height !== NATIVE_SIZE) {
    errors.push({ path: 'height', message: `Expected ${NATIVE_SIZE}, got ${t.height}` });
  }

  // Body part
  if (!VALID_BODY_PARTS.includes(t.bodyPart as string)) {
    errors.push({ path: 'bodyPart', message: `Invalid body part: ${t.bodyPart}` });
  }

  // Class affinity
  if (typeof t.classAffinity !== 'number' || t.classAffinity < 0 || t.classAffinity >= NUM_CLASSES) {
    errors.push({ path: 'classAffinity', message: `classAffinity must be 0-${NUM_CLASSES - 1}` });
  }

  // Anchor
  if (!t.anchor || typeof t.anchor !== 'object') {
    errors.push({ path: 'anchor', message: 'Missing anchor point' });
  } else {
    const a = t.anchor as { x: unknown; y: unknown };
    if (typeof a.x !== 'number' || typeof a.y !== 'number') {
      errors.push({ path: 'anchor', message: 'Anchor x/y must be numbers' });
    }
  }

  // Bounds
  if (!t.bounds || typeof t.bounds !== 'object') {
    errors.push({ path: 'bounds', message: 'Missing bounds' });
  } else {
    const b = t.bounds as { x: unknown; y: unknown; w: unknown; h: unknown };
    if (typeof b.x !== 'number' || typeof b.y !== 'number' ||
        typeof b.w !== 'number' || typeof b.h !== 'number') {
      errors.push({ path: 'bounds', message: 'Bounds x/y/w/h must be numbers' });
    }
  }

  // Mutation zones
  if (!Array.isArray(t.mutationZones)) {
    errors.push({ path: 'mutationZones', message: 'mutationZones must be an array' });
  } else {
    for (let i = 0; i < t.mutationZones.length; i++) {
      const zone = t.mutationZones[i] as MutationZone;
      if (typeof zone.x !== 'number' || typeof zone.y !== 'number' ||
          typeof zone.w !== 'number' || typeof zone.h !== 'number') {
        errors.push({ path: `mutationZones[${i}]`, message: 'Zone x/y/w/h must be numbers' });
      }
      if (zone.x < 0 || zone.y < 0 || zone.x + zone.w > NATIVE_SIZE || zone.y + zone.h > NATIVE_SIZE) {
        errors.push({ path: `mutationZones[${i}]`, message: 'Zone exceeds canvas bounds' });
      }
      if (!Array.isArray(zone.allowed) || zone.allowed.length === 0) {
        errors.push({ path: `mutationZones[${i}].allowed`, message: 'Must have at least one allowed mutation' });
      } else {
        for (const mut of zone.allowed) {
          if (!VALID_MUTATIONS.includes(mut)) {
            errors.push({ path: `mutationZones[${i}].allowed`, message: `Invalid mutation type: ${mut}` });
          }
        }
      }
    }
  }

  // Pixels
  if (!Array.isArray(t.pixels)) {
    errors.push({ path: 'pixels', message: 'pixels must be an array' });
  } else {
    for (let i = 0; i < t.pixels.length; i++) {
      const p = t.pixels[i] as TemplatePixel;
      if (typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.role !== 'number') {
        errors.push({ path: `pixels[${i}]`, message: 'Pixel x/y/role must be numbers' });
        continue;
      }
      if (p.x < 0 || p.x >= NATIVE_SIZE || p.y < 0 || p.y >= NATIVE_SIZE) {
        errors.push({ path: `pixels[${i}]`, message: `Pixel (${p.x}, ${p.y}) out of bounds` });
      }
      if (p.role < 0 || p.role >= NUM_ROLES) {
        errors.push({ path: `pixels[${i}]`, message: `Invalid role ${p.role} (must be 0-${NUM_ROLES - 1})` });
      }
    }
  }

  return errors;
}

/** Type guard: returns true if the template is valid. */
export function isValidTemplate(template: unknown): template is PixelTemplate {
  return validateTemplate(template).length === 0;
}
