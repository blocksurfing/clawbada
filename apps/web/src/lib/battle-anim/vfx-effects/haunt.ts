import type { VFXEffect } from '../types';
import { spawnParticle } from '../particles';
import { drawParticle } from './draw-particle';

interface TrailPoint {
  x: number;
  y: number;
  alpha: number;
}

/**
 * HAUNT (Specter -- class 4)
 * Sine-wave ghost projectile + trail + curse mark
 */
export function tick(fx: VFXEffect, _dt: number): void {
  if (!fx.target || !fx.origin) return;
  // Store trail positions
  if (!fx._data.trail) fx._data.trail = [];
  const trail = fx._data.trail as TrailPoint[];
  if (fx.progress < 0.7) {
    const t = fx.progress / 0.7;
    const dx = fx.target.x - fx.origin.x;
    const dy = fx.target.y - fx.origin.y;
    const cx = fx.origin.x + dx * t;
    const cy = fx.origin.y + dy * t + Math.sin(t * Math.PI * 4) * 15;
    fx._data.ghostX = cx;
    fx._data.ghostY = cy;
    trail.push({ x: cx, y: cy, alpha: 1 });
    // Fade old trail
    for (const tp of trail) tp.alpha *= 0.92;
    // Remove faded
    while (trail.length > 12) trail.shift();
  }
  // Curse mark particles at target on arrival
  if (
    fx.progress > 0.7 &&
    fx._canSpawn !== false &&
    Math.random() < 0.35
  ) {
    const col = fx.colors.accent; // spectral green
    spawnParticle(
      fx,
      fx.target.x + (Math.random() - 0.5) * 16,
      fx.target.y + (Math.random() - 0.5) * 16,
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10,
      col,
      2 + Math.random(),
      700,
      'square',
      0,
    );
  }
  // Dark mist orbiting target
  if (
    fx.progress > 0.7 &&
    fx._canSpawn !== false &&
    Math.random() < 0.2
  ) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 12 + Math.random() * 8;
    const col = fx.colors.primaryDk;
    spawnParticle(
      fx,
      fx.target.x + Math.cos(angle) * dist,
      fx.target.y + Math.sin(angle) * dist,
      -Math.sin(angle) * 8,
      Math.cos(angle) * 8,
      col,
      2 + Math.random() * 2,
      800,
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

  // Ghost trail
  const trail = fx._data.trail as TrailPoint[] | undefined;
  if (trail) {
    for (const tp of trail) {
      if (tp.alpha < 0.05) continue;
      ctx.globalAlpha = tp.alpha * 0.4;
      ctx.fillStyle = `rgb(${fx.colors.primary[0]},${fx.colors.primary[1]},${fx.colors.primary[2]})`;
      const sz = Math.max(1, Math.round((4 * cs) / 2));
      ctx.fillRect(
        Math.round(tp.x * cs) - sz / 2,
        Math.round(tp.y * cs) - sz / 2,
        sz,
        sz,
      );
    }
    ctx.globalAlpha = 1;
  }

  // Ghost shape during travel
  if (fx.progress < 0.7 && fx._data.ghostX !== undefined) {
    const gx = Math.round((fx._data.ghostX as number) * cs);
    const gy = Math.round((fx._data.ghostY as number) * cs);
    const sz = Math.round((6 * cs) / 2);
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = `rgb(${fx.colors.primary[0]},${fx.colors.primary[1]},${fx.colors.primary[2]})`;
    ctx.fillRect(gx - sz, gy - sz, sz * 2, sz * 2);
    // Eyes
    ctx.fillStyle = `rgb(${fx.colors.accent[0]},${fx.colors.accent[1]},${fx.colors.accent[2]})`;
    const eyeSz = Math.max(1, Math.round(cs));
    ctx.fillRect(
      gx - Math.round((2 * cs) / 2),
      gy - Math.round(cs / 2),
      eyeSz,
      eyeSz,
    );
    ctx.fillRect(
      gx + Math.round((1 * cs) / 2),
      gy - Math.round(cs / 2),
      eyeSz,
      eyeSz,
    );
    ctx.globalAlpha = 1;
  }

  // Curse mark X at target
  if (fx.progress > 0.7) {
    const curseAlpha = Math.max(0, 1 - (fx.progress - 0.7) / 0.3);
    ctx.globalAlpha = curseAlpha * 0.7;
    const tx = Math.round(fx.target.x * cs);
    const ty = Math.round(fx.target.y * cs);
    const markSz = Math.round(8 * cs);
    ctx.strokeStyle = `rgb(${fx.colors.accent[0]},${fx.colors.accent[1]},${fx.colors.accent[2]})`;
    ctx.lineWidth = Math.max(1, Math.round((2 * cs) / 2));
    ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(tx - markSz / 2, ty - markSz / 2);
    ctx.lineTo(tx + markSz / 2, ty + markSz / 2);
    ctx.moveTo(tx + markSz / 2, ty - markSz / 2);
    ctx.lineTo(tx - markSz / 2, ty + markSz / 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  for (const p of fx.particles) drawParticle(ctx, p, cs);
}
