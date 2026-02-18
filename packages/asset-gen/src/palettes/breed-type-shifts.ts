/**
 * 64 breed type HSL color transforms (0-63).
 *
 * From GAME_ASSET_SPEC.md Section 6:
 *   0-15:  Regional variants (hue shifts, tinting)
 *   16-31: Pattern variants (saturation/brightness changes)
 *   32-47: Texture accents (more dramatic transforms)
 *   48-63: Reserved/neutral (identity transforms for future use)
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
  shift(10, 1.0, 1.0),                                         // 1: Warm shift
  shift(-10, 1.0, 1.0),                                        // 2: Cool shift
  shift(20, 1.05, 1.0),                                        // 3: Tropical
  shift(-20, 0.95, 1.0),                                       // 4: Arctic
  shift(0, 1.0, 1.05, [255, 200, 150, 255], 0.08),             // 5: Sandy
  shift(0, 1.0, 0.95, [100, 150, 200, 255], 0.08),             // 6: Deep ocean
  shift(15, 1.1, 1.0),                                         // 7: Coral reef
  shift(-15, 0.9, 1.0),                                        // 8: Twilight zone
  shift(30, 1.0, 1.05),                                        // 9: Volcanic vent
  shift(-30, 1.0, 0.95),                                       // 10: Abyssal
  shift(5, 1.0, 1.0, [200, 255, 200, 255], 0.05),              // 11: Kelp forest
  shift(-5, 1.0, 1.0, [180, 180, 220, 255], 0.05),             // 12: Moonlit
  shift(0, 1.15, 1.0),                                         // 13: Vivid
  shift(0, 0.85, 1.0),                                         // 14: Muted
  shift(0, 1.0, 1.0, [255, 230, 180, 255], 0.1),               // 15: Sunbleached

  // ── 16-31: Pattern variants ──
  shift(0, 1.2, 0.95),                                         // 16: High contrast
  shift(0, 0.8, 1.05),                                         // 17: Pastel
  shift(0, 1.3, 0.9),                                          // 18: Deep saturated
  shift(0, 0.7, 1.1),                                          // 19: Washed
  shift(5, 1.1, 0.95),                                         // 20: Warm high-sat
  shift(-5, 1.1, 0.95),                                        // 21: Cool high-sat
  shift(0, 1.0, 0.85),                                         // 22: Darkened
  shift(0, 1.0, 1.15),                                         // 23: Brightened
  shift(10, 0.9, 1.0),                                         // 24: Dusty warm
  shift(-10, 0.9, 1.0),                                        // 25: Dusty cool
  shift(0, 1.25, 1.0),                                         // 26: Neon
  shift(0, 0.6, 1.0),                                          // 27: Desaturated
  shift(15, 1.0, 0.9),                                         // 28: Aged warm
  shift(-15, 1.0, 0.9),                                        // 29: Aged cool
  shift(0, 1.15, 1.05),                                        // 30: Luminous
  shift(0, 0.75, 0.95),                                        // 31: Subdued

  // ── 32-47: Texture accents ──
  shift(25, 1.2, 1.0),                                         // 32: Flame-touched
  shift(-25, 1.2, 1.0),                                        // 33: Frost-touched
  shift(40, 1.0, 1.0),                                         // 34: Copper patina
  shift(-40, 1.0, 1.0),                                        // 35: Ocean depth
  shift(0, 1.4, 0.85),                                         // 36: Dark vivid
  shift(0, 0.5, 1.2),                                          // 37: Ghost fade
  shift(60, 1.0, 1.0),                                         // 38: Alien
  shift(-60, 1.0, 1.0),                                        // 39: Inverted warmth
  shift(0, 1.0, 1.0, [255, 100, 50, 255], 0.12),               // 40: Ember-tinted
  shift(0, 1.0, 1.0, [50, 100, 255, 255], 0.12),               // 41: Ice-tinted
  shift(0, 1.0, 1.0, [100, 255, 100, 255], 0.12),              // 42: Toxic-tinted
  shift(0, 1.0, 1.0, [200, 100, 255, 255], 0.12),              // 43: Void-tinted
  shift(180, 0.8, 1.0),                                        // 44: Complement flip
  shift(90, 1.0, 1.0),                                         // 45: Orthogonal shift
  shift(-90, 1.0, 1.0),                                        // 46: Counter-orthogonal
  shift(0, 1.5, 0.8),                                          // 47: Ultra-saturated dark

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
