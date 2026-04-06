import type { VFXEffect } from '../types';
import { spawnParticle } from '../particles';
import { drawParticle } from './draw-particle';

/**
 * AMBUSH (Mantis -- class 1)
 * 3 sequential slash lines on target + debris
 */
export function tick(fx: VFXEffect, _dt: number): void {
  if (!fx.target) return;
  const tierParticles = [3, 6, 10][fx.tier - 1] || 3;
  // Spawn debris particles for each slash phase
  const slashPhases = [0.0, 0.3, 0.6];
  for (let s = 0; s < 3; s++) {
    if (
      fx.progress >= slashPhases[s] &&
      fx.progress < slashPhases[s] + 0.1 &&
      !(fx._data as Record<string, boolean>)['slash' + s]
    ) {
      (fx._data as Record<string, boolean>)['slash' + s] = true;
      for (let i = 0; i < tierParticles && fx._canSpawn !== false; i++) {
        const vx = (Math.random() - 0.5) * 80;
        const vy = -Math.random() * 60 - 20;
        const col =
          Math.random() > 0.5 ? fx.colors.accent : fx.colors.accentHi;
        spawnParticle(
          fx,
          fx.target.x + (Math.random() - 0.5) * 20,
          fx.target.y + (Math.random() - 0.5) * 20,
          vx,
          vy,
          col,
          2 + Math.random() * 2,
          500,
          'square',
          120,
        );
      }
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
  const size = Math.round(24 * cs);
  const tierWidth = [2, 3, 4][fx.tier - 1] || 2;
  const lineW = Math.max(1, Math.round((tierWidth * cs) / 2));
  ctx.lineCap = 'square';
  ctx.lineWidth = lineW;

  const slashDefs = [
    { start: 0.0, end: 0.3, x1: -1, y1: -1, x2: 1, y2: 1 }, // top-left to bottom-right
    { start: 0.3, end: 0.6, x1: 1, y1: -1, x2: -1, y2: 1 }, // top-right to bottom-left
    { start: 0.6, end: 0.9, x1: 0, y1: -1, x2: 0, y2: 1 }, // vertical center
  ];
  for (const sl of slashDefs) {
    if (fx.progress < sl.start || fx.progress > sl.end + 0.1) continue;
    const localP = Math.min(1, (fx.progress - sl.start) / (sl.end - sl.start));
    const drawP = Math.min(1, localP * 2); // slash extends fast
    const alpha = localP > 0.5 ? Math.max(0, 1 - (localP - 0.5) * 2) : 1;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = `rgb(${fx.colors.accentHi[0]},${fx.colors.accentHi[1]},${fx.colors.accentHi[2]})`;
    ctx.beginPath();
    ctx.moveTo(tx + sl.x1 * size * 0.5, ty + sl.y1 * size * 0.5);
    ctx.lineTo(
      tx + sl.x1 * size * 0.5 + (sl.x2 - sl.x1) * size * 0.5 * drawP,
      ty + sl.y1 * size * 0.5 + (sl.y2 - sl.y1) * size * 0.5 * drawP,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Apex speed lines
  if (fx.tier >= 3 && fx.progress < 0.8) {
    ctx.globalAlpha = 0.4 * (1 - fx.progress);
    ctx.strokeStyle = `rgb(${fx.colors.primaryHi[0]},${fx.colors.primaryHi[1]},${fx.colors.primaryHi[2]})`;
    ctx.lineWidth = Math.max(1, Math.round(cs));
    for (let i = 0; i < 4; i++) {
      const ly = ty - size + i * Math.round(size * 0.6);
      ctx.beginPath();
      ctx.moveTo(tx - size, ly);
      ctx.lineTo(tx - size * 1.8, ly);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Particles
  for (const p of fx.particles) drawParticle(ctx, p, cs);
}
