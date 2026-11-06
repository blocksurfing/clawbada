'use client';

import { useEffect, type RefObject } from 'react';
import { loadPixelImage, tileAxis } from '@/components/pixel/pixel-assets';

const SHINE = '/ui/effects/Shine.png';
const MASK = '/ui/tileset/GoldenShineMask.png';

/**
 * Nzib's button shine (design/website e35532b, `components/pixel/shine.js`): every 5 s a highlight sweeps right to left
 * across the gold button (4.0–4.8 s into each cycle), cut to the button's art by a mask nine-sliced from
 * GoldenShineMask.png. Drawn into `shineRef` at the panel canvas's resolution; off under reduced motion, in a hidden tab
 * and while pressed. `?shine=paused` freezes it mid-sweep (his inspection switch).
 */
export function useButtonShine(buttonRef: RefObject<HTMLElement | null>, baseRef: RefObject<HTMLCanvasElement | null>, shineRef: RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const element = buttonRef.current, canvas = shineRef.current;
    if (!element || !canvas) return;
    let image: HTMLImageElement | null = null, mask: HTMLImageElement | null = null, raf = 0, disposed = false;
    loadPixelImage(SHINE).then((i) => { image = i; }).catch(console.error);
    loadPixelImage(MASK).then((i) => { mask = i; }).catch(console.error);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const frozen = new URLSearchParams(window.location.search).get('shine') === 'paused';
    const start = performance.now();
    const draw = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(draw);
      const base = baseRef.current;
      if (!base || element.dataset.pixelReady !== 'true') return;
      if (canvas.width !== base.width || canvas.height !== base.height) { canvas.width = base.width; canvas.height = base.height; }
      canvas.style.width = base.style.width; canvas.style.height = base.style.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const phase = frozen ? 4400 : (now - start) % 5000;
      if (reduced.matches || document.hidden || element.matches(':active') || phase < 4000 || phase >= 4800 || !image || !mask) return;
      const progress = (phase - 4000) / 800;
      const height = Math.max(canvas.height, image.height);
      const width = Math.round((image.width * height) / image.height);
      const x = Math.round(canvas.width - progress * (canvas.width + width));
      ctx.imageSmoothingEnabled = false;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(image, x, 0, width, height);
      // The mask, nine-sliced to the button's size (no canvas readback: privacy protections can perturb it).
      const m = document.createElement('canvas');
      m.width = canvas.width; m.height = canvas.height;
      const mc = m.getContext('2d');
      if (!mc) return;
      mc.imageSmoothingEnabled = false;
      for (const row of tileAxis(canvas.height, 16)) for (const col of tileAxis(canvas.width, 16)) {
        mc.drawImage(mask, 96 + col.source, row.source, col.size, row.size, col.dest, row.dest, col.size, row.size);
      }
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(m, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    };
    raf = requestAnimationFrame(draw);
    return () => { disposed = true; cancelAnimationFrame(raf); };
  }, [buttonRef, baseRef, shineRef]);
}
