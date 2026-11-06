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
/** The doorway's inner right edge in Dojo_Dark.png (backdrop px), one value per row from row 22: the slanted beam (rows
 *  22–41), the post (42–74), the lower slant (75–83). Measured from Nzib's refreshed backdrop (b7e9d5e) — the first
 *  table bent back left below row 49, so a squirrel on the lowered sign (sidebar open) appeared in mid-air, and its
 *  head showed over the beam (owner 2026-11-05). The squirrel comes out from behind this wood (owner 2026-11-01). */
const DOOR_EDGE_FIRST_ROW = 22;
const DOOR_EDGE = [377, 379, 381, 383, 385, 387, 389, 391, 393, 395, 397, 399, 401, 403, 405, 407, 409, 411, 413, 415,
  416, 416, 416, 416, 416, 416, 416, 416, 416, 416, 416, 416, 416, 416, 416, 416, 416, 416, 416, 416, 416, 416, 416,
  416, 416, 416, 416, 416, 416, 416, 416, 416, 416, 415, 413, 411, 409, 407, 405, 403, 401, 399];
const BACKDROP_W = 640, BACKDROP_H = 360;
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
      // The outer box is the clip: its right side follows the doorway's wooden frame row by row — the slanted beam as
      // well as the post — so the squirrel runs out from behind the wood, head included; the board's end caps it where
      // the sign stops first.
      const left = r.left + LEFT_FROM_BOARD * s;
      const top = r.top + (BOARD_TOP_ROW - RUN_FEET_ROW - 1) * s;
      const height = run.height * s;
      const boardEnd = r.right - BOARD_TOP_RIGHT_INSET * s;
      const outline = doorOutline(top, height);
      const right = (x: number) => Math.max(0, Math.min(boardEnd, x) - left);
      const width = outline.length ? Math.max(...outline.map((p) => right(p.x))) : right(boardEnd);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      el.style.clipPath = outline.length
        ? `polygon(0 0, ${outline.map((p) => `${right(p.x)}px ${p.y - top}px`).join(', ')}, 0 ${height}px)`
        : '';
      frameEl.style.width = `${run.width * s}px`;
      frameEl.style.height = `${run.height * s}px`;
      frameEl.style.backgroundSize = `${run.width * run.frames * s}px ${run.height * s}px`;
      return s;
    };
    // The doorway edge as screen points down the band [top, top + height]: two points per backdrop row (its top and
    // bottom), from the arena backdrop (object-fit: cover, centred). Rows above and below the table take its end values.
    const doorOutline = (top: number, height: number): { x: number; y: number }[] => {
      const arena = document.querySelector<HTMLElement>('.dojo-arena');
      if (!arena) return [];
      const a = arena.getBoundingClientRect();
      const k = Math.max(a.width / BACKDROP_W, a.height / BACKDROP_H);
      const ox = a.left + (a.width - BACKDROP_W * k) / 2, oy = a.top + (a.height - BACKDROP_H * k) / 2;
      const pts: { x: number; y: number }[] = [];
      const first = Math.floor((top - oy) / k), last = Math.floor((top + height - oy) / k);
      const edgeOf = (row: number) => DOOR_EDGE[Math.max(0, Math.min(DOOR_EDGE.length - 1, row - DOOR_EDGE_FIRST_ROW))];
      for (let row = first; row <= last; row++) {
        // The beam is a staircase of 2-px steps; the nearest step either side keeps the head off its dark outline when
        // the screen's pixel grid and the art's disagree by a fraction (the post, a straight edge, is unchanged).
        const x = ox + Math.min(edgeOf(row - 1), edgeOf(row), edgeOf(row + 1)) * k;
        pts.push({ x, y: Math.max(top, oy + row * k) }, { x, y: Math.min(top + height, oy + (row + 1) * k) });
      }
      return pts;
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
      step(start);   // the first pose and shift are set before it shows, so no frame ever paints a stale position
      el.hidden = false;
      el.dataset.running = 'true';
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
