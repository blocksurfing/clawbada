'use client';

import { useRef, useEffect } from 'react';
import type { BattleViewState, BattleAnimState } from '@/lib/battle-anim/types';
import { CANVAS_W, CANVAS_H, SPRITE_SIZE } from '@/lib/battle-anim/positions';
import { ARENA_BG_GRADIENTS } from '@/lib/battle-anim/arena';
import { ANIMATIONS } from '@/lib/battle-anim/animations';
import { getOffset } from '@/lib/battle-anim/interpolation';
import { getProvider, NOOP_PROVIDER } from '@/lib/battle-anim/vfx-provider';

interface BattleCanvasProps {
  stateRef: React.MutableRefObject<BattleViewState | null>;
  images: Map<string, HTMLImageElement>;
  arenaBackground: HTMLImageElement | null;
  tier: number;
  className?: string;
}

/** Render the arena gradient fallback when no background image is available. */
function drawArenaGradient(
  ctx: CanvasRenderingContext2D,
  tier: number,
  w: number,
  h: number,
): void {
  const stops = ARENA_BG_GRADIENTS[tier] ?? ARENA_BG_GRADIENTS[1];
  if (!stops) {
    ctx.fillStyle = '#0a1628';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  for (const s of stops) {
    grad.addColorStop(s.stop, s.color);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

/** Render a single lobster sprite at its current animation position. */
function renderLobster(
  ctx: CanvasRenderingContext2D,
  anim: BattleAnimState,
  img: HTMLImageElement | undefined,
  scale: number,
): void {
  const animDef = ANIMATIONS[anim.anim];
  if (!animDef) return;

  // Get animation offset for all body parts (use part 0 as base offset)
  const bodyPartKfs = animDef.keyframes[0];
  const offset = bodyPartKfs
    ? getOffset(bodyPartKfs, Math.floor(anim.frame), animDef.totalFrames)
    : { dx: 0, dy: 0 };

  // Apply hit reaction offsets
  const hitDx = anim.hit.knockX;
  const hitDy = anim.hit.knockY;

  const drawX = (anim.posX + offset.dx + hitDx) * scale;
  const drawY = (anim.posY + offset.dy + hitDy) * scale;
  const drawSize = SPRITE_SIZE * scale;

  ctx.save();

  // Apply tilt rotation from hit reaction
  if (Math.abs(anim.hit.tilt) > 0.1) {
    const cx = drawX + drawSize / 2;
    const cy = drawY + drawSize / 2;
    ctx.translate(cx, cy);
    ctx.rotate((anim.hit.tilt * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  // Death grayscale effect
  if (anim.hit.grayscale) {
    ctx.globalAlpha = 0.5;
    ctx.filter = 'grayscale(1)';
  }

  // White flash on hit
  if (anim.hit.flash > 0) {
    ctx.filter = 'brightness(3)';
  }

  // Flip team B horizontally (they face left)
  if (anim.side === 'b') {
    ctx.translate(drawX + drawSize, drawY);
    ctx.scale(-1, 1);
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, 0, 0, drawSize, drawSize);
    } else {
      drawPlaceholderSprite(ctx, 0, 0, drawSize, anim.classId);
    }
  } else {
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, drawX, drawY, drawSize, drawSize);
    } else {
      drawPlaceholderSprite(ctx, drawX, drawY, drawSize, anim.classId);
    }
  }

  ctx.restore();
}

/** Draw a colored placeholder square when the image hasn't loaded. */
function drawPlaceholderSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  classId: number,
): void {
  const colors = [
    '#64748b', '#22c55e', '#3b82f6', '#8b5cf6', '#6366f1',
    '#f59e0b', '#ef4444', '#1e293b', '#06b6d4', '#f97316',
  ];
  ctx.fillStyle = colors[classId] ?? '#6B7280';
  ctx.fillRect(x + size * 0.1, y + size * 0.1, size * 0.8, size * 0.8);

  // Simple lobster glyph
  ctx.fillStyle = 'white';
  ctx.font = `${size * 0.4}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('\u{1F99E}', x + size / 2, y + size / 2);
}

/** Render HP bars below each alive lobster. */
function renderHPBars(
  ctx: CanvasRenderingContext2D,
  state: BattleViewState,
  scale: number,
): void {
  for (const id of state.lobsterOrder) {
    const anim = state.anims[id];
    if (!anim) continue;

    const barWidth = SPRITE_SIZE * 0.8 * scale;
    const barHeight = 3 * scale;
    const barX = (anim.posX + SPRITE_SIZE * 0.1) * scale;
    const barY = (anim.posY + SPRITE_SIZE + 2) * scale;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // HP fill
    const hpPct = anim.maxHp > 0 ? Math.max(0, anim.hp / anim.maxHp) : 0;
    const hpColor =
      hpPct > 0.5 ? '#22c55e' : hpPct > 0.25 ? '#f59e0b' : '#ef4444';
    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, barY, barWidth * hpPct, barHeight);

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
  }
}

/** Render charge dots below HP bar. */
function renderChargeDots(
  ctx: CanvasRenderingContext2D,
  state: BattleViewState,
  scale: number,
): void {
  for (const id of state.lobsterOrder) {
    const anim = state.anims[id];
    if (!anim || !anim.alive) continue;

    const dotRadius = 2 * scale;
    const dotSpacing = 6 * scale;
    const baseX = (anim.posX + SPRITE_SIZE / 2) * scale - dotSpacing;
    const baseY = (anim.posY + SPRITE_SIZE + 8) * scale;

    for (let i = 0; i < 3; i++) {
      const x = baseX + i * dotSpacing;
      ctx.beginPath();
      ctx.arc(x, baseY, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle =
        i < anim.charge ? '#fbbf24' : 'rgba(255, 255, 255, 0.2)';
      ctx.fill();
    }
  }
}

/** Render VFX effects (under and over layers). */
function renderVFX(
  ctx: CanvasRenderingContext2D,
  state: BattleViewState,
  scale: number,
  layer: 'under' | 'over',
): void {
  for (const fx of state.effects) {
    const provider = getProvider(fx.classId, fx.tier) ?? NOOP_PROVIDER;
    provider.render(fx, ctx, scale, layer);
  }
}

export function BattleCanvas({
  stateRef,
  images,
  arenaBackground,
  tier,
  className,
}: BattleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const state = stateRef.current;
      if (!state) {
        rafRef.current = requestAnimationFrame(render);
        return;
      }

      // Resize canvas to container
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // Cap internal resolution at 960x540 for performance
      const maxW = 960;
      const maxH = 540;
      const containerW = rect.width;
      const containerH = rect.height;
      const pixelW = Math.min(Math.floor(containerW * dpr), maxW);
      const pixelH = Math.min(Math.floor(containerH * dpr), maxH);

      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW;
        canvas.height = pixelH;
      }

      // Scale factor from canonical 480x270 to canvas pixels
      const scaleX = pixelW / CANVAS_W;
      const scaleY = pixelH / CANVAS_H;
      const scale = Math.min(scaleX, scaleY);

      // Disable image smoothing for pixel-perfect rendering
      ctx.imageSmoothingEnabled = false;

      // Clear
      ctx.clearRect(0, 0, pixelW, pixelH);

      // Draw background
      if (arenaBackground && arenaBackground.complete && arenaBackground.naturalWidth > 0) {
        ctx.drawImage(arenaBackground, 0, 0, pixelW, pixelH);
      } else {
        drawArenaGradient(ctx, tier, pixelW, pixelH);
      }

      // Apply screen shake
      if (state.shakeAmount > 0.5) {
        const shakeX = (Math.random() - 0.5) * state.shakeAmount * 2;
        const shakeY = (Math.random() - 0.5) * state.shakeAmount * 2;
        ctx.save();
        ctx.translate(shakeX * scale, shakeY * scale);
      }

      // VFX under layer
      renderVFX(ctx, state, scale, 'under');

      // Render lobsters in y-sorted order (back to front)
      for (const id of state.lobsterOrder) {
        const anim = state.anims[id];
        if (!anim) continue;
        const img = images.get(id);
        renderLobster(ctx, anim, img, scale);
      }

      // VFX over layer
      renderVFX(ctx, state, scale, 'over');

      // HP bars and charge dots
      renderHPBars(ctx, state, scale);
      renderChargeDots(ctx, state, scale);

      // Undo shake translate
      if (state.shakeAmount > 0.5) {
        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [stateRef, images, arenaBackground, tier]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9' }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          imageRendering: 'pixelated',
        }}
      />
    </div>
  );
}
