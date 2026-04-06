import type { VFXEffect, RGB } from '../types';
import { spawnParticle } from '../particles';
import { drawParticle } from './draw-particle';

/**
 * INFERNO (Ember -- class 9)
 * Fireball projectile + explosion + self-damage flash
 */
export function tick(fx: VFXEffect, _dt: number): void {
  if (!fx.target || !fx.origin) return;
  // Trail particles during projectile phase
  if (fx.progress < 0.4 && fx._canSpawn !== false && Math.random() < 0.6) {
    const t = fx.progress / 0.4;
    const cx = fx.origin.x + (fx.target.x - fx.origin.x) * t;
    const cy = fx.origin.y + (fx.target.y - fx.origin.y) * t;
    const col: RGB =
      Math.random() > 0.5 ? fx.colors.accent : fx.colors.accentHi;
    spawnParticle(
      fx,
      cx + (Math.random() - 0.5) * 6,
      cy + (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 15,
      -Math.random() * 20,
      col,
      2 + Math.random() * 2,
      400,
      'square',
      10,
    );
  }
  // Explosion particles
  if (fx.progress >= 0.4 && !(fx._data as Record<string, boolean>).exploded) {
    (fx._data as Record<string, boolean>).exploded = true;
    const burstCount = [8, 16, 28][fx.tier - 1] || 8;
    for (let i = 0; i < burstCount && fx._canSpawn !== false; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 60;
      const col: RGB = [fx.colors.accent, fx.colors.accentHi, fx.colors.primary][
        Math.floor(Math.random() * 3)
      ] as RGB;
      spawnParticle(
        fx,
        fx.target.x,
        fx.target.y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        col,
        2 + Math.random() * 3,
        700,
        'square',
        30,
      );
    }
    // Smoke particles (primary = dark brown)
    for (let i = 0; i < 4; i++) {
      spawnParticle(
        fx,
        fx.target.x + (Math.random() - 0.5) * 10,
        fx.target.y,
        (Math.random() - 0.5) * 8,
        -20 - Math.random() * 15,
        fx.colors.primary,
        3 + Math.random() * 2,
        1000,
        'square',
        -5,
      );
    }
  }
  // Self-damage flash at origin
  if (
    fx.progress >= 0.5 &&
    !(fx._data as Record<string, boolean>).selfFlash &&
    fx._canSpawn !== false
  ) {
    (fx._data as Record<string, boolean>).selfFlash = true;
    for (let i = 0; i < 5; i++) {
      spawnParticle(
        fx,
        fx.origin.x + (Math.random() - 0.5) * 12,
        fx.origin.y + (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 20,
        [255, 60, 40],
        2 + Math.random() * 2,
        500,
        'square',
        0,
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
  if (layer !== 'over' || !fx.target || !fx.origin) return;

  // Fireball cluster during projectile phase
  if (fx.progress < 0.4) {
    const t = fx.progress / 0.4;
    const cx = Math.round(
      (fx.origin.x + (fx.target.x - fx.origin.x) * t) * cs,
    );
    const cy = Math.round(
      (fx.origin.y + (fx.target.y - fx.origin.y) * t) * cs,
    );
    const ballCount = [4, 6, 8][fx.tier - 1] || 4;
    for (let i = 0; i < ballCount; i++) {
      const ox = Math.round((Math.random() - 0.5) * 8 * cs);
      const oy = Math.round((Math.random() - 0.5) * 8 * cs);
      const sz = Math.max(1, Math.round(((2 + Math.random() * 3) * cs) / 2));
      ctx.fillStyle = `rgb(${fx.colors.accentHi[0]},${fx.colors.accentHi[1]},${fx.colors.accentHi[2]})`;
      ctx.fillRect(cx + ox, cy + oy, sz, sz);
    }
    // Core glow
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = `rgb(${fx.colors.accent[0]},${fx.colors.accent[1]},${fx.colors.accent[2]})`;
    const glow = Math.round((5 * cs) / 2);
    ctx.fillRect(cx - glow / 2, cy - glow / 2, glow, glow);
    ctx.globalAlpha = 1;
  }

  // Explosion shockwave ring
  if (fx.progress >= 0.4 && fx.progress < 0.9) {
    const ep = (fx.progress - 0.4) / 0.5;
    const etx = Math.round(fx.target.x * cs);
    const ety = Math.round(fx.target.y * cs);
    const radius = ep * 30 * cs;
    ctx.globalAlpha = Math.max(0, 0.7 * (1 - ep));
    ctx.strokeStyle = `rgb(${fx.colors.accent[0]},${fx.colors.accent[1]},${fx.colors.accent[2]})`;
    ctx.lineWidth = Math.max(1, Math.round(2 * cs * (1 - ep)));
    ctx.beginPath();
    ctx.arc(etx, ety, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Particles
  for (const p of fx.particles) drawParticle(ctx, p, cs);
}
