import type { VFXEffect, RGB } from '../types';
import { spawnParticle } from '../particles';
import { drawParticle } from './draw-particle';

interface BoltSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface BoltData {
  segments: BoltSegment[];
  life: number;
}

/**
 * MAELSTROM (Tempest -- class 3)
 * Spiral vortex + lightning bolts between targets
 */
export function tick(fx: VFXEffect, dt: number): void {
  // Calculate enemy centroid
  let cx: number;
  let cy: number;
  if (fx.targets.length > 0) {
    cx = fx.targets.reduce((s, t) => s + t.x, 0) / fx.targets.length;
    cy = fx.targets.reduce((s, t) => s + t.y, 0) / fx.targets.length;
  } else if (fx.target) {
    cx = fx.target.x;
    cy = fx.target.y;
  } else {
    return;
  }
  fx._data.cx = cx;
  fx._data.cy = cy;

  // Spiral particles
  if (
    fx.progress > 0.1 &&
    fx.progress < 0.85 &&
    fx._canSpawn !== false &&
    Math.random() < 0.5
  ) {
    const angle = Math.random() * Math.PI * 2;
    const r = 20 + Math.random() * 20;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r * 0.6;
    // Tangential velocity (spiral inward)
    const tangSpeed = 30 + Math.random() * 20;
    const radSpeed = -8;
    const vx =
      -Math.sin(angle) * tangSpeed + Math.cos(angle) * radSpeed;
    const vy =
      Math.cos(angle) * tangSpeed * 0.6 +
      Math.sin(angle) * radSpeed * 0.6;
    const col: RGB =
      Math.random() > 0.5 ? fx.colors.accent : fx.colors.primary;
    spawnParticle(fx, px, py, vx, vy, col, 2 + Math.random(), 600, 'square', 0);
  }

  // Lightning bolts between targets
  if (!fx._data.bolts) fx._data.bolts = [];
  const bolts = fx._data.bolts as BoltData[];
  if (
    fx.progress > 0.2 &&
    fx.progress < 0.8 &&
    fx.targets.length >= 2 &&
    Math.random() < 0.1
  ) {
    const i1 = Math.floor(Math.random() * fx.targets.length);
    let i2 = Math.floor(Math.random() * fx.targets.length);
    if (i2 === i1) i2 = (i2 + 1) % fx.targets.length;
    const t1 = fx.targets[i1];
    const t2 = fx.targets[i2];
    const segs: BoltSegment[] = [];
    let bx = t1.x;
    let by = t1.y;
    for (let s = 0; s < 3; s++) {
      const t = (s + 1) / 3;
      const nx =
        t1.x + (t2.x - t1.x) * t + (Math.random() - 0.5) * 12;
      const ny =
        t1.y + (t2.y - t1.y) * t + (Math.random() - 0.5) * 8;
      segs.push({ x1: bx, y1: by, x2: nx, y2: ny });
      bx = nx;
      by = ny;
    }
    bolts.push({ segments: segs, life: 180 });
  }
  for (let i = bolts.length - 1; i >= 0; i--) {
    bolts[i].life -= dt;
    if (bolts[i].life <= 0) bolts.splice(i, 1);
  }
}

export function render(
  fx: VFXEffect,
  ctx: CanvasRenderingContext2D,
  cs: number,
  layer: 'under' | 'over',
): void {
  if (layer !== 'over') return;
  const cx = fx._data.cx as number | undefined;
  const cy = fx._data.cy as number | undefined;
  if (cx === undefined || cy === undefined) return;

  // Vortex ring
  if (fx.progress > 0.05 && fx.progress < 0.9) {
    let vortexScale: number;
    if (fx.progress < 0.3) vortexScale = (fx.progress - 0.05) / 0.25;
    else if (fx.progress < 0.7) vortexScale = 1;
    else vortexScale = Math.max(0, (0.9 - fx.progress) / 0.2);

    const radius = 28 * vortexScale * cs;
    const alpha = vortexScale * 0.4;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = `rgb(${fx.colors.accent[0]},${fx.colors.accent[1]},${fx.colors.accent[2]})`;
    ctx.lineWidth = Math.max(1, Math.round((2 * cs) / 2));
    ctx.beginPath();
    ctx.ellipse(
      Math.round(cx * cs),
      Math.round(cy * cs),
      radius,
      radius * 0.6,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();

    // Spinning indicator lines
    const time = performance.now() / 200;
    ctx.lineWidth = Math.max(1, Math.round(cs));
    for (let i = 0; i < 4; i++) {
      const a = time + ((Math.PI * 2) / 4) * i;
      const r1 = radius * 0.6;
      const r2 = radius;
      ctx.beginPath();
      ctx.moveTo(
        Math.round(cx * cs + Math.cos(a) * r1),
        Math.round(cy * cs + Math.sin(a) * r1 * 0.6),
      );
      ctx.lineTo(
        Math.round(cx * cs + Math.cos(a) * r2),
        Math.round(cy * cs + Math.sin(a) * r2 * 0.6),
      );
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Lightning bolts
  const bolts = fx._data.bolts as BoltData[] | undefined;
  if (bolts) {
    ctx.lineCap = 'square';
    for (const bolt of bolts) {
      const boltAlpha = Math.min(1, bolt.life / 80);
      ctx.globalAlpha = boltAlpha * 0.8;
      ctx.strokeStyle = `rgb(${fx.colors.accent[0]},${fx.colors.accent[1]},${fx.colors.accent[2]})`;
      ctx.lineWidth = Math.max(1, Math.round((2 * cs) / 2));
      ctx.beginPath();
      for (const seg of bolt.segments) {
        ctx.moveTo(Math.round(seg.x1 * cs), Math.round(seg.y1 * cs));
        ctx.lineTo(Math.round(seg.x2 * cs), Math.round(seg.y2 * cs));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  for (const p of fx.particles) drawParticle(ctx, p, cs);
}
