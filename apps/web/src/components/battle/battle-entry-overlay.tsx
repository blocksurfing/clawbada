'use client';

/**
 * The web half of the battle entry sequence: Nzib's Shifu-under-the-tree loading loop, full screen, over everything.
 *
 * A straight port of his workbench renderer (design/website/workbench/components/web-loading.js + web-loading.css,
 * 57ed790): a 320×180 canvas scaled to cover the viewport with pixel snapping, nine layers in his order where the
 * hill is a ten-frame image sequence and the leaves and Shifu are 3200×180 ten-frame sheets, 100 ms a frame
 * (lib/loading-timeline.ts), "LOADING" bottom-right in Upheaval with dots cycling every 400 ms. Reduced motion
 * freezes frame 0 and the dots and drops the fades. Mounted once in the root layout; lib/battle-entry.ts says when.
 */
import { useEffect, useRef, useState } from 'react';
import { ENTRY_FADE_MS, reducedMotion, useBattleEntry } from '@/lib/battle-entry';
import { loadingFrame } from '@/lib/loading-timeline';

const ART_BASE = '/loading';
/** Nzib's draw order; `Hill` is the frame sequence Hill1..Hill10, the sheets are 3200×180 strips. */
const ORDER = ['BG', 'Clouds', 'Hill', 'Rock', 'Tree', 'Back_Leaves', 'Tree_Leaves', 'Shifu', 'Front_Leaves'] as const;
const SHEETS = new Set(['Back_Leaves', 'Shifu', 'Front_Leaves']);
const FILES = ['BG', 'Clouds', 'Rock', 'Tree', 'Back_Leaves', 'Tree_Leaves', 'Shifu', 'Front_Leaves', ...Array.from({ length: 10 }, (_, i) => `Hill${i + 1}`)];
const DOTS = ['...', '..', '.', '..'];
const BED = '#aecdc6';

let imagesPromise: Promise<Record<string, HTMLImageElement>> | null = null;
/** Decode the 18 layers once per tab (a few KB each). Called on first mount so the first press paints at once. */
function loadImages(): Promise<Record<string, HTMLImageElement>> {
  if (!imagesPromise) {
    imagesPromise = Promise.all(
      FILES.map(async (name) => {
        const img = new Image();
        img.src = `${ART_BASE}/${name}.png`;
        await img.decode();
        return [name, img] as const;
      }),
    ).then((pairs) => Object.fromEntries(pairs)).catch((err) => { imagesPromise = null; throw err; });
  }
  return imagesPromise;
}

export function BattleEntryOverlay() {
  const entry = useBattleEntry();
  const visible = entry.phase !== 'idle';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dotsRef = useRef<HTMLSpanElement | null>(null);
  // Fade in on the frame after mount (the Dojo page's own fade-out IS this overlay fading in over it).
  const [shown, setShown] = useState(false);

  useEffect(() => { void loadImages().catch((err) => console.warn('[BattleEntry] loading art failed', err)); }, []);

  useEffect(() => {
    if (!visible) { setShown(false); return; }
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    let cancelled = false;
    const reduced = reducedMotion();
    const start = performance.now();
    void loadImages().then((images) => {
      if (cancelled) return;
      const paint = (now: number) => {
        const frame = reduced ? 0 : loadingFrame(now - start);
        const dots = DOTS[reduced ? 0 : Math.floor((now - start) / 400) % DOTS.length];
        if (dotsRef.current && dotsRef.current.textContent !== dots) dotsRef.current.textContent = dots;
        ctx.clearRect(0, 0, 320, 180);
        for (const name of ORDER) {
          const img = images[name === 'Hill' ? `Hill${frame + 1}` : name];
          if (!img) continue;
          ctx.drawImage(img, SHEETS.has(name) ? frame * 320 : 0, 0, 320, 180, 0, 0, 320, 180);
        }
        canvas.dataset.frame = String(frame);
        raf = requestAnimationFrame(paint);
      };
      paint(start);
    }).catch(() => { /* the bed colour + LOADING still show */ });
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [visible]);

  if (!visible) return null;
  const fade = reducedMotion() ? 0 : ENTRY_FADE_MS;
  return (
    <div
      role="status"
      aria-label="Loading"
      data-testid="battle-entry"
      data-phase={entry.phase}
      data-kind={entry.kind ?? ''}
      className="fixed inset-0 z-[200] overflow-hidden"
      style={{ background: BED, opacity: shown && entry.phase === 'web' ? 1 : 0, transition: `opacity ${fade}ms ease-out`, pointerEvents: entry.phase === 'leaving' ? 'none' : 'auto' }}
    >
      <canvas
        ref={canvasRef}
        width={320}
        height={180}
        aria-hidden="true"
        className="absolute left-1/2 top-1/2"
        style={{ width: 'max(100vw, 177.777778vh)', height: 'max(100vh, 56.25vw)', transform: 'translate(-50%, -50%)', imageRendering: 'pixelated' }}
      />
      <p
        className="absolute m-0 text-black"
        style={{ right: 'max(5vw, env(safe-area-inset-right))', bottom: 'max(7vh, env(safe-area-inset-bottom))', fontFamily: 'var(--font-upheaval), sans-serif', fontSize: 'clamp(28px, 4vw, 64px)', lineHeight: 1.2 }}
      >
        LOADING<span ref={dotsRef} aria-hidden="true" style={{ display: 'inline-block', width: '1.5em', textAlign: 'left' }}>...</span>
      </p>
    </div>
  );
}
