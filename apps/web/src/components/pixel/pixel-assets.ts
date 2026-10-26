/**
 * Nzib's pixel asset registry (`design/website/workbench/pixel-assets.js`, drop ee1219f) with the sheets served
 * from `/ui`. Scale comes exclusively from the global `--pixel`; never add a per-asset scale. `--pixel` is 3, 2.5 or 2
 * px by window (chromePixelScale below), and only ever a value that lands on whole DEVICE pixels, so the art stays crisp.
 *
 * - `sprite`: one frame of a sheet (`frame` = [w, h]; frames are counted row-major across the sheet).
 * - `panel`: a nine-slice region drawn from the original sheet in 16 px chunks. `sliceSpan` groups several
 *   tiles per corner/edge (the 96×96 market card uses 32); `horizontal` strips keep every source row and
 *   repeat only the middle column; `identityJoins` paints the two 2×2 corner pixels outside the junctions.
 */
export interface SpriteAsset {
  kind: 'sprite';
  src: string;
  width: number;
  height: number;
  frame: readonly [number, number];
}

export interface PanelAsset {
  kind: 'panel';
  src: string;
  width: number;
  height: number;
  region: readonly [number, number, number, number];
  tile: number;
  sliceSpan?: number;
  horizontal?: boolean;
  identityJoins?: readonly [number, number, number, number];
}

const MARKET_TILESET = '/ui/market/Tileset.png';

export const PIXEL_ASSETS = {
  woodenPanel: { kind: 'panel', src: '/ui/tileset/WoodenPanel.png', width: 192, height: 192, region: [0, 0, 48, 48], tile: 16 },
  marketCard: { kind: 'panel', src: MARKET_TILESET, width: 208, height: 128, region: [0, 0, 96, 96], tile: 16, sliceSpan: 32 },
  marketIdentity: { kind: 'panel', src: MARKET_TILESET, width: 208, height: 128, region: [0, 48, 48, 48], tile: 16, identityJoins: [64, 64, 16, 16] },
  marketDivider: { kind: 'panel', src: MARKET_TILESET, width: 208, height: 128, region: [96, 64, 96, 16], tile: 16, sliceSpan: 32, horizontal: true },
  marketPriceLabel: { kind: 'panel', src: MARKET_TILESET, width: 208, height: 128, region: [0, 96, 48, 32], tile: 16, horizontal: true },
  marketBidButton: { kind: 'panel', src: MARKET_TILESET, width: 208, height: 128, region: [48, 96, 48, 32], tile: 16, horizontal: true },
  marketPurity: { kind: 'sprite', src: MARKET_TILESET, width: 208, height: 128, frame: [16, 16] },
  marketBreed: { kind: 'sprite', src: MARKET_TILESET, width: 208, height: 128, frame: [16, 16] },
  marketEgg: { kind: 'sprite', src: '/ui/market/Egg.png', width: 192, height: 32, frame: [32, 32] },
  marketBase: { kind: 'sprite', src: '/ui/market/sheets/Base.png', width: 640, height: 64, frame: [64, 64] },
  marketEvolved: { kind: 'sprite', src: '/ui/market/sheets/Evolved.png', width: 640, height: 64, frame: [64, 64] },
  marketElite: { kind: 'sprite', src: '/ui/market/sheets/Elite.png', width: 640, height: 64, frame: [64, 64] },
  marketApex: { kind: 'sprite', src: '/ui/market/sheets/Apex.png', width: 640, height: 64, frame: [64, 64] },
  classBadges: { kind: 'sprite', src: '/ui/shell/class-badges.png', width: 160, height: 16, frame: [16, 16] },
  menuIcons: { kind: 'sprite', src: '/ui/sidebar/Icons.png', width: 192, height: 16, frame: [16, 16] },
  dojoDarkPanel: { kind: 'panel', src: '/ui/dojo/Dark_Panel.png', width: 48, height: 48, region: [0, 0, 48, 48], tile: 16 },
  dojoSign: { kind: 'sprite', src: '/ui/dojo/Wooden_Sign.png', width: 96, height: 64, frame: [96, 64] },
  dojoSelectedFrame: { kind: 'sprite', src: '/ui/dojo/Selected_Frame.png', width: 128, height: 32, frame: [32, 32] },
  apexClassSheet: { kind: 'sprite', src: '/ui/shell/apex-class-sheet.png', width: 640, height: 64, frame: [64, 64] },
} as const satisfies Record<string, SpriteAsset | PanelAsset>;

