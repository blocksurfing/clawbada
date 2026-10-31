import { PIXEL_ASSETS, loadPixelImage } from '@/components/pixel/pixel-assets';
import idle from '../../../public/ui/dojo/idle/idle.json';

/**
 * Class art for the Dojo, from the Apex class sheet (64 px frames, class order = sheet order), as in Nzib's
 * `drawClass` (dojo.js): only the transparent gutters are trimmed, and the trimmed box is placed back around the
 * authored floor point (32, 44) so a claw or a flame never becomes the pivot. Owned lobsters draw their class
 * frame too — per-lobster art templates don't exist yet.
 */
export const CLASS_SHEET = PIXEL_ASSETS.apexClassSheet.src;
/** One sheet per evolution tier (0 Base … 3 Apex), all in class order with the same 64 px frames — the Market's
 *  tier sheets; the Apex one is the Shell's class sheet. Switching tier in the Dojo shows that tier's art. */
export const TIER_SHEETS = [PIXEL_ASSETS.marketBase.src, PIXEL_ASSETS.marketEvolved.src, PIXEL_ASSETS.marketElite.src, PIXEL_ASSETS.marketApex.src] as const;
export const loadTierSheets = () => Promise.all(TIER_SHEETS.map((src) => loadPixelImage(src)));

export interface Crop { left: number; right: number; bottom: number; scale: number }

const crops = new Map<string, { left: number; top: number; right: number; bottom: number }>();
function cropOf(sheet: HTMLImageElement, classIndex: number) {
  const key = `${sheet.src}#${classIndex}`;
  const known = crops.get(key);
  if (known) return known;
  const frame = document.createElement('canvas');
  frame.width = frame.height = 64;
  const ctx = frame.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(sheet, classIndex * 64, 0, 64, 64, 0, 0, 64, 64);
  const pixels = ctx.getImageData(0, 0, 64, 64).data;
  let left = 64, top = 64, right = 0, bottom = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (!pixels[(y * 64 + x) * 4 + 3]) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
  const crop = right > left ? { left, top, right, bottom } : { left: 0, top: 0, right: 64, bottom: 64 };
  crops.set(key, crop);
  return crop;
}

/** Draw the trimmed class frame into `canvas` at `scale` CSS px per source px. */
export function drawClass(canvas: HTMLCanvasElement, sheet: HTMLImageElement, classIndex: number, scale: number): Crop {
  const { left, top, right, bottom } = cropOf(sheet, classIndex);
  canvas.width = right - left;
  canvas.height = bottom - top;
  canvas.style.width = `${canvas.width * scale}px`;
  canvas.style.height = `${canvas.height * scale}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(sheet, classIndex * 64 + left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return { left, right, bottom, scale };
}

/** Stand a lineup fighter on its floor point: Your Team faces right (mirrored), the opponent faces left. */
export function anchorFighter(canvas: HTMLCanvasElement, crop: Crop, side: 'team' | 'opponent') {
  const left = side === 'team' ? 32 - crop.right : crop.left - 32;
  canvas.style.left = `calc(50% + ${left * crop.scale}px)`;
  canvas.style.bottom = `calc(16 * var(--dojo-selected-pixel) + ${(44 - crop.bottom) * crop.scale}px)`;
}

/** A CSS length custom property, in px, read off `element`. */
export function cssPx(element: Element, name: string, fallback: number): number {
  const value = parseFloat(getComputedStyle(element).getPropertyValue(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// ─── Idle animation (owner 2026-10-30: the lineup idles, like the battle) ───

/** The battle's Idle, rendered out of the Unity rigs by WebSpriteExporter: one sheet per battle tier, columns = class
 *  (the same order and 64 px frames as the tier sheets), rows = the 5 Idle frames at 12 fps. Frame 0 is lined up with
 *  the still frame (same foot line and centre), so swapping the still for the idle never moves the lobster. */
export const IDLE_SHEETS: Record<number, string> = { 1: '/ui/dojo/idle/Evolved.png', 2: '/ui/dojo/idle/Elite.png', 3: '/ui/dojo/idle/Apex.png' };
export const IDLE_FRAMES = 5;
export const IDLE_FPS = 12;

/** The idle sheet for a tier sheet (Base has none: it never battles). */
export function idleSheetSrc(still: HTMLImageElement): string | null {
  const path = new URL(still.src, 'http://x').pathname;
  const tier = TIER_SHEETS.indexOf(path as (typeof TIER_SHEETS)[number]);
  return IDLE_SHEETS[tier] ?? null;
}

const idleCrops = new Map<string, { left: number; top: number; right: number; bottom: number }>();
/** One crop for all 5 frames (their union), so the canvas keeps its size and place while it animates. */
function idleCropOf(sheet: HTMLImageElement, classIndex: number) {
  const key = `${sheet.src}#${classIndex}`;
  const known = idleCrops.get(key);
  if (known) return known;
  const frame = document.createElement('canvas');
  frame.width = 64;
  frame.height = 64 * IDLE_FRAMES;
  const ctx = frame.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(sheet, classIndex * 64, 0, 64, 64 * IDLE_FRAMES, 0, 0, 64, 64 * IDLE_FRAMES);
  const pixels = ctx.getImageData(0, 0, 64, 64 * IDLE_FRAMES).data;
  let left = 64, top = 64, right = 0, bottom = 0;
  for (let f = 0; f < IDLE_FRAMES; f++) for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (!pixels[((f * 64 + y) * 64 + x) * 4 + 3]) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
  const crop = right > left ? { left, top, right, bottom } : { left: 0, top: 0, right: 64, bottom: 64 };
  idleCrops.set(key, crop);
  return crop;
}

