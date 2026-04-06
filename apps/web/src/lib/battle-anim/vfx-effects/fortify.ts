import type { VFXEffect, RGB } from '../types';
import { spawnParticle } from '../particles';
import { drawParticle } from './draw-particle';

/**
 * FORTIFY (Bulwark -- class 0)
 * Protective dome over allies + ground glow
 */
export function tick(fx: VFXEffect, _dt: number): void {
  // Upward drifting particles inside dome
  if (
    fx.progress > 0.15 &&
    fx.progress < 0.9 &&
    fx._canSpawn !== false &&
    Math.random() < 0.3
  ) {
    // Calculate centroid from target list (allies)
    let cx = fx.origin.x;
    let cy = fx.origin.y;
    if (fx.targets.length > 0) {
      cx = fx.targets.reduce((s, t) => s + t.x, 0) / fx.targets.length;
      cy = fx.targets.reduce((s, t) => s + t.y, 0) / fx.targets.length;
    }
    const col: RGB =
      Math.random() > 0.5
        ? fx.colors.accentHi
        : [220, 220, 230];
    spawnParticle(
      fx,
      cx + (Math.random() - 0.5) * 40,
      cy + 10,
      (Math.random() - 0.5) * 5,
      -10 - Math.random() * 10,
      col,
      1.5 + Math.random(),
      700,
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
  // Calculate centroid from allies
  let cx = fx.origin.x;
  let cy = fx.origin.y;
  if (fx.targets.length > 0) {
    cx = fx.targets.reduce((s, t) => s + t.x, 0) / fx.targets.length;
    cy = fx.targets.reduce((s, t) => s + t.y, 0) / fx.targets.length;
  }
  const dcx = Math.round(cx * cs);
  const dcy = Math.round(cy * cs);
  const rx = Math.round(45 * cs);
  const ry = Math.round(35 * cs);

  if (layer === 'under') {
    // Ground glow circle
    if (fx.progress > 0.1 && fx.progress < 0.9) {
      const glowAlpha =
        fx.progress < 0.3
          ? (fx.progress - 0.1) / 0.2
          : fx.progress > 0.75
            ? (0.9 - fx.progress) / 0.15
            : 1;
      ctx.globalAlpha = glowAlpha * 0.15;
      ctx.fillStyle = `rgb(${fx.colors.primary[0]},${fx.colors.primary[1]},${fx.colors.primary[2]})`;
      ctx.beginPath();
      ctx.ellipse(
        dcx,
        dcy + Math.round(10 * cs),
        rx,
        Math.round(8 * cs),
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  if (layer === 'over') {
    // Dome ellipse
    if (fx.progress > 0.05 && fx.progress < 0.95) {
      const domeAlpha =
        fx.progress < 0.2
          ? (fx.progress - 0.05) / 0.15
          : fx.progress > 0.8
            ? (0.95 - fx.progress) / 0.15
            : 1;
      ctx.globalAlpha = domeAlpha * 0.5;
      ctx.strokeStyle = `rgb(${fx.colors.primary[0]},${fx.colors.primary[1]},${fx.colors.primary[2]})`;
      ctx.lineWidth = Math.max(1, Math.round((2 * cs) / 2));
      ctx.setLineDash([Math.round(4 * cs), Math.round(3 * cs)]);
      ctx.beginPath();
      ctx.ellipse(
        dcx,
        dcy - Math.round(5 * cs),
        rx,
        ry,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.setLineDash([]);

      // Hex pattern at Elite+
      if (fx.tier >= 2) {
        ctx.globalAlpha = domeAlpha * 0.15;
        ctx.strokeStyle = `rgb(${fx.colors.accentHi[0]},${fx.colors.accentHi[1]},${fx.colors.accentHi[2]})`;
        ctx.lineWidth = Math.max(1, Math.round(cs));
        const hexSize = Math.round(8 * cs);
        for (let hx = -2; hx <= 2; hx++) {
          for (let hy = -1; hy <= 1; hy++) {
            const px = dcx + hx * hexSize * 1.5;
            const py =
              dcy -
              Math.round(5 * cs) +
              hy * hexSize * 1.2 +
              (hx % 2) * hexSize * 0.6;
            // Simple hex: 6 points
            ctx.beginPath();
            for (let a = 0; a < 6; a++) {
              const ang = (Math.PI / 3) * a - Math.PI / 6;
              const hpx = px + Math.cos(ang) * hexSize * 0.4;
              const hpy = py + Math.sin(ang) * hexSize * 0.4;
              if (a === 0) ctx.moveTo(hpx, hpy);
              else ctx.lineTo(hpx, hpy);
            }
            ctx.closePath();
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
    }
    for (const p of fx.particles) drawParticle(ctx, p, cs);
  }
}
