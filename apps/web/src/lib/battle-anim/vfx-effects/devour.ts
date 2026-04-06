import type { VFXEffect } from '../types';
import { spawnParticle } from '../particles';
import { drawParticle } from './draw-particle';

interface TendrilData {
  sineFreq: number;
  sineAmp: number;
  offset: number;
}

/**
 * DEVOUR (Abyss -- class 7)
 * Dark tendrils extend to target, life particles flow back
 */
export function tick(fx: VFXEffect, _dt: number): void {
  if (!fx.target || !fx.origin) return;
  // Generate tendril paths once
  if (!fx._data.tendrils) {
    const count = [2, 3, 4][fx.tier - 1] || 2;
    fx._data.tendrils = [];
    for (let i = 0; i < count; i++) {
      (fx._data.tendrils as TendrilData[]).push({
        sineFreq: 2 + Math.random() * 3,
        sineAmp: 5 + Math.random() * 10,
        offset: (Math.random() - 0.5) * 8,
      });
    }
  }
  // Life drain particles flowing back from target to origin
  if (
    fx.progress > 0.5 &&
    fx.progress < 0.95 &&
    fx._canSpawn !== false &&
    Math.random() < 0.4
  ) {
    const px = fx.target.x + (Math.random() - 0.5) * 8;
    const py = fx.target.y + (Math.random() - 0.5) * 8;
    const ddx = fx.origin.x - px;
    const ddy = fx.origin.y - py;
    const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
    const speed = 50 + Math.random() * 30;
    spawnParticle(
      fx,
      px,
      py,
      (ddx / dist) * speed,
      (ddy / dist) * speed,
      fx.colors.accent,
      2 + Math.random(),
      600,
      'square',
      0,
    );
  }
  // Caster green pulse
  if (
    fx.progress > 0.7 &&
    fx._canSpawn !== false &&
    Math.random() < 0.2
  ) {
    spawnParticle(
      fx,
      fx.origin.x + (Math.random() - 0.5) * 10,
      fx.origin.y + (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 8,
      -10 - Math.random() * 8,
      fx.colors.accent,
      2,
      400,
      'square',
      0,
    );
  }
}

export function render(
  fx: VFXEffect,
  ctx: CanvasRenderingContext2D,
  cs: number,
  layer: 'under' | 'over',
): void {
  if (layer !== 'over' || !fx.target || !fx.origin) return;

  // Draw tendrils
  const tendrils = fx._data.tendrils as TendrilData[] | undefined;
  if (tendrils && fx.progress < 0.85) {
    const extendP = fx.progress < 0.5 ? fx.progress / 0.5 : 1;
    const alpha =
      fx.progress > 0.7
        ? Math.max(0, 1 - (fx.progress - 0.7) / 0.15)
        : 0.7;
    ctx.globalAlpha = alpha;
    const dx = fx.target.x - fx.origin.x;
    const dy = fx.target.y - fx.origin.y;
    const sz = Math.max(1, Math.round((2 * cs) / 2));

    for (const tend of tendrils) {
      const steps = 20;
      for (let s = 0; s < Math.floor(steps * extendP); s++) {
        const t = s / steps;
        const px = fx.origin.x + dx * t;
        const py =
          fx.origin.y +
          dy * t +
          tend.offset +
          Math.sin(t * Math.PI * tend.sineFreq + fx.progress * 6) *
            tend.sineAmp;
        ctx.fillStyle = `rgb(${fx.colors.primary[0]},${fx.colors.primary[1]},${fx.colors.primary[2]})`;
        ctx.fillRect(Math.round(px * cs), Math.round(py * cs), sz, sz);
      }
    }
    ctx.globalAlpha = 1;
  }

  for (const p of fx.particles) drawParticle(ctx, p, cs);
}
