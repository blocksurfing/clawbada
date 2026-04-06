import type { VFXEffect } from '../types';
import { spawnParticle } from '../particles';
import { drawParticle } from './draw-particle';

interface TentacleData {
  xOff: number;
  sineAmp: number;
  sineFreq: number;
  height: number;
}

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
 * BIND (Kraken -- class 8)
 * Tentacles from below + stun flash lightning
 */
export function tick(fx: VFXEffect, dt: number): void {
  if (!fx.target) return;
  // Generate tentacle paths once
  if (!fx._data.tentacles) {
    const count = [2, 3, 4][fx.tier - 1] || 2;
    fx._data.tentacles = [];
    for (let i = 0; i < count; i++) {
      (fx._data.tentacles as TentacleData[]).push({
        xOff: (Math.random() - 0.5) * 24,
        sineAmp: 3 + Math.random() * 5,
        sineFreq: 2 + Math.random() * 2,
        height: 25 + Math.random() * 15,
      });
    }
  }
  // Lightning bolt generation
  if (!fx._data.bolts) fx._data.bolts = [];
  const bolts = fx._data.bolts as BoltData[];
  if (
    fx.progress > 0.3 &&
    fx.progress < 0.8 &&
    fx._canSpawn !== false &&
    Math.random() < 0.15
  ) {
    // Create zigzag bolt
    const startX = fx.target.x + (Math.random() - 0.5) * 20;
    const startY = fx.target.y - 15;
    const segments: BoltSegment[] = [];
    let bx = startX;
    let by = startY;
    for (let s = 0; s < 3; s++) {
      const nx = bx + (Math.random() - 0.5) * 12;
      const ny = by + 5 + Math.random() * 8;
      segments.push({ x1: bx, y1: by, x2: nx, y2: ny });
      bx = nx;
      by = ny;
    }
    bolts.push({ segments, life: 200 });
  }
  // Tick bolt lifetimes
  for (let i = bolts.length - 1; i >= 0; i--) {
    bolts[i].life -= dt;
    if (bolts[i].life <= 0) bolts.splice(i, 1);
  }
  // Coral spark particles
  if (
    fx.progress > 0.3 &&
    fx.progress < 0.9 &&
    fx._canSpawn !== false &&
    Math.random() < 0.2
  ) {
    spawnParticle(
      fx,
      fx.target.x + (Math.random() - 0.5) * 14,
      fx.target.y + (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 20,
      (Math.random() - 0.5) * 20,
      fx.colors.accent,
      1.5 + Math.random(),
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
  if (!fx.target) return;
  const tx = Math.round(fx.target.x * cs);
  const ty = Math.round(fx.target.y * cs);

  if (layer === 'under') {
    // Tentacles rising from below
    const tentacles = fx._data.tentacles as TentacleData[] | undefined;
    if (tentacles) {
      let extendP: number;
      if (fx.progress < 0.3) extendP = fx.progress / 0.3;
      else if (fx.progress < 0.8) extendP = 1;
      else extendP = Math.max(0, 1 - (fx.progress - 0.8) / 0.2);

      ctx.globalAlpha = 0.8;
      const tentW = Math.max(1, Math.round((3 * cs) / 2));
      ctx.fillStyle = `rgb(${fx.colors.primary[0]},${fx.colors.primary[1]},${fx.colors.primary[2]})`;

      for (const tent of tentacles) {
        const baseX = tx + Math.round(tent.xOff * cs);
        const baseY = ty + Math.round(20 * cs); // start below target
        const h = tent.height * extendP * cs;
        const steps = 12;
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          const px =
            baseX +
            Math.round(
              Math.sin(t * Math.PI * tent.sineFreq + fx.progress * 4) *
                tent.sineAmp *
                cs,
            );
          const py = Math.round(baseY - h * t);
          ctx.fillRect(px, py, tentW, tentW);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  if (layer === 'over') {
    // Lightning bolts
    const bolts = fx._data.bolts as BoltData[] | undefined;
    if (bolts) {
      ctx.lineCap = 'square';
      for (const bolt of bolts) {
        const boltAlpha = Math.min(1, bolt.life / 100);
        ctx.globalAlpha = boltAlpha;
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
}
