'use client';

/**
 * The web half of the battle entry sequence: Nzib's Shifu-under-the-tree loading loop, full screen, over everything.
 *
 * A straight port of his workbench renderer (design/website/workbench/components/web-loading.js + web-loading.css,
 * 57ed790): a 320×180 canvas scaled to cover the viewport with pixel snapping, nine layers in his order where the
 * hill is a ten-frame image sequence and the leaves and Shifu are 3200×180 ten-frame sheets, 100 ms a frame
 * (lib/loading-timeline.ts), "LOADING" bottom-right in Upheaval with dots cycling every 400 ms.
 *
 * The way in is a Looney Tunes iris (owner 2026-10-27): this element — the theme's dark navy — is masked by a circle
 * around the pressed button that closes to nothing (ENTRY_IRIS_CLOSE_MS, ease-in, a hard edge), holds a beat of navy,
 * then the loop layer opens through a circle growing from the middle (ENTRY_IRIS_OPEN_MS, ease-out). One rAF loop sets
 * both radii; the masks come off once the loop is fully open. The way out is one fade of the whole thing over the Unity
 * training scene (ENTRY_FADE_MS). The breeze (lib/entry-ambience.ts) and the Dojo's arena music start at the press and
 * fade in over 3 s together. Reduced motion freezes frame 0 and the dots and drops the iris and every fade. Mounted
 * once in the root layout; lib/battle-entry.ts says when.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { ENTRY_FADE_MS, ENTRY_IRIS_CLOSE_MS, ENTRY_IRIS_OPEN_MS, ENTRY_NAVY_BEAT_MS, getEntryState, reducedMotion, useBattleEntry } from '@/lib/battle-entry';
import { cancelEntryAmbience, preloadEntryAmbience, startEntryAmbience, stopEntryAmbience } from '@/lib/entry-ambience';
import { cancelEntryArenaMusic, startEntryArenaMusic } from '@/lib/arena-music';
import { loadingFrame } from '@/lib/loading-timeline';

const ART_BASE = '/loading';
/** Nzib's draw order; `Hill` is the frame sequence Hill1..Hill10, the sheets are 3200×180 strips. */
const ORDER = ['BG', 'Clouds', 'Hill', 'Rock', 'Tree', 'Back_Leaves', 'Tree_Leaves', 'Shifu', 'Front_Leaves'] as const;
const SHEETS = new Set(['Back_Leaves', 'Shifu', 'Front_Leaves']);
const FILES = ['BG', 'Clouds', 'Rock', 'Tree', 'Back_Leaves', 'Tree_Leaves', 'Shifu', 'Front_Leaves', ...Array.from({ length: 10 }, (_, i) => `Hill${i + 1}`)];
const DOTS = ['...', '..', '.', '..'];
/** The loop's own bed, behind the art. */
const BED = '#aecdc6';
/** The theme's dark navy — Nzib's page colour (market.css `.market-page`, the tab icon's tile). */
export const NAVY = '#192c53';
const easeIn = (t: number) => t * t * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** Distance from (x, y) to the farthest window corner: the radius at which a circle there covers the whole window. */
const coverRadius = (x: number, y: number) => Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 2;

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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loopRef = useRef<HTMLDivElement | null>(null);
  const dotsRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    void loadImages().catch((err) => console.warn('[BattleEntry] loading art failed', err));
    preloadEntryAmbience();
  }, []);

  // The iris: close on the pressed button, a beat of navy, open Shifu from the middle. Radii in window px, every frame.
  // A layout effect: the first mask is on before the overlay is ever painted (no flash of navy), and React's style
  // prop never touches the mask afterwards.
  useLayoutEffect(() => {
    if (!visible) return;
    const root = rootRef.current, loop = loopRef.current;
    if (!root || !loop) return;
    const setMask = (el: HTMLElement, value: string) => { el.style.maskImage = value; el.style.setProperty('-webkit-mask-image', value); };
    // Behind a scene that eases back under the iris: navy, not the page colour.
    const bodyBg = document.body.style.backgroundColor;
    document.body.style.backgroundColor = NAVY;
    const restore = () => { document.body.style.backgroundColor = bodyBg; };
    if (reducedMotion()) { setMask(root, 'none'); setMask(loop, 'none'); loop.style.visibility = 'visible'; return restore; }
    const origin = getEntryState().origin ?? { x: innerWidth / 2, y: innerHeight / 2 };
    const start = performance.now();
    // When the iris began, for the harness (performance.now() ms; React leaves these attributes alone).
    root.dataset.shownAt = String(start);
    root.dataset.irisX = String(Math.round(origin.x));
    root.dataset.irisY = String(Math.round(origin.y));
    let raf = 0, last = start, maxGap = 0, closedT: number | null = null;
    const frame = (now: number) => {
      const t = now - start;
      if (now - last > maxGap) { maxGap = now - last; root.dataset.maxFrameGapAt = String(Math.round(t)); }
      root.dataset.frameGaps = `${root.dataset.frameGaps ?? ''}${Math.round(now - last)},`;
      last = now;
      root.dataset.maxFrameGap = String(Math.round(maxGap));   // for the harness: the longest frame while the iris moves
      // Closing: the page shows through a shrinking hole; outside it is navy.
      const close = Math.min(1, t / ENTRY_IRIS_CLOSE_MS);
      const r = coverRadius(origin.x, origin.y) * (1 - easeIn(close));
      if (close < 1) setMask(root, `radial-gradient(circle at ${origin.x}px ${origin.y}px, transparent ${r}px, #000 ${r + 1}px)`);
      else setMask(root, 'none');
      root.dataset.irisR = String(Math.round(r));
      if (close >= 1 && closedT === null) { closedT = t; root.dataset.closedAt = String(now); }   // for the harness
      // Opening: after the beat, Shifu shows through a growing circle in the middle.
      // The beat runs from when the iris actually shut (a late frame must not eat the navy beat).
      const open = closedT === null ? 0 : Math.min(1, Math.max(0, (t - Math.max(ENTRY_IRIS_CLOSE_MS, closedT) - ENTRY_NAVY_BEAT_MS) / ENTRY_IRIS_OPEN_MS));
      const cx = innerWidth / 2, cy = innerHeight / 2;
      const R = coverRadius(cx, cy) * easeOut(open);
      loop.style.visibility = open > 0 ? 'visible' : 'hidden';
      if (open > 0 && !root.dataset.openedAt) root.dataset.openedAt = String(now);   // for the harness
      if (open < 1) setMask(loop, `radial-gradient(circle at ${cx}px ${cy}px, #000 ${R}px, transparent ${R + 1}px)`);
      else setMask(loop, 'none');
      loop.dataset.irisR = String(Math.round(R));
      if (open < 1) raf = requestAnimationFrame(frame);
      else root.dataset.revealedAt = String(performance.now());
    };
    frame(start);
    return () => { cancelAnimationFrame(raf); restore(); };
  }, [visible]);

  // The breeze: in with the loop's reveal (after the curtain), out with the handover, quick out on a cancel. The arena's
  // music (when the press knew the arena — the Dojo) fades in with it and does NOT stop at the handover: it plays on
  // through the Unity training scene into the battle, which adopts it (lib/arena-music.ts). Only a cancel stops it.
  const prevPhase = useRef(entry.phase);
  useEffect(() => {
    const from = prevPhase.current;
    prevPhase.current = entry.phase;
    if (entry.phase === 'web') {
      // Both start with the iris and fade in over 3 s together (owner 2026-10-27).
      startEntryAmbience(0);
      if (entry.arena) startEntryArenaMusic(entry.arena, 0);
    } else if (entry.phase === 'leaving') stopEntryAmbience();
    else {
      cancelEntryAmbience();
      // web → idle without a handover = the start failed or was abandoned — unless an entry starts straight back up
      // (the battle page cancels on unmount and restarts on mount; React's dev mode does both at once): stop the bed
      // only if the entry is still down half a second later.
      if (from === 'web') window.setTimeout(() => { if (getEntryState().phase === 'idle') cancelEntryArenaMusic(); }, 500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.phase]);

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
  const reduced = reducedMotion();
  const leaving = entry.phase === 'leaving';
  // The root IS the navy iris: masked on the way in (the effect above), faded out over the training scene.
  const rootFade = reduced || !leaving ? 0 : ENTRY_FADE_MS;
  return (
    <div
      ref={rootRef}
      role="status"
      aria-label="Loading"
      data-testid="battle-entry"
      data-phase={entry.phase}
      data-kind={entry.kind ?? ''}
      className="fixed inset-0 z-[200] overflow-hidden"
      style={{ background: NAVY, opacity: leaving ? 0 : 1, transition: `opacity ${rootFade}ms ease-out`, pointerEvents: leaving ? 'none' : 'auto' }}
    >
      <div
        ref={loopRef}
        data-testid="battle-entry-loop"
        className="absolute inset-0"
        style={{ background: BED, visibility: 'hidden' }}
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
    </div>
  );
}
