/** Native pixel art resolution. */
export const NATIVE_SIZE = 64;

/** Legacy v1 template size (for v1→v2 normalization). */
export const LEGACY_SIZE = 48;

/** Offset to center a 48x48 v1 template within 64x64 v2 canvas. */
export const V1_OFFSET = 8;

/** Number of RGBA channels per pixel. */
export const CHANNELS = 4;

/** Number of palette roles in template system. */
export const NUM_ROLES = 7;

/** Number of body parts per lobster. */
export const NUM_BODY_PARTS = 6;

/** Number of lobster classes. */
export const NUM_CLASSES = 10;

/** Number of procedural variants per base template. */
export const VARIANTS_PER_TEMPLATE = 16;

/** Total body part assets: 6 parts * 10 classes * 16 variants. */
export const TOTAL_ASSETS = NUM_BODY_PARTS * NUM_CLASSES * VARIANTS_PER_TEMPLATE;

/** Number of breed type color transforms. */
export const NUM_BREED_TYPES = 64;

/** Valid upscale target sizes (multiples of 64). */
export const VALID_SIZES = [64, 128, 256, 512] as const;

/**
 * Tier guide sizes matching the template editor v3 tier rings.
 * Index = evolution tier (0=Base, 1=Evolved, 2=Elite, 3=Apex).
 */
export const TIER_SIZES = [42, 52, 58, 64] as const;

/**
 * Layer compositing order (back to front).
 * Index = layer order, value = BodyPart enum value.
 *
 * Carapace(0) → Legs(5) → Tail(2) → Eyes(4) → Antennae(3) → Claws(1)
 */
export const LAYER_ORDER = [0, 5, 2, 4, 3, 1] as const;

/** Body part names indexed by BodyPart enum. */
export const BODY_PART_NAMES = [
  'carapace',
  'claws',
  'tail',
  'antennae',
  'eyes',
  'legs',
] as const;

/** Class names indexed by LobsterClass enum. */
export const CLASS_NAMES = [
  'bulwark',
  'mantis',
  'leviathan',
  'tempest',
  'specter',
  'sentinel',
  'reaver',
  'abyss',
  'kraken',
  'ember',
] as const;

/** Palette role names indexed by PaletteRole enum. */
export const ROLE_NAMES = [
  'outline',
  'primaryShadow',
  'primaryBase',
  'primaryHighlight',
  'secondaryBase',
  'secondaryHighlight',
  'accent',
] as const;

/**
 * Default anchor points per body part for compositing alignment.
 * Each part's anchor is its reference point on the shared 64x64 canvas.
 * (Rescaled from original 48x48 coords by adding V1_OFFSET=8.)
 */
export const DEFAULT_ANCHORS: Record<number, { x: number; y: number }> = {
  0: { x: 32, y: 28 }, // Carapace — center-back
  1: { x: 20, y: 36 }, // Claws — front-center
  2: { x: 42, y: 44 }, // Tail — back-low
  3: { x: 26, y: 18 }, // Antennae — top-front
  4: { x: 24, y: 26 }, // Eyes — front-high
  5: { x: 32, y: 46 }, // Legs — bottom-center
};

/** Salt prefix for deterministic variant generation. */
export const VARIANT_SALT = 'assetgen-v1';
