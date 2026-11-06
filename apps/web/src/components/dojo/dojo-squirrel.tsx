'use client';

import { useEffect, useRef } from 'react';
import { reducedMotion } from '@/lib/battle-entry';
import run from '../../../public/ui/dojo/squirrel.json';

/**
 * Nzib's ninja squirrel on the Dojo lobby (owner 2026-10-30). In battle (DojoSquirrel.cs) it runs over the stones above
 * the doorway, jumps into the blossom tree and is gone, three leaves falling. On the lobby the Dojo sign hangs over
 * those stones, so here it runs along the TOP OF THE SIGN instead and makes the same leap up and left. The run is
 * rendered out of the Unity arena by WebSpriteExporter (`squirrel.png` strip + `squirrel.json`); its feet run on row 44
 * of the strip (RUN_FEET_ROW), which stands on the board's top edge (row 16 of Wooden_Sign.png). It is drawn at the
 * sign's own pixel size (one pixel size for all pixel art, Nzib's rule).
 *
 * The doorway hides it, exactly: the box is masked by Window_Mask.png — the hole in Nzib's wall layer (BG_Dojo.png,
 * which matches the lobby backdrop pixel for pixel), placed like the backdrop (object-fit: cover). So it runs out from
 * behind the post or the slanted beam (owner 2026-11-01, 2026-11-05) and its leap goes up behind the top beam. In battle
 * the leap ends in the tree; here the tree is not where the leap ends, so the last leap pose carries on up and left
 * (ASCENT) until the top beam has swallowed it, instead of vanishing in mid-air (owner 2026-11-06).
 *
 * Timing as in battle: the first run 10–20 s after the lobby opens, then a random 30–60 s after each run. Skipped while
 * the tab is hidden and under reduced motion. `?squirrel=now` runs it after 2.5 s (probes, clips).
 */
const SRC = '/ui/dojo/squirrel.png';
/** The strip row the running feet stand on (frames 0–20), and the sign board's top edge in its 64-px-tall art. */
const RUN_FEET_ROW = 44, BOARD_TOP_ROW = 16;
/** The board's top edge stops this many art px short of its canvas's right edge (Wooden_Sign.png's end cap). */
const BOARD_TOP_RIGHT_INSET = 6;
const BACKDROP_W = 640, BACKDROP_H = 360;
/** Where the strip's left edge sits from the board's left edge, in art px: the run crosses the open middle of the board
 *  and the leap lands in the blossom crown over its left end. */
const LEFT_FROM_BOARD = 30;
/** The run enters from behind the doorway instead of appearing mid-board (owner 2026-10-31: "appears out of thin air").
 *  Nzib's run cycle is 12 frames (six poses, two frames each) that carry the squirrel CYCLE_STRIDE art px left; whole
 *  cycles are played first, each shifted one stride further right, starting past the board's end — so the squirrel
 *  comes round the end of the sign and runs straight on into his run with no jump or repeated pose. */
const CYCLE_FRAMES = 12, CYCLE_STRIDE = 25;
/** The strip's x where the run starts (frame 0's left edge). */
const RUN_START_X = 59;
/** The leap: frames 24–25 rise 8 px left and 7 px up per frame; the strip then shows nothing until the leaves (28+).
 *  ASCENT more frames carry frame 25's pose on along that line, so the top beam hides it. */
const LAST_LEAP_FRAME = 25, ASCENT = 12, ASCENT_DX = -8, ASCENT_DY = -7;
/** Room around the strip for the ascent (art px): up and to the left of the strip's box. */
const ROOM_UP = ASCENT * -ASCENT_DY, ROOM_LEFT = ASCENT * -ASCENT_DX;
const RUN_MS = ((run.frames + ASCENT) / run.fps) * 1000;   // plus the run-in, which depends on the sign's width
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
      const arena = document.querySelector<HTMLElement>('.dojo-arena');
      const r = board?.getBoundingClientRect();
      if (!r || !r.height || !arena) return 0;
      const s = r.height / 64;
      // The strip's own box (as before) grown up and left for the ascent; its right side stops at the board's end.
      const stripLeft = r.left + LEFT_FROM_BOARD * s;
      const stripTop = r.top + (BOARD_TOP_ROW - RUN_FEET_ROW - 1) * s;
      const left = stripLeft - ROOM_LEFT * s, top = stripTop - ROOM_UP * s;
      const right = r.right - BOARD_TOP_RIGHT_INSET * s;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.width = `${Math.max(0, right - left)}px`;
      el.style.height = `${(run.height + ROOM_UP) * s}px`;
      frameEl.style.left = `${ROOM_LEFT * s}px`;
      frameEl.style.top = `${ROOM_UP * s}px`;
      frameEl.style.width = `${run.width * s}px`;
      frameEl.style.height = `${run.height * s}px`;
      frameEl.style.backgroundSize = `${run.width * run.frames * s}px ${run.height * s}px`;
      // The window mask, laid out like the backdrop (object-fit: cover, centred) and shifted into this box.
      const a = arena.getBoundingClientRect();
      const k = Math.max(a.width / BACKDROP_W, a.height / BACKDROP_H);
      const ox = a.left + (a.width - BACKDROP_W * k) / 2, oy = a.top + (a.height - BACKDROP_H * k) / 2;
      const size = `${BACKDROP_W * k}px ${BACKDROP_H * k}px`, pos = `${ox - left}px ${oy - top}px`;
      el.style.setProperty('mask-size', size); el.style.setProperty('-webkit-mask-size', size);
      el.style.setProperty('mask-position', pos); el.style.setProperty('-webkit-mask-position', pos);
      return s;
    };
    const play = () => {
      if (stopped) return;
      if (document.hidden) { schedule(GAP_MS); return; }
      const start = performance.now();
      // Enough whole cycles that the first one starts behind the doorway / the end of the board.
      const s0 = place();
      const reach = s0 ? (parseFloat(el.style.width) / s0) - ROOM_LEFT : run.width;   // strip px from its left to the box's right
      const cycles = Math.max(1, Math.ceil((reach - RUN_START_X) / CYCLE_STRIDE));
      const runIn = cycles * CYCLE_FRAMES;
      const step = (now: number) => {
        const tick = Math.floor(((now - start) / 1000) * run.fps);
        if (stopped || tick >= runIn + run.frames + ASCENT) {
          el.hidden = true;
          delete el.dataset.running;
          if (!stopped) schedule(GAP_MS);
          return;
        }
        const s = place();
        let frame: number, dx = 0, dy = 0;
        if (tick < runIn) {
          frame = tick % CYCLE_FRAMES;
          dx = (cycles - Math.floor(tick / CYCLE_FRAMES)) * CYCLE_STRIDE;
        } else {
          const f = tick - runIn;
          if (f <= LAST_LEAP_FRAME) frame = f;
          else if (f <= LAST_LEAP_FRAME + ASCENT) { frame = LAST_LEAP_FRAME; dx = (f - LAST_LEAP_FRAME) * ASCENT_DX; dy = (f - LAST_LEAP_FRAME) * ASCENT_DY; }
          else frame = f - ASCENT;   // the vanish frames, then the falling leaves
        }
        frameEl.style.backgroundPosition = `${-frame * run.width * s}px 0`;
        frameEl.style.transform = `translate(${dx * s}px, ${dy * s}px)`;
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

