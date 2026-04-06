import type { VFXEffect, RGB } from '../types';
import { spawnParticle } from '../particles';
import { drawParticle } from './draw-particle';

interface CrackData {
  angle: number;
  length: number;
  offset: number;
}

/**
 * CRUSH (Leviathan -- class 2)
 * Ground cracks + debris + shockwave ring
 */
export function tick(fx: VFXEffect, _dt: number): void {
  if (!fx.target) return;
  // Generate crack angles once
  if (!fx._data.cracks) {
    const crackCount = [6, 10, 16][fx.tier - 1] || 6;
    fx._data.cracks = [];
    for (let i = 0; i < crackCount; i++) {
      (fx._data.cracks as CrackData[]).push({
        angle: Math.random() * Math.PI * 2,
        length: 10 + Math.random() * 20,
        offset: Math.random() * 4 - 2,
      });
    }
  }
  // Debris particles at impact
  const debrisCount = [4, 10, 22][fx.tier - 1] || 4;
  if (fx.progress > 0.2 && !fx._data.debrisSpawned && fx._canSpawn !== false) {
    fx._data.debrisSpawned = true;
    for (let i = 0; i < debrisCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 50;
      const col: RGB =
        Math.random() > 0.5 ? fx.colors.secondary : fx.colors.secondaryHi;
      spawnParticle(
        fx,
        fx.target.x,
        fx.target.y,
        Math.cos(angle) * speed,
        -Math.abs(Math.sin(angle) * speed) - 20,
        col,
        2 + Math.random() * 2,
        800,
        'square',
        100,
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
  if (!fx.target) return;
  const tx = Math.round(fx.target.x * cs);
  const ty = Math.round(fx.target.y * cs);

  if (layer === 'under') {
    // Radial crack lines
    const cracks = fx._data.cracks as CrackData[] | undefined;
    if (cracks && fx.progress > 0.15) {
      const crackP = Math.min(1, (fx.progress - 0.15) / 0.4);
      const alpha =
        fx.progress > 0.7
          ? Math.max(0, 1 - (fx.progress - 0.7) / 0.3)
          : 0.8;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = `rgb(${fx.colors.outline[0]},${fx.colors.outline[1]},${fx.colors.outline[2]})`;
      ctx.lineWidth = Math.max(1, Math.round(cs));
      ctx.lineCap = 'square';
      for (const c of cracks) {
        const len = c.length * crackP * cs;
        ctx.beginPath();
        ctx.moveTo(
          tx + Math.round(c.offset * cs),
          ty + Math.round(c.offset * cs),
        );
        ctx.lineTo(
          tx + Math.round(Math.cos(c.angle) * len),
          ty + Math.round(Math.sin(c.angle) * len),
        );
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  if (layer === 'over') {
    // Shockwave ring(s)
    const ringCount = [0, 1, 2][fx.tier - 1] || 0;
    if (ringCount > 0 && fx.progress > 0.2 && fx.progress < 0.9) {
      const ringP = (fx.progress - 0.2) / 0.7;
      for (let r = 0; r < ringCount; r++) {
        const rp = Math.max(0, ringP - r * 0.15);
        if (rp <= 0 || rp > 1) continue;
        const radius = rp * 35 * cs;
        const alpha = Math.max(0, 1 - rp);
        ctx.globalAlpha = alpha * 0.6;
        ctx.strokeStyle = `rgb(${fx.colors.secondary[0]},${fx.colors.secondary[1]},${fx.colors.secondary[2]})`;
        ctx.lineWidth = Math.max(1, Math.round(2 * cs * (1 - rp)));
        ctx.beginPath();
        ctx.arc(tx, ty, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // Debris particles
    for (const p of fx.particles) drawParticle(ctx, p, cs);
  }
}