/** Draw Idle frame `frame` of `classIndex` into `canvas` at `scale` CSS px per source px (sized once per crop). */
export function drawIdleFrame(canvas: HTMLCanvasElement, sheet: HTMLImageElement, classIndex: number, frame: number, scale: number): Crop {
  const { left, top, right, bottom } = idleCropOf(sheet, classIndex);
  const w = right - left, h = bottom - top;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  canvas.style.width = `${w * scale}px`;
  canvas.style.height = `${h * scale}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(sheet, classIndex * 64 + left, (frame % IDLE_FRAMES) * 64 + top, w, h, 0, 0, w, h);
  return { left, right, bottom, scale };
}

type IdleListener = (frame: number) => void;
const idleListeners = new Set<IdleListener>();
let idleRaf = 0, idleLast = 0, idleTick = 0;
/** One 12 fps clock for every lineup fighter (each adds its own phase so the three don't bob in step). */
export function onIdleTick(cb: IdleListener): () => void {
  idleListeners.add(cb);
  if (!idleRaf && typeof window !== 'undefined') {
    const step = (now: number) => {
      if (now - idleLast >= 1000 / IDLE_FPS) {
        idleLast = now - ((now - idleLast) % (1000 / IDLE_FPS));
        idleTick++;
        idleListeners.forEach((l) => l(idleTick));
      }
      idleRaf = idleListeners.size ? requestAnimationFrame(step) : 0;
    };
    idleRaf = requestAnimationFrame(step);
  }
  return () => { idleListeners.delete(cb); };
}

// ─── Shadows ───

/** Exactly as the battle (CharacterShadow.cs): Nzib's shadow, centred `shadowBelowRoot` (8) art px under the rig's
 *  root. The root sits 10–21 px above a lobster's lowest pixel, so the shadow tucks behind the body with a sliver
 *  showing under the feet. Roots per tier and class come from WebSpriteExporter (idle.json, sheet-frame coords). */
const ROOT_TIERS: Record<number, keyof typeof idle.roots> = { 1: 'evolved', 2: 'elite', 3: 'apex' };
export function shadowRoot(still: HTMLImageElement, classIndex: number): [number, number] {
  const path = new URL(still.src, 'http://x').pathname;
  const tier = ROOT_TIERS[TIER_SHEETS.indexOf(path as (typeof TIER_SHEETS)[number])] ?? 'evolved';   // Base never battles: Evolved's
  const root = idle.roots[tier]?.[classIndex];
  return root ? [root[0], root[1]] : [32, 32];
}

/** Place a fighter's shadow (64 × 32 art px, normally left: 50%, translateX(-50%)) under its rig root. The class art
 *  stands frame row 44 on the floor line (16 px above the figure's bottom); Your Team is mirrored. */
export function anchorShadow(shadow: HTMLElement, crop: Crop, side: 'team' | 'opponent', root: [number, number]) {
  const [rx, ry] = root;
  const centreRow = ry + idle.shadowBelowRoot;
  // Its exact 64 × 32 art px at the lobster's own scale. Set here, not left to CSS: the site's image reset
  // (max-width: 100%) capped it at the slot's width and a width rule overrode the rest, squashing Nzib's flat 2:1 oval
  // into a round blob — the reason the lobby's shadows never looked like the battle's.
  shadow.style.width = `${64 * crop.scale}px`;
  shadow.style.height = `${32 * crop.scale}px`;
  shadow.style.maxWidth = 'none';
  shadow.style.bottom = `calc(16 * var(--dojo-selected-pixel) + ${(44 - centreRow - 16) * crop.scale}px)`;
  shadow.style.marginLeft = `${(side === 'team' ? 32 - rx : rx - 32) * crop.scale}px`;
}
