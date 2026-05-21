/**
 * 64 breed type HSL color transforms (0-63).
 *
 * From GAME_ASSET_SPEC.md Section 6:
 *   0-15:  Regional variants (tinting, subtle saturation/lightness)
 *   16-31: Pattern variants (saturation/brightness changes)
 *   32-47: Texture accents (tinting, contrast shifts)
 *   48-63: Reserved/neutral (identity transforms for future use)
 *
 * NOTE: No hue rotation is applied — class palette identity must remain
 * visually recognizable. Breed types create variety through saturation,
 * lightness, and subtle tinting only.
 */

import type { BreedTypeShift, RGBA } from '../types';

function shift(
  hueRotation: number,
  saturationMult: number,
  lightnessMult: number,
  tint?: RGBA,
  tintStrength?: number,
): BreedTypeShift {
  return { hueRotation, saturationMult, lightnessMult, tint, tintStrength };
}

export const BREED_TYPE_SHIFTS: BreedTypeShift[] = [
  // ── 0-15: Regional variants ──
  shift(0, 1.0, 1.0),                                          // 0: Identity (no change)
  shift(0, 1.05, 1.02),                                        // 1: Warm saturated
  shift(0, 0.95, 0.98),                                        // 2: Cool desaturated
  shift(0, 1.08, 1.0),                                         // 3: Tropical
  shift(0, 0.92, 0.98),                                        // 4: Arctic
  shift(0, 1.0, 1.05, [255, 200, 150, 255], 0.06),             // 5: Sandy
  shift(0, 1.0, 0.95, [100, 150, 200, 255], 0.06),             // 6: Deep ocean
  shift(0, 1.1, 1.0),                                          // 7: Coral reef
  shift(0, 0.9, 0.95),                                         // 8: Twilight zone
  shift(0, 1.05, 1.05),                                        // 9: Volcanic vent
  shift(0, 0.95, 0.92),                                        // 10: Abyssal
  shift(0, 1.0, 1.0, [200, 255, 200, 255], 0.04),              // 11: Kelp forest
  shift(0, 1.0, 1.0, [180, 180, 220, 255], 0.04),              // 12: Moonlit
  shift(0, 1.15, 1.0),                                         // 13: Vivid
  shift(0, 0.85, 1.0),                                         // 14: Muted
  shift(0, 1.0, 1.0, [255, 230, 180, 255], 0.08),              // 15: Sunbleached

  // ── 16-31: Pattern variants ──
  shift(0, 1.2, 0.95),                                         // 16: High contrast
  shift(0, 0.8, 1.05),                                         // 17: Pastel
  shift(0, 1.25, 0.9),                                         // 18: Deep saturated
  shift(0, 0.75, 1.1),                                         // 19: Washed
  shift(0, 1.1, 0.95),                                         // 20: Dark saturated
  shift(0, 1.1, 1.05),                                         // 21: Bright saturated
  shift(0, 1.0, 0.88),                                         // 22: Darkened
  shift(0, 1.0, 1.12),                                         // 23: Brightened
  shift(0, 0.9, 1.02),                                         // 24: Dusty
  shift(0, 0.9, 0.95),                                         // 25: Weathered
  shift(0, 1.2, 1.0),                                          // 26: Neon
  shift(0, 0.65, 1.0),                                         // 27: Desaturated
  shift(0, 1.0, 0.9),                                          // 28: Aged
  shift(0, 0.95, 0.93),                                        // 29: Faded
  shift(0, 1.12, 1.05),                                        // 30: Luminous
  shift(0, 0.8, 0.95),                                         // 31: Subdued

  // ── 32-47: Texture accents ──
  shift(0, 1.15, 1.0),                                         // 32: Flame-touched
  shift(0, 1.15, 0.95),                                        // 33: Frost-touched
  shift(0, 1.0, 1.0, [200, 160, 100, 255], 0.06),              // 34: Copper patina
  shift(0, 1.0, 0.92, [60, 80, 120, 255], 0.06),               // 35: Ocean depth
  shift(0, 1.3, 0.88),                                         // 36: Dark vivid
  shift(0, 0.55, 1.15),                                        // 37: Ghost fade
  shift(0, 1.1, 1.02),                                         // 38: Warm accent
  shift(0, 1.05, 0.96),                                        // 39: Cool accent
  shift(0, 1.0, 1.0, [255, 100, 50, 255], 0.08),               // 40: Ember-tinted
  shift(0, 1.0, 1.0, [50, 100, 255, 255], 0.08),               // 41: Ice-tinted
  shift(0, 1.0, 1.0, [100, 255, 100, 255], 0.08),              // 42: Toxic-tinted
  shift(0, 1.0, 1.0, [200, 100, 255, 255], 0.06),              // 43: Void-tinted
  shift(0, 0.9, 1.02),                                         // 44: Warm muted
  shift(0, 1.05, 1.0),                                         // 45: Subtle warm
  shift(0, 0.95, 1.0),                                         // 46: Subtle cool
  shift(0, 1.2, 0.88),                                         // 47: Saturated dark

  // ── 48-63: Reserved — identity/neutral transforms ──
  shift(0, 1.0, 1.0),   // 48
  shift(0, 1.0, 1.0),   // 49
  shift(0, 1.0, 1.0),   // 50
  shift(0, 1.0, 1.0),   // 51
  shift(0, 1.0, 1.0),   // 52
  shift(0, 1.0, 1.0),   // 53
  shift(0, 1.0, 1.0),   // 54
  shift(0, 1.0, 1.0),   // 55
  shift(0, 1.0, 1.0),   // 56
  shift(0, 1.0, 1.0),   // 57
  shift(0, 1.0, 1.0),   // 58
  shift(0, 1.0, 1.0),   // 59
  shift(0, 1.0, 1.0),   // 60
  shift(0, 1.0, 1.0),   // 61
  shift(0, 1.0, 1.0),   // 62
  shift(0, 1.0, 1.0),   // 63
];

/** Get the breed type color shift for a given breed type (0-63). */
export function getBreedTypeShift(breedType: number): BreedTypeShift {
  if (breedType < 0 || breedType >= BREED_TYPE_SHIFTS.length) {
    return BREED_TYPE_SHIFTS[0]; // Identity fallback
  }
  return BREED_TYPE_SHIFTS[breedType];
}
