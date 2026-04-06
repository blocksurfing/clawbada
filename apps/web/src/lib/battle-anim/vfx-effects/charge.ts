import type { VFXEffect } from '../types';
import { spawnParticle } from '../particles';
import { drawParticle } from './draw-particle';

/** Shared charge-up sparkles that converge on the caster. */
export function tick(fx: VFXEffect, _dt: number): void {
  if (fx.progress < 0.8 && fx._canSpawn !== false && Math.random() < 0.3) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 40;
    const px = fx.origin.x + Math.cos(angle) * dist;
    const py = fx.origin.y + Math.sin(angle) * dist;
    const speed = 40 + Math.random() * 20;
    const vx = ((fx.origin.x - px) / dist) * speed;
    const vy = ((fx.origin.y - py) / dist) * speed;
    spawnParticle(
      fx,
      px,
      py,
      vx,
      vy,
      fx.colors.accent,
      2 + Math.random() * 2,
      600,
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
  if (layer !== 'over') return;
  for (const p of fx.particles) drawParticle(ctx, p, cs);
}
