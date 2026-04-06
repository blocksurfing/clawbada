import type { BattleViewState, BattleAnimState } from './types';
import { ARENA_BG_GRADIENTS } from './arena';
import { ANIMATIONS } from './animations';
import { getOffset } from './interpolation';
import { CANVAS_W, SPRITE_SIZE } from './positions';

/**
 * Draw the arena background. Uses the provided background image if loaded,
 * otherwise falls back to a tier-specific gradient.
 */
export function drawArenaBg(
  ctx: CanvasRenderingContext2D,
  bgImage: HTMLImageElement | null,
  tier: number,
  canvasW: number,
  canvasH: number,
): void {
  if (bgImage?.complete && bgImage.naturalWidth > 0) {
    ctx.drawImage(bgImage, 0, 0, canvasW, canvasH);
  } else {
    // Gradient fallback
    const stops = ARENA_BG_GRADIENTS[tier] ?? ARENA_BG_GRADIENTS[1];
    const grad = ctx.createLinearGradient(0, 0, 0, canvasH);
    for (const s of stops) grad.addColorStop(s.stop, s.color);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasW, canvasH);
  }
}

/**
 * Render a single lobster sprite with animation offsets and hit effects.
 *
 * Lobsters in the web app are pre-composited PNG images, not per-pixel body
 * part composites. Animation offsets use body part 0 (carapace) keyframes as
 * the dominant motion for the entire sprite.
 *
 * Hit effects use canvas `filter` (brightness for flash, grayscale for death).
 * Team B sprites are mirrored horizontally via `ctx.scale(-1, 1)`.
 */
export function renderLobster(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  anim: BattleAnimState,
  cs: number, // canvas scale = actual canvas width / CANVAS_W
): void {
  // Get animation offset (use body part 0 / carapace as the dominant motion)
  const animDef = ANIMATIONS[anim.anim];
  const kf = animDef?.keyframes[0] ?? [];
  const offset = getOffset(kf, anim.frame, animDef?.totalFrames ?? 120);

  // Calculate screen position: home + offset from choreography + animation keyframe + knockback
  const x = (anim.homeX + anim.posX + offset.dx + anim.hit.knockX) * cs;
  const y = (anim.homeY + anim.posY + offset.dy + anim.hit.knockY) * cs;
  const spriteSize = SPRITE_SIZE * cs;

  ctx.save();

  // Apply hit effects via canvas filter
  const filters: string[] = [];
  if (anim.hit.grayscale) filters.push('grayscale(0.85)');
  if (anim.hit.flash > 0)
    filters.push(`brightness(${1 + anim.hit.flash / 250})`);
  if (filters.length > 0) ctx.filter = filters.join(' ');

  // Apply tilt rotation from knockback
  if (Math.abs(anim.hit.tilt) > 0.1) {
    const cx = x + spriteSize / 2;
    const cy = y + spriteSize / 2;
    ctx.translate(cx, cy);
    ctx.rotate((anim.hit.tilt * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  // Mirror team B (face left toward team A)
  if (anim.side === 'b') {
    ctx.translate(x + spriteSize, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(image, 0, y, spriteSize, spriteSize);
  } else {
    ctx.drawImage(image, x, y, spriteSize, spriteSize);
  }

  ctx.restore();
  // Reset filter to avoid affecting subsequent draws
  ctx.filter = 'none';
}

/**
 * Render a complete battle frame to the canvas.
 *
 * Draws the arena background, then all lobsters sorted by Y position for
 * depth ordering. Dead lobsters are still rendered (with grayscale) to
 * act as "monuments" on the battlefield.
 *
 * VFX layers (under/over) are intentionally not rendered here -- they are
 * handled by `renderVFXLayer` from the vfx-provider module and should be
 * called by the canvas component between the background and lobster layers
 * (under) and after the lobster layer (over).
 */
export function renderBattleFrame(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  state: BattleViewState,
  images: Map<string, HTMLImageElement>,
  bgImage: HTMLImageElement | null,
  tier: number,
): void {
  const cs = canvasW / CANVAS_W;

  // 1. Background
  drawArenaBg(ctx, bgImage, tier, canvasW, canvasH);

  // 2. Under-layer VFX (called externally by the canvas component)

  // 3. Lobsters (y-sorted for depth)
  const sorted = Object.values(state.anims)
    .filter((a) => a.alive || a.hit.grayscale)
    .sort((a, b) => {
      // Sort by effective Y position for depth ordering
      const ay = a.homeY + a.posY;
      const by = b.homeY + b.posY;
      return ay - by;
    });

  for (const anim of sorted) {
    const img = images.get(anim.id);
    if (!img?.complete) continue;
    renderLobster(ctx, img, anim, cs);
  }

  // 4. Over-layer VFX (called externally by the canvas component)
}
