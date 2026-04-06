import type { Particle } from '../types';

/** Draw a single particle to the canvas. Shared by all VFX effect renderers. */
export function drawParticle(
  ctx: CanvasRenderingContext2D,
  p: Particle,
  cs: number,
): void {
  if (p.alpha <= 0) return;
  ctx.globalAlpha = p.alpha;
  ctx.fillStyle = `rgb(${p.color[0]},${p.color[1]},${p.color[2]})`;
  const px = Math.round(p.x * cs);
  const py = Math.round(p.y * cs);
  const sz = Math.max(1, Math.round((p.size * cs) / 2));
  if (p.shape === 'circle') {
    ctx.beginPath();
    ctx.arc(px + sz / 2, py + sz / 2, sz / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillRect(px, py, sz, sz);
  }
  ctx.globalAlpha = 1;
}