export type PixelAssetName = keyof typeof PIXEL_ASSETS;
export type SpriteAssetName = { [K in PixelAssetName]: (typeof PIXEL_ASSETS)[K] extends { kind: 'sprite' } ? K : never }[PixelAssetName];
export type PanelAssetName = { [K in PixelAssetName]: (typeof PIXEL_ASSETS)[K] extends { kind: 'panel' } ? K : never }[PixelAssetName];

/** Frames are counted row-major; the sheet's width decides the columns (his `geometry.js`). */
export function frameRect(asset: SpriteAsset, index = 0) {
  const [width, height] = asset.frame;
  const columns = Math.floor(asset.width / width);
  const count = columns * Math.floor(asset.height / height);
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error(`Invalid sprite frame: ${index}`);
  return { x: (index % columns) * width, y: Math.floor(index / columns) * height, width, height };
}

/** Source-pixel slices: repeat only whole pixels; the final partial tile is clipped. Multi-tile ornaments
 *  (`sliceSpan`) stay intact, but every draw uses the common tile grid. */
export function tileAxis(length: number, tile: number, sliceSpan = tile) {
  if (!Number.isInteger(tile) || tile < 1 || !Number.isInteger(sliceSpan) || sliceSpan < tile || sliceSpan % tile) throw new Error('Invalid panel tile group');
  if (!Number.isInteger(length) || length < sliceSpan * 2) throw new Error('Panel too small for fixed corners');
  const groups = [{ source: 0, dest: 0, size: sliceSpan }];
  for (let at = sliceSpan; at < length - sliceSpan; at += sliceSpan) groups.push({ source: sliceSpan, dest: at, size: Math.min(sliceSpan, length - sliceSpan - at) });
  groups.push({ source: sliceSpan * 2, dest: length - sliceSpan, size: sliceSpan });
  return groups.flatMap((group) => {
    const parts: { source: number; dest: number; size: number }[] = [];
    for (let offset = 0; offset < group.size; offset += tile) parts.push({ source: group.source + offset, dest: group.dest + offset, size: Math.min(tile, group.size - offset) });
    return parts;
  });
}

const images = new Map<string, Promise<HTMLImageElement>>();
export function loadPixelImage(src: string) {
  let p = images.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Pixel asset failed to load: ${src}`));
      image.src = src;
    });
    images.set(src, p);
  }
  return p;
}

/** Window → pixel scale for the whole pixel chrome. The largest of 3 / 2.5 / 2 at which the expanded sidebar's MENU
 *  (down to Docs: 276 source px from the top of the window — 827 px at 3×) fits the window height and the window is
 *  wide enough for the Shell; the banner's decorative point below Docs may run past the bottom edge (the sidebar
 *  scrolls). A scale is only used where it lands on whole device pixels: 2.5× on retina (2.5 × 2 = 5 device px per art
 *  pixel), never on a 1× monitor — the art stays crisp.
 *  History (owner 2026-10-25): a fixed 3× put the sidebar over the Shell's first stage and cut off its menu on a 13"
 *  MacBook at 100 %; the 3×/2× fix made the 2× sidebar too small to read there. That MacBook now gets 2.5×.
 *  chrome.css mirrors this as media queries so the first paint matches before any script runs. */
export const SIDEBAR_MENU_SOURCE_HEIGHT = 276;
export const PIXEL_SCALE_EVENT = 'clawbada:pixel-scale';
const SCALES = [
  { scale: 3, minWidth: 1600 },
  { scale: 2.5, minWidth: 1366 },
] as const;
export function chromePixelScale(width: number, height: number, devicePixelRatio = 1): number {
  for (const { scale, minWidth } of SCALES) {
    const device = scale * devicePixelRatio;
    if (Math.abs(device - Math.round(device)) > 0.01) continue;   // would smear art pixels across device pixels
    if (width >= minWidth && height >= SIDEBAR_MENU_SOURCE_HEIGHT * scale) return scale;
  }
  return 2;
}

/** Choose the scale for the current window and set `--pixel`; announces PIXEL_SCALE_EVENT when it changes. */
export function applyChromePixelScale(): number {
  if (typeof window === 'undefined') return 3;
  const next = chromePixelScale(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  const before = pixelScale();
  document.documentElement.style.setProperty('--pixel', `${next}px`);
  document.documentElement.style.setProperty('--pixel-n', String(next));
  if (next !== before) window.dispatchEvent(new CustomEvent(PIXEL_SCALE_EVENT, { detail: next }));
  return next;
}

export const pixelScale = () => {
  if (typeof document === 'undefined') return 3;
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pixel'));
  return value >= 1 && Number.isInteger(value * 2) ? value : 3;   // whole or half pixels (2.5× on retina)
};
