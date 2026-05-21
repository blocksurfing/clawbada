/**
 * 10 class palettes, each with 11 roles.
 *
 * Derived from the Clawbada Color Scheme reference sheet.
 * Each palette maps PaletteRole → RGBA for template rendering.
 *
 * All 9 colors per class (3 triplets × highlight/base/shadow) are
 * designer-specified — no auto-derivation. Outline is the 10th role.
 * Universal outline (#0e0e0e, same for all classes) is the 11th role.
 *
 * Role assignments (3-color triplets: shadow/base/highlight):
 *   0: outline            — darkest, near-black per class identity
 *   1: primaryShadow      — dark shade of primary color
 *   2: primaryBase         — main primary color
 *   3: primaryHighlight    — lighter shade of primary
 *   4: secondaryShadow    — dark shade of secondary color
 *   5: secondaryBase       — secondary color
 *   6: secondaryHighlight  — lighter shade of secondary
 *   7: accentShadow       — dark shade of accent color
 *   8: accentBase          — accent color
 *   9: accentHighlight     — lighter shade of accent
 *  10: universalOutline    — #0e0e0e, same across all classes
 */

import type { RGBA, ResolvedPalette } from '../types';
import { hexToRGBA } from './palette-utils';

interface ClassPaletteDefinition {
  /** [highlight, base, shadow] */
  primary: [string, string, string];
  secondary: [string, string, string];
  accent: [string, string, string];
  outline: string;
}

const CLASS_PALETTE_DEFS: ClassPaletteDefinition[] = [
  // 0: Bulwark — Steel blue / Slate gray / Titanium white
  {
    primary: ['#78aad2', '#4682b4', '#294f75'],
    secondary: ['#96a5af', '#708090', '#434d57'],
    accent: ['#fafafa', '#e8e8e8', '#b5b5b5'],
    outline: '#1A2533',
  },
  // 1: Mantis — Jade green / Dark teal / Warm yellow
  {
    primary: ['#32d28c', '#00a86b', '#006e46'],
    secondary: ['#2b353b', '#20282a', '#171c1e'],
    accent: ['#fdff6b', '#ffe017', '#d7a22f'],
    outline: '#002E1D',
  },
  // 2: Leviathan — Deep navy / Bronze / Dark iron
  {
    primary: ['#2828aa', '#000080', '#000052'],
    secondary: ['#e1a55a', '#cd7f32', '#7b4c1e'],
    accent: ['#888888', '#707070', '#4a4a4a'],
    outline: '#000030',
  },
  // 3: Tempest — Storm gray / Earth brown / Electric cyan
  {
    primary: ['#4d6b77', '#3c505a', '#1a3a3d'],
    secondary: ['#73603f', '#584c33', '#413522'],
    accent: ['#7df9ff', '#48bec8', '#4e8aaa'],
    outline: '#0D1D1F',
  },
  // 4: Specter — Ghost purple / Deep teal / Spectral green
  {
    primary: ['#a591ff', '#7b68ee', '#4f3caa'],
    secondary: ['#008b8b', '#116777', '#184767'],
    accent: ['#75e76a', '#59d388', '#40ac83'],
    outline: '#1E1840',
  },
  // 5: Sentinel — Mint sage / Lime chartreuse / Teal aqua
  {
    primary: ['#cef9ea', '#a9d8c3', '#82b3ad'],
    secondary: ['#e6f7b4', '#d4e77f', '#bfb55f'],
    accent: ['#7dffe6', '#66d0bc', '#5eafc3'],
    outline: '#2A3E3B',
  },
  // 6: Reaver — Bright red / Near-black / Gold orange
  {
    primary: ['#ff2200', '#dc1400', '#960a23'],
    secondary: ['#2b353b', '#20282a', '#14191a'],
    accent: ['#ffd120', '#ffa317', '#ff6c00'],
    outline: '#3D0510',
  },
  // 7: Abyss — Dark teal / Dark gray-blue / Neon green
  {
    primary: ['#1f3e39', '#1f2c2c', '#0e1b26'],
    secondary: ['#323b3b', '#282c3b', '#151628'],
    accent: ['#4dff00', '#00d616', '#00a811'],
    outline: '#060D13',
  },
  // 8: Kraken — Dark teal / Bronze / Coral
  {
    primary: ['#32aaaa', '#008080', '#005a5a'],
    secondary: ['#e1a55a', '#cd7f32', '#9f5423'],
    accent: ['#fd9460', '#e1674f', '#d44240'],
    outline: '#002020',
  },
  // 9: Ember — Dark brown / Dark purple-gray / Amber
  {
    primary: ['#451e1c', '#381e18', '#291b16'],
    secondary: ['#3f353b', '#26232a', '#1e1922'],
    accent: ['#e9aa17', '#cd7000', '#b43c00'],
    outline: '#150E0B',
  },
];

/** Universal outline color shared by all classes. */
const UNIVERSAL_OUTLINE: RGBA = hexToRGBA('#0e0e0e');

function buildPalette(def: ClassPaletteDefinition): ResolvedPalette {
  return {
    outline: hexToRGBA(def.outline),
    primaryShadow: hexToRGBA(def.primary[2]),
    primaryBase: hexToRGBA(def.primary[1]),
    primaryHighlight: hexToRGBA(def.primary[0]),
    secondaryShadow: hexToRGBA(def.secondary[2]),
    secondaryBase: hexToRGBA(def.secondary[1]),
    secondaryHighlight: hexToRGBA(def.secondary[0]),
    accentShadow: hexToRGBA(def.accent[2]),
    accentBase: hexToRGBA(def.accent[1]),
    accentHighlight: hexToRGBA(def.accent[0]),
    universalOutline: UNIVERSAL_OUTLINE,
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
    palette.secondaryShadow,
    palette.secondaryBase,
    palette.secondaryHighlight,
    palette.accentShadow,
    palette.accentBase,
    palette.accentHighlight,
    palette.universalOutline,
  ];
  if (role < 0 || role >= colors.length) {
    throw new Error(`Invalid palette role: ${role}`);
  }
  return colors[role];
}
