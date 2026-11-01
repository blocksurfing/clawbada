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
 * the tab is hidden and under reduced motion. `?squirrel=now` runs it after 2.5 s (probes, clips).
 */
const SRC = '/ui/dojo/squirrel.png';
/** The strip row the running feet stand on (frames 0–20), and the sign board's top edge in its 64-px-tall art. */
const RUN_FEET_ROW = 44, BOARD_TOP_ROW = 16;
/** The board's top edge stops this many art px short of its canvas's right edge (Wooden_Sign.png's end cap). */
const BOARD_TOP_RIGHT_INSET = 6;
/** How many art px the squirrel takes to fade in as it comes round the end of the board. */
const EDGE_SOFTNESS = 10;
/** Where the strip's left edge sits from the board's left edge, in art px: the run crosses the open middle of the board
 *  and the leap lands in the blossom crown over its left end. */
const LEFT_FROM_BOARD = 30;
/** The run enters from behind the board's right end instead of appearing mid-board (owner 2026-10-31: "appears out of
 *  thin air"). Nzib's run cycle is 12 frames (six poses, two frames each) that carry the squirrel CYCLE_STRIDE art px
 *  left; whole cycles are played first, each shifted one stride further right, starting past the board's end — so the
 *  squirrel comes round the end of the sign and runs straight on into his run with no jump or repeated pose. */
const CYCLE_FRAMES = 12, CYCLE_STRIDE = 25;
/** The strip's x where the run starts (frame 0's left edge). */
const RUN_START_X = 59;
const RUN_MS = (run.frames / run.fps) * 1000;   // plus the run-in, which depends on the sign's width
const FIRST_MS: [number, number] = [10_000, 20_000];
const GAP_MS: [number, number] = [30_000, 60_000];
const between = ([lo, hi]: [number, number]) => lo + Math.random() * (hi - lo);

export function DojoSquirrel() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current, frameEl = el?.firstElementChild as HTMLElement | null;
    if (!el || !frameEl || reducedMotion()) return;
    let timer: ReturnType<typeof setTimeout> | null = null, raf = 0, stopped = false;

    // On the sign: its board canvas is 64 art px tall, so its rect gives both the place and the pixel size.
    const place = () => {
      const board = document.querySelector<HTMLElement>('[data-dojo-sign-board]');
      const r = board?.getBoundingClientRect();
      if (!r || !r.height) return 0;
      const s = r.height / 64;
      // The outer box is the clip: from the strip's left edge to the board's right end.
      const left = r.left + LEFT_FROM_BOARD * s;
      el.style.left = `${left}px`;
      el.style.top = `${r.top + (BOARD_TOP_ROW - RUN_FEET_ROW - 1) * s}px`;
      el.style.width = `${Math.max(0, r.right - BOARD_TOP_RIGHT_INSET * s - left)}px`;   // clipped where the board's top edge ends
      el.style.height = `${run.height * s}px`;
      // A soft edge where it comes round the board's end, so it materialises over a few pixels instead of along a line.
      const mask = `linear-gradient(to left, transparent 0, #000 ${EDGE_SOFTNESS * s}px)`;
      el.style.maskImage = mask;
      el.style.webkitMaskImage = mask;
      frameEl.style.width = `${run.width * s}px`;
      frameEl.style.height = `${run.height * s}px`;
      frameEl.style.backgroundSize = `${run.width * run.frames * s}px ${run.height * s}px`;
      return s;
    };
    const play = () => {
      if (stopped) return;
      if (document.hidden) { schedule(GAP_MS); return; }
      const start = performance.now();
      // Enough whole cycles that the first one starts behind the end of the board.
      const s0 = place();
      const clipArt = s0 ? parseFloat(el.style.width) / s0 : run.width;   // still hidden here: read the width we set, not the layout
      const cycles = Math.max(1, Math.ceil((clipArt - RUN_START_X) / CYCLE_STRIDE));
      const runIn = cycles * CYCLE_FRAMES;
      el.hidden = false;
      el.dataset.running = 'true';
      const step = (now: number) => {
        const tick = Math.floor(((now - start) / 1000) * run.fps);
        if (stopped || tick >= runIn + run.frames) {
          el.hidden = true;
          delete el.dataset.running;
          if (!stopped) schedule(GAP_MS);
          return;
        }
        const s = place();
        const inRunIn = tick < runIn;
        const frame = inRunIn ? tick % CYCLE_FRAMES : tick - runIn;
        const shift = inRunIn ? (cycles - Math.floor(tick / CYCLE_FRAMES)) * CYCLE_STRIDE : 0;
        frameEl.style.backgroundPosition = `${-frame * run.width * s}px 0`;
        frameEl.style.transform = `translateX(${shift * s}px)`;
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const schedule = (range: [number, number]) => { timer = setTimeout(play, between(range)); };

    const now = new URLSearchParams(window.location.search).get('squirrel') === 'now';
    if (now) timer = setTimeout(play, 2500);
    else schedule(FIRST_MS);
    return () => { stopped = true; if (timer) clearTimeout(timer); cancelAnimationFrame(raf); };
  }, []);
  return (
    <div ref={ref} className="dojo-squirrel" data-testid="dojo-squirrel" hidden aria-hidden="true" data-run-ms={RUN_MS}>
      <div style={{ backgroundImage: `url('${SRC}')` }} />
    </div>
  );
}
