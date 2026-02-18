/**
 * 10 class palettes, each with 7 roles.
 *
 * Derived from GAME_ASSET_SPEC.md Section 2 color specifications.
 * Each palette maps PaletteRole → RGBA for template rendering.
 *
 * Role assignments:
 *   0: outline        — darkest, near-black per class identity
 *   1: primaryShadow  — dark shade of primary color
 *   2: primaryBase    — main primary color from spec
 *   3: primaryHighlight — lighter shade of primary
 *   4: secondaryBase  — secondary color from spec
 *   5: secondaryHighlight — lighter shade of secondary
 *   6: accent         — accent color from spec
 */

import type { RGBA, ResolvedPalette } from '../types';
import { hexToRGBA, darken, lighten } from './palette-utils';

interface ClassPaletteDefinition {
  primary: string;
  secondary: string;
  accent: string;
  outline: string;
}

const CLASS_PALETTE_DEFS: ClassPaletteDefinition[] = [
  // 0: Bulwark — Steel blue / Slate gray / Titanium white
  { primary: '#4682B4', secondary: '#708090', accent: '#E8E8E8', outline: '#1A2533' },
  // 1: Mantis — Jade green / Black / Venomous yellow
  { primary: '#00A86B', secondary: '#1A1A1A', accent: '#FFFF00', outline: '#002E1D' },
  // 2: Leviathan — Deep navy / Bronze / Dark iron
  { primary: '#000080', secondary: '#CD7F32', accent: '#4A4A4A', outline: '#000030' },
  // 3: Tempest — Electric blue / White / Arc-flash cyan
  { primary: '#7DF9FF', secondary: '#F0F8FF', accent: '#00FFFF', outline: '#1A3A3D' },
  // 4: Specter — Ghost purple / Ethereal teal / Spectral white
  { primary: '#7B68EE', secondary: '#008B8B', accent: '#E0E0FF', outline: '#1E1840' },
  // 5: Sentinel — Gold / Warm white / Pearl
  { primary: '#FFD700', secondary: '#FFFAF0', accent: '#F0E6D0', outline: '#3D3200' },
  // 6: Reaver — Crimson / Dark red / Bone white
  { primary: '#DC143C', secondary: '#8B0000', accent: '#F5F0E0', outline: '#3D0510' },
  // 7: Abyss — Void black / Toxic green / Bioluminescent
  { primary: '#0D0D0D', secondary: '#39FF14', accent: '#00FF80', outline: '#000000' },
  // 8: Kraken — Dark teal / Bio-blue / Ink black
  { primary: '#008080', secondary: '#00BFFF', accent: '#0A0A0A', outline: '#002020' },
  // 9: Ember — Orange / Molten red / Magma yellow
  { primary: '#FF6600', secondary: '#FF2400', accent: '#FFFF00', outline: '#3D1A00' },
];

function buildPalette(def: ClassPaletteDefinition): ResolvedPalette {
  const primary = hexToRGBA(def.primary);
  const secondary = hexToRGBA(def.secondary);
  const accent = hexToRGBA(def.accent);
  const outline = hexToRGBA(def.outline);

  return {
    outline,
    primaryShadow: darken(primary, 0.2),
    primaryBase: primary,
    primaryHighlight: lighten(primary, 0.2),
    secondaryBase: secondary,
    secondaryHighlight: lighten(secondary, 0.15),
    accent,
  };
}

/** All 10 class palettes, indexed by LobsterClass enum value (0-9). */
export const CLASS_PALETTES: ResolvedPalette[] = CLASS_PALETTE_DEFS.map(buildPalette);

/** Get the resolved palette for a class. */
export function getClassPalette(classId: number): ResolvedPalette {
  if (classId < 0 || classId >= CLASS_PALETTES.length) {
    throw new Error(`Invalid class ID: ${classId}`);
  }
  return CLASS_PALETTES[classId];
}

/** Get a specific role color from a class palette. */
export function getClassRoleColor(classId: number, role: number): RGBA {
  const palette = getClassPalette(classId);
  const colors: RGBA[] = [
    palette.outline,
    palette.primaryShadow,
    palette.primaryBase,
    palette.primaryHighlight,
    palette.secondaryBase,
    palette.secondaryHighlight,
    palette.accent,
  ];
  if (role < 0 || role >= colors.length) {
    throw new Error(`Invalid palette role: ${role}`);
  }
  return colors[role];
}
