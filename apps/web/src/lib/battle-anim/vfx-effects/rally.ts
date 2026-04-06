import type { VFXEffect } from '../types';
import { spawnParticle } from '../particles';
import { drawParticle } from './draw-particle';

/**
 * RALLY (Sentinel -- class 5)
 * Healing beam + sparkle cascade + caster glow
 */
export function tick(fx: VFXEffect, _dt: number): void {
  if (!fx.target || !fx.origin) return;
  // Sparkle particles at target
  if (
    fx.progress > 0.2 &&
    fx.progress < 0.9 &&
    fx._canSpawn !== false &&
    Math.random() < 0.4
  ) {
    const col =
      Math.random() > 0.5 ? fx.colors.accent : fx.colors.accentHi;
    spawnParticle(
      fx,
      fx.target.x + (Math.random() - 0.5) * 16,
      fx.target.y - 10,
      (Math.random() - 0.5) * 8,
      15 + Math.random() * 10,
      col,
      1.5 + Math.random() * 2,
      600,
      'square',
      0,
    );
  }
  // Caster glow particles
  if (fx.progress < 0.7 && fx._canSpawn !== false && Math.random() < 0.25) {
    const col = fx.colors.primaryHi;
    spawnParticle(
      fx,
      fx.origin.x + (Math.random() - 0.5) * 14,
      fx.origin.y + 5,
      (Math.random() - 0.5) * 5,
      -15 - Math.random() * 10,
      col,
      1.5 + Math.random(),
      500,
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

  // Healing beam connecting origin to target
  if (fx.progress > 0.1 && fx.progress < 0.85) {
    const beamAlpha =
      fx.progress < 0.3
        ? (fx.progress - 0.1) / 0.2
        : fx.progress > 0.7
          ? (0.85 - fx.progress) / 0.15
          : 1;
    ctx.globalAlpha = beamAlpha * 0.5;
    const ox = Math.round(fx.origin.x * cs);
    const oy = Math.round(fx.origin.y * cs);
    const tx = Math.round(fx.target.x * cs);
    const ty = Math.round(fx.target.y * cs);
    const beamW = Math.max(1, Math.round((3 * cs) / 2));

    ctx.strokeStyle = `rgb(${fx.colors.accent[0]},${fx.colors.accent[1]},${fx.colors.accent[2]})`;
    ctx.lineWidth = beamW;
    ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    // Inner bright beam
    ctx.globalAlpha = beamAlpha * 0.8;
    ctx.strokeStyle = `rgb(${fx.colors.accentHi[0]},${fx.colors.accentHi[1]},${fx.colors.accentHi[2]})`;
    ctx.lineWidth = Math.max(1, Math.round(cs));
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Target sparkle glow
  if (fx.progress > 0.3 && fx.progress < 0.9) {
    const glowP = (fx.progress - 0.3) / 0.6;
    const pulseAlpha =
      0.3 * (1 - glowP) * (0.5 + 0.5 * Math.sin(glowP * Math.PI * 4));
    ctx.globalAlpha = pulseAlpha;
    ctx.fillStyle = `rgb(${fx.colors.accentHi[0]},${fx.colors.accentHi[1]},${fx.colors.accentHi[2]})`;
    const gx = Math.round(fx.target.x * cs);
    const gy = Math.round(fx.target.y * cs);
    const gr = Math.round(12 * cs);
    ctx.fillRect(gx - gr / 2, gy - gr / 2, gr, gr);
    ctx.globalAlpha = 1;
  }

  for (const p of fx.particles) drawParticle(ctx, p, cs);
}
