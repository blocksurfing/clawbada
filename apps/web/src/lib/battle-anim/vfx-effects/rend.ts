import type { VFXEffect } from '../types';
import { spawnParticle } from '../particles';
import { drawParticle } from './draw-particle';

/**
 * REND (Reaver -- class 6)
 * X-pattern slashes + dripping red particles
 */
export function tick(fx: VFXEffect, _dt: number): void {
  if (!fx.target) return;
  const tierDrips = [6, 12, 20][fx.tier - 1] || 6;
  // Spawn drip particles continuously
  if (fx.progress < 0.8 && fx._canSpawn !== false && Math.random() < 0.4) {
    const dripCount = Math.ceil(tierDrips * 0.15);
    for (let i = 0; i < dripCount; i++) {
      const px = fx.target.x + (Math.random() - 0.5) * 20;
      const py = fx.target.y + (Math.random() - 0.5) * 10;
      const col =
        Math.random() > 0.3 ? fx.colors.primary : fx.colors.accent;
      spawnParticle(
        fx,
        px,
        py,
        (Math.random() - 0.5) * 10,
        20 + Math.random() * 30,
        col,
        2 + Math.random(),
        2000,
        'square',
        50,
      );
    }
  }
}

export function render(
  fx: VFXEffect,
  ctx: CanvasRenderingContext2D,
  cs: number,
  layer: 'under' | 'over',
): void {
  if (layer !== 'over' || !fx.target) return;
  const tx = Math.round(fx.target.x * cs);
  const ty = Math.round(fx.target.y * cs);
  const size = Math.round(20 * cs);
  const tierWidth = [2, 3, 3][fx.tier - 1] || 2;
  const lineW = Math.max(1, Math.round((tierWidth * cs) / 2));

  // X-pattern slashes
  if (fx.progress < 0.6) {
    const slashP = Math.min(1, fx.progress / 0.3);
    const alpha =
      fx.progress > 0.3 ? Math.max(0, 1 - (fx.progress - 0.3) / 0.3) : 1;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = `rgb(${fx.colors.primary[0]},${fx.colors.primary[1]},${fx.colors.primary[2]})`;
    ctx.lineWidth = lineW;
    ctx.lineCap = 'square';
    // Slash 1: top-left to bottom-right
    ctx.beginPath();
    ctx.moveTo(tx - size * 0.5, ty - size * 0.5);
    ctx.lineTo(
      tx - size * 0.5 + size * slashP,
      ty - size * 0.5 + size * slashP,
    );
    ctx.stroke();
    // Slash 2: top-right to bottom-left
    ctx.beginPath();
    ctx.moveTo(tx + size * 0.5, ty - size * 0.5);
    ctx.lineTo(
      tx + size * 0.5 - size * slashP,
      ty - size * 0.5 + size * slashP,
    );
    ctx.stroke();
    // Slash 3: horizontal left
    ctx.beginPath();
    ctx.moveTo(tx - size * 0.4, ty);
    ctx.lineTo(tx - size * 0.4 + size * 0.8 * slashP, ty - size * 0.15);
    ctx.stroke();
    // Slash 4: horizontal right
    ctx.beginPath();
    ctx.moveTo(tx + size * 0.4, ty);
    ctx.lineTo(tx + size * 0.4 - size * 0.8 * slashP, ty + size * 0.15);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Drip particles
  for (const p of fx.particles) drawParticle(ctx, p, cs);
}
