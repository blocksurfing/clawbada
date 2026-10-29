'use client';

/**
 * The way out of a battle, drawn (lib/battle-exit.ts says when): the theme's navy, masked by a circle on the middle of
 * the window that closes over the Victory / Defeat screen in 1.5 s (the Looney Tunes zoom-out, owner 2026-10-29), stays
 * shut while the battle view tears down and the page switches, then opens on the Dojo or The Shell from the middle. One
 * rAF loop sets the radius, as the entry's iris does (battle-entry-overlay.tsx). Mounted once in the root layout, so it
 * outlives the navigation; the document is the fullscreen element, so it shows in fullscreen too.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { EXIT_IRIS_CLOSE_MS, EXIT_IRIS_OPEN_MS, getExitState, openBattleExit, useBattleExit } from '@/lib/battle-exit';
import { NAVY } from './battle-entry-overlay';

const easeIn = (t: number) => t * t * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const coverRadius = () => Math.hypot(innerWidth / 2, innerHeight / 2) + 2;

export function BattleExitOverlay() {
  const exit = useBattleExit();
  const visible = exit.phase !== 'idle';
  const ref = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();

  // The page under the navy has left the battle: give it a moment to paint, then open.
  useEffect(() => {
    if (exit.phase !== 'closed' || !pathname || pathname.startsWith('/battle/')) return;
    const t = setTimeout(() => openBattleExit(), 250);
    return () => clearTimeout(t);
  }, [exit.phase, pathname]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!visible || !el) return;
    const setMask = (value: string) => { el.style.maskImage = value; el.style.setProperty('-webkit-mask-image', value); };
    let raf = 0;
    const frame = () => {
      const s = getExitState();
      const cx = innerWidth / 2, cy = innerHeight / 2;
      let r: number;   // radius of the HOLE the page shows through
      if (s.phase === 'closing') {
        const t = Math.min(1, (Date.now() - s.startedAt) / EXIT_IRIS_CLOSE_MS);
        r = coverRadius() * (1 - easeIn(t));
      } else if (s.phase === 'opening') {
        const opened = Number(el.dataset.openedAt || 0) || Date.now();
        if (!el.dataset.openedAt) el.dataset.openedAt = String(opened);
        const t = Math.min(1, (Date.now() - opened) / EXIT_IRIS_OPEN_MS);
        r = coverRadius() * easeOut(t);
      } else r = 0;   // closed: all navy
      el.dataset.irisR = String(Math.round(r));   // for the harness
      setMask(r <= 0 ? 'none' : `radial-gradient(circle at ${cx}px ${cy}px, transparent ${r}px, #000 ${r + 1}px)`);
      if (getExitState().phase !== 'idle') raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  useEffect(() => {
    if (exit.phase !== 'opening' && ref.current) delete ref.current.dataset.openedAt;
  }, [exit.phase]);

  if (!visible) return null;
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-testid="battle-exit"
      data-phase={exit.phase}
      className="fixed inset-0 z-[210]"
      style={{ background: NAVY, pointerEvents: exit.phase === 'opening' ? 'none' : 'auto' }}
    />
  );
}
