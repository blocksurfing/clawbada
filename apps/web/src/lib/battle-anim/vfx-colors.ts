import type { RGB, VFXColors } from './types';

/**
 * VFX color sets per class, extracted from CLASS_PALETTES.
 * Indexed by classId (0-9, matching LobsterClass enum).
 *
 * Palette roles:
 *   0=Outline, 1=PrimShadow, 2=PrimBase, 3=PrimHigh,
 *   4=SecShadow, 5=SecBase, 6=SecHigh,
 *   7=AccShadow, 8=AccBase, 9=AccHigh, 10=UniOutline
 *
 * VFX colors map:
 *   primary=role2, primaryHi=role3, primaryDk=role1,
 *   secondary=role5, secondaryHi=role6,
 *   accent=role8, accentHi=role9, outline=role0
 */
const CLASS_VFX_COLORS: VFXColors[] = [
  // 0: Bulwark — steel blue
  {
    primary: [41, 79, 117],
    primaryHi: [90, 140, 180],
    primaryDk: [26, 37, 51],
    secondary: [80, 100, 115],
    secondaryHi: [120, 145, 160],
    accent: [180, 210, 230],
    accentHi: [210, 230, 245],
    outline: [20, 25, 35],
  },
  // 1: Mantis — venomous green
  {
    primary: [50, 140, 60],
    primaryHi: [100, 200, 80],
    primaryDk: [20, 60, 30],
    secondary: [32, 40, 42],
    secondaryHi: [55, 70, 70],
    accent: [255, 224, 23],
    accentHi: [255, 240, 100],
    outline: [15, 25, 15],
  },
  // 2: Leviathan — deep ocean
  {
    primary: [30, 70, 120],
    primaryHi: [60, 120, 180],
    primaryDk: [15, 35, 60],
    secondary: [50, 90, 100],
    secondaryHi: [80, 130, 145],
    accent: [100, 200, 220],
    accentHi: [150, 220, 240],
    outline: [10, 20, 40],
  },
  // 3: Tempest — storm gray / electric blue
  {
    primary: [90, 100, 115],
    primaryHi: [140, 155, 170],
    primaryDk: [45, 50, 60],
    secondary: [50, 120, 200],
    secondaryHi: [80, 160, 230],
    accent: [57, 43, 255],
    accentHi: [100, 80, 255],
    outline: [20, 25, 35],
  },
  // 4: Specter — ghostly purple
  {
    primary: [90, 60, 120],
    primaryHi: [140, 100, 180],
    primaryDk: [45, 30, 60],
    secondary: [70, 60, 90],
    secondaryHi: [110, 95, 140],
    accent: [89, 211, 136],
    accentHi: [130, 230, 170],
    outline: [25, 15, 35],
  },
  // 5: Sentinel — mint sage
  {
    primary: [169, 216, 195],
    primaryHi: [200, 235, 215],
    primaryDk: [100, 150, 130],
    secondary: [212, 231, 127],
    secondaryHi: [230, 240, 170],
    accent: [102, 208, 188],
    accentHi: [140, 225, 210],
    outline: [42, 62, 59],
  },
  // 6: Reaver — bright red
  {
    primary: [220, 20, 0],
    primaryHi: [255, 80, 60],
    primaryDk: [120, 10, 0],
    secondary: [32, 40, 42],
    secondaryHi: [55, 65, 68],
    accent: [255, 163, 23],
    accentHi: [255, 200, 80],
    outline: [25, 10, 10],
  },
  // 7: Abyss — dark teal
  {
    primary: [31, 44, 44],
    primaryHi: [60, 80, 80],
    primaryDk: [15, 22, 22],
    secondary: [40, 44, 59],
    secondaryHi: [65, 70, 90],
    accent: [60, 180, 80],
    accentHi: [100, 210, 120],
    outline: [10, 18, 18],
  },
  // 8: Kraken — bronze / coral
  {
    primary: [60, 80, 100],
    primaryHi: [100, 130, 160],
    primaryDk: [30, 40, 50],
    secondary: [205, 127, 50],
    secondaryHi: [230, 170, 90],
    accent: [225, 103, 79],
    accentHi: [240, 140, 120],
    outline: [15, 20, 30],
  },
  // 9: Ember — dark brown / amber
  {
    primary: [56, 30, 24],
    primaryHi: [100, 60, 45],
    primaryDk: [30, 15, 10],
    secondary: [38, 35, 42],
    secondaryHi: [65, 60, 70],
    accent: [205, 112, 0],
    accentHi: [240, 160, 40],
    outline: [21, 14, 11],
  },
];

/** Get VFX colors for a given class (0-9). */
export function getVFXColors(classId: number): VFXColors {
  return CLASS_VFX_COLORS[classId] ?? CLASS_VFX_COLORS[0];
}
