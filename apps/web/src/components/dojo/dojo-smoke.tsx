'use client';

import { useEffect, useRef } from 'react';
import { ENTRY_WINDUP_MS } from '@/lib/battle-entry';

/**
 * Smoke and steam puffing out of the Battle button while it winds up (owner 2026-10-27). Drawn in the art's own pixel
 * grid — a 120×120 canvas shown at 3 stage px per pixel over the button — as quantised round puffs that drift out and
 * up, swell and fade, plus a few thin steam wisps. Placeholder art until Nzib draws a smoke sheet.
 */
const SIZE = 120;            // canvas pixels (one = one 3 px art pixel on the stage)
const CENTRE = SIZE / 2;
const BUTTON_R = 26;         // the button's opaque radius in art pixels (168 stage px / 3 / 2, a little inside)

interface Puff { born: number; life: number; angle: number; speed: number; rise: number; r0: number; r1: number; shade: number }

function makePuffs(seed: number): Puff[] {
  let s = seed;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const puffs: Puff[] = [];
  // Most of them burst out as the button spins, a few lingering after.
  for (let i = 0; i < 26; i++) {
    const born = 0.18 * ENTRY_WINDUP_MS + rand() * 0.62 * ENTRY_WINDUP_MS;
    puffs.push({ born, life: 700 + rand() * 600, angle: rand() * Math.PI * 2, speed: 10 + rand() * 14, rise: 8 + rand() * 12, r0: 2 + rand() * 2, r1: 6 + rand() * 6, shade: rand() });
  }
  return puffs;
}

const SHADES = ['#ffffff', '#ecebe8', '#d6d3cc', '#b9b4ab'];

export function DojoSmoke() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const puffs = makePuffs(Math.floor(Math.random() * 1e6) + 1);
    const start = performance.now();
    let raf = 0;
    const disc = (cx: number, cy: number, r: number) => {
      const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r), y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) ctx.fillRect(x, y, 1, 1);
      }
    };
    const frame = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, SIZE, SIZE);
      let alive = false;
      for (const p of puffs) {
        const age = t - p.born;
        if (age < 0) { alive = true; continue; }
        const k = age / p.life;
        if (k >= 1) continue;
        alive = true;
        const ease = 1 - (1 - k) ** 2;
        const dist = BUTTON_R * 0.75 + p.speed * ease;
        const cx = CENTRE + Math.cos(p.angle) * dist;
        const cy = CENTRE + Math.sin(p.angle) * dist * 0.8 - p.rise * ease;
        const r = p.r0 + (p.r1 - p.r0) * ease;
        // Fade in fast, out slowly; the shade darkens a step as the puff thins.
        ctx.globalAlpha = Math.min(1, k * 6) * (1 - k) ** 1.4 * 0.9;
        ctx.fillStyle = SHADES[Math.min(SHADES.length - 1, Math.floor(p.shade * 2 + k * 2))];
        disc(Math.round(cx), Math.round(cy), r);
        // A thin wisp of steam above the bigger puffs.
        if (p.r1 > 9 && k > 0.2) { ctx.globalAlpha *= 0.7; ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(cx), Math.round(cy - r - 2 - k * 6), 1, 2); }
      }
      ctx.globalAlpha = 1;
      if (alive) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="dojo-smoke" width={SIZE} height={SIZE} aria-hidden="true" data-testid="dojo-smoke" />;
}
