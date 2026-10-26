'use client';

/**
 * The web half of the battle entry sequence: Nzib's Shifu-under-the-tree loading loop, full screen, over everything.
 *
 * A straight port of his workbench renderer (design/website/workbench/components/web-loading.js + web-loading.css,
 * 57ed790): a 320×180 canvas scaled to cover the viewport with pixel snapping, nine layers in his order where the
 * hill is a ten-frame image sequence and the leaves and Shifu are 3200×180 ten-frame sheets, 100 ms a frame
 * (lib/loading-timeline.ts), "LOADING" bottom-right in Upheaval with dots cycling every 400 ms.
 *
 * The way in is two fades (owner 2026-10-23): this element's own background — the theme's dark navy — fades in over
 * the page (ENTRY_CURTAIN_MS), then the loop layer fades in from that navy (ENTRY_REVEAL_MS, delayed by the
 * curtain). The way out is one fade of the whole thing over the Unity training scene (ENTRY_FADE_MS). The breeze
 * (lib/entry-ambience.ts) starts with the reveal and fades out with the way out. Reduced motion freezes frame 0 and
 * the dots and drops every fade. Mounted once in the root layout; lib/battle-entry.ts says when.
 */
import { useEffect, useRef, useState } from 'react';
import { ENTRY_CURTAIN_MS, ENTRY_FADE_MS, ENTRY_REVEAL_MS, getEntryState, reducedMotion, useBattleEntry } from '@/lib/battle-entry';
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
  const dotsRef = useRef<HTMLSpanElement | null>(null);
  // Fades start on the frame after mount: the curtain over the page, then the loop over the curtain.
  const [shown, setShown] = useState(false);

  useEffect(() => {
    void loadImages().catch((err) => console.warn('[BattleEntry] loading art failed', err));
    preloadEntryAmbience();
  }, []);

  useEffect(() => {
    if (!visible) { setShown(false); return; }
    const raf = requestAnimationFrame(() => {
      setShown(true);
      // When the fades began, for the harness (performance.now() ms; React leaves this attribute alone).
      if (rootRef.current) rootRef.current.dataset.shownAt = String(performance.now());
    });
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  // The breeze: in with the loop's reveal (after the curtain), out with the handover, quick out on a cancel. The arena's
  // music (when the press knew the arena — the Dojo) fades in with it and does NOT stop at the handover: it plays on
  // through the Unity training scene into the battle, which adopts it (lib/arena-music.ts). Only a cancel stops it.
  const prevPhase = useRef(entry.phase);
  useEffect(() => {
    const from = prevPhase.current;
    prevPhase.current = entry.phase;
    if (entry.phase === 'web') {
      startEntryAmbience(reducedMotion() ? 0 : ENTRY_CURTAIN_MS);
      if (entry.arena) startEntryArenaMusic(entry.arena, reducedMotion() ? 0 : ENTRY_CURTAIN_MS);
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
  // The root IS the navy curtain: in over the page (curtain), out over the training scene (fade).
  const rootFade = reduced ? 0 : leaving ? ENTRY_FADE_MS : ENTRY_CURTAIN_MS;
  const rootEase = leaving ? 'ease-out' : 'ease-in-out';
  // The loop fades in from the navy once the curtain is down; it leaves with the root.
  const loopFade = reduced ? 0 : ENTRY_REVEAL_MS;
  const loopDelay = reduced ? 0 : ENTRY_CURTAIN_MS;
  return (
    <div
      ref={rootRef}
      role="status"
      aria-label="Loading"
      data-testid="battle-entry"
      data-phase={entry.phase}
      data-kind={entry.kind ?? ''}
      className="fixed inset-0 z-[200] overflow-hidden"
      style={{ background: NAVY, opacity: shown && !leaving ? 1 : 0, transition: `opacity ${rootFade}ms ${rootEase}`, pointerEvents: leaving ? 'none' : 'auto' }}
    >
      <div
        data-testid="battle-entry-loop"
        className="absolute inset-0"
        style={{ background: BED, opacity: shown ? 1 : 0, transition: `opacity ${loopFade}ms ease-in-out ${loopDelay}ms` }}
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
