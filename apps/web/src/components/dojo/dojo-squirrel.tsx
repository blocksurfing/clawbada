'use client';

import { useEffect, useRef } from 'react';
import { reducedMotion } from '@/lib/battle-entry';
import run from '../../../public/ui/dojo/squirrel.json';

/**
 * Nzib's ninja squirrel on the Dojo lobby (owner 2026-10-30). In battle (DojoSquirrel.cs) it runs over the stones above
 * the doorway, jumps into the blossom tree and is gone, three leaves falling. On the lobby the Dojo sign hangs over
 * those stones, so here it runs along the TOP OF THE SIGN instead and makes the same leap into the tree just left of
 * it. The run is rendered out of the Unity arena by WebSpriteExporter (`squirrel.png` strip + `squirrel.json`); its
 * feet run on row 44 of the strip (RUN_FEET_ROW), which stands on the board's top edge (row 16 of Wooden_Sign.png). It
 * is drawn at the sign's own pixel size (one pixel size for all pixel art, Nzib's rule).
 *
 * Timing as in battle: the first run 10–20 s after the lobby opens, then a random 30–60 s after each run. Skipped while
 * the tab is hidden and under reduced motion. `?squirrel=now` runs it after a second (probes).
 */
const SRC = '/ui/dojo/squirrel.png';
/** The strip row the running feet stand on (frames 0–20), and the sign board's top edge in its 64-px-tall art. */
const RUN_FEET_ROW = 44, BOARD_TOP_ROW = 16;
/** Where the strip's left edge sits from the board's left edge, in art px: the run crosses the open middle of the board
 *  and the leap lands in the blossom crown over its left end. */
const LEFT_FROM_BOARD = 30;
/** The run starts mid-board, so the squirrel fades in over its first frames instead of popping into being. */
const FADE_IN_MS = 180;
const RUN_MS = (run.frames / run.fps) * 1000;
const FIRST_MS: [number, number] = [10_000, 20_000];
const GAP_MS: [number, number] = [30_000, 60_000];
const between = ([lo, hi]: [number, number]) => lo + Math.random() * (hi - lo);

export function DojoSquirrel() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    let timer: ReturnType<typeof setTimeout> | null = null, raf = 0, stopped = false;

    // On the sign: its board canvas is 64 art px tall, so its rect gives both the place and the pixel size.
    const place = () => {
      const board = document.querySelector<HTMLElement>('[data-dojo-sign-board]');
      const r = board?.getBoundingClientRect();
      if (!r || !r.height) return 0;
      const s = r.height / 64;
      el.style.left = `${r.left + LEFT_FROM_BOARD * s}px`;
      el.style.top = `${r.top + (BOARD_TOP_ROW - RUN_FEET_ROW - 1) * s}px`;
      el.style.width = `${run.width * s}px`;
      el.style.height = `${run.height * s}px`;
      el.style.backgroundSize = `${run.width * run.frames * s}px ${run.height * s}px`;
      return s;
    };
    const play = () => {
      if (stopped) return;
      if (document.hidden) { schedule(GAP_MS); return; }
      const start = performance.now();
      el.hidden = false;
      el.dataset.running = 'true';
      const step = (now: number) => {
        const frame = Math.floor(((now - start) / 1000) * run.fps);
        if (stopped || frame >= run.frames) {
          el.hidden = true;
          delete el.dataset.running;
          if (!stopped) schedule(GAP_MS);
          return;
        }
        const s = place();
        el.style.backgroundPosition = `${-frame * run.width * s}px 0`;
        el.style.opacity = String(Math.min(1, (now - start) / FADE_IN_MS));
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const schedule = (range: [number, number]) => { timer = setTimeout(play, between(range)); };

    const now = new URLSearchParams(window.location.search).get('squirrel') === 'now';
    if (now) timer = setTimeout(play, 1000);
    else schedule(FIRST_MS);
    return () => { stopped = true; if (timer) clearTimeout(timer); cancelAnimationFrame(raf); };
  }, []);
  return <div ref={ref} className="dojo-squirrel" data-testid="dojo-squirrel" hidden aria-hidden="true" style={{ backgroundImage: `url('${SRC}')` }} data-run-ms={RUN_MS} />;
}
