// ──────────── Core pixel types ────────────

/** RGBA color tuple: [red, green, blue, alpha], each 0-255. */
export type RGBA = [number, number, number, number];

/** HSL color tuple: [hue 0-360, saturation 0-1, lightness 0-1]. */
export type HSL = [number, number, number];

/** A 2D grid of RGBA pixels stored in a flat Uint8Array. */
export interface PixelGrid {
  width: number;
  height: number;
  /** RGBA flat array, length = width * height * 4. */
  data: Uint8Array;
}

// ──────────── Template types ────────────

/** Palette role indices used in templates instead of raw colors. */
export enum PaletteRole {
  Outline = 0,
  PrimaryShadow = 1,
  PrimaryBase = 2,
  PrimaryHighlight = 3,
  SecondaryBase = 4,
  SecondaryHighlight = 5,
  Accent = 6,
}

/** A single non-transparent pixel in a template, stored sparsely. */
export interface TemplatePixel {
  x: number;
  y: number;
  /** Palette role index (0-6 standard, 7+ custom). */
  role: number;
  /** Evolution tier this pixel appears at (0=Base, 1=Evolved, 2=Elite, 3=Apex). v2 only. */
  tier?: number;
}

/** Allowed mutation operations within a zone. */
export type MutationType =
  | 'add_pixels'
  | 'remove_pixels'
  | 'shift_pixels'
  | 'thicken'
  | 'pattern_fill'
  | 'detail_overlay';

/** A rectangular region where procedural variants may modify pixels. */
export interface MutationZone {
  x: number;
  y: number;
  w: number;
  h: number;
  allowed: MutationType[];
}

/** A hand-authored pixel template for one body part + class affinity. */
export interface PixelTemplate {
  bodyPart: string;
  classAffinity: number;
  version: 1 | 2;
  width: number;
  height: number;
  /** Anchor point for compositing alignment. */
  anchor: { x: number; y: number };
  /** Bounding box of non-transparent pixels (for optimization). */
  bounds: { x: number; y: number; w: number; h: number };
  /** Zones where procedural variants are allowed to mutate. */
  mutationZones: MutationZone[];
  /** Sparse pixel data: only non-transparent pixels. */
  pixels: TemplatePixel[];
  /** Custom colors for roles 7+ (v2 only). Each entry is [R, G, B]. */
  customColors?: [number, number, number][];
}

// ──────────── Palette types ────────────

/** A resolved 7-color palette for rendering template roles to RGBA. */
export interface ResolvedPalette {
  outline: RGBA;
  primaryShadow: RGBA;
  primaryBase: RGBA;
  primaryHighlight: RGBA;
  secondaryBase: RGBA;
  secondaryHighlight: RGBA;
  accent: RGBA;
}

/** HSL-based color transform applied per breed type. */
export interface BreedTypeShift {
  hueRotation: number;
  saturationMult: number;
  lightnessMult: number;
  tint?: RGBA;
  tintStrength?: number;
}

// ──────────── Render types ────────────

/** Options for rendering a full lobster from DNA. */
export interface RenderOptions {
  /** Target output size (default: 64). Must be a multiple of 64. */
  size?: number;
  /** If true, include evolution effects. Default: true. */
  evolutionEffects?: boolean;
  /** If true, include legend effects. Default: true. */
  legendEffects?: boolean;
  /** Render only specific body parts (0-5). Default: all 6. */
  partsFilter?: number[];
}

/** Parameters extracted from DNA for rendering. */
export interface RenderParams {
  lobsterClass: number;
  legendStatus: number;
  breedType: number;
  parts: {
    bodyPart: number;
    classAffinity: number;
    variant: number;
  }[];
}
