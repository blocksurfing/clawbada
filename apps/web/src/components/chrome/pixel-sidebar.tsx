'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { SidebarRoll } from './sidebar-roll';
import { PixelMusicToggle } from './pixel-music-toggle';
import { playUiClick, preloadUiClicks } from '@/lib/site-sfx';

/**
 * Nzib's sidebar (design/website/workbench, baseline 3295433): the standalone wordmark with the music toggle
 * beside it, the pole, and the rolling banner — compact with icons only after every load, expanded with labels
 * on a pole click. `icon` indexes Icons.png (twelve tiles; Battle's tile 2 is unused since Battle opens from the
 * Shell). Items are real links; the active one follows the route, and a route change drives the ribbon
 * transition (so back/forward animate too). The motion lives in `SidebarRoll`.
 */
const MENU = [
  { label: 'Shell', href: '/game', icon: 0 },
  { label: 'Mining', href: '/game/mining', icon: 1 },
  { label: 'Dojo', href: '/dojo', icon: 3 },
  { label: 'Breeding', href: '/game/breeding', icon: 4 },
  { label: 'Evolve', href: '/game/evolution', icon: 5 },
  { label: 'Repair', href: '/game/repair', icon: 6 },
  { label: 'Teams', href: '/game/teams', icon: 7 },
  { label: 'Market', href: '/market', icon: 8 },
  { label: 'Activity', href: '/activity', icon: 9 },
  { label: 'Ranks', href: '/leaderboard', icon: 10 },
  { label: 'Docs', href: 'https://docs.clawbada.com', icon: 11, external: true },
] as const;

/** The chrome ships at the desktop breakpoint only (Tailwind `lg`); below it the game shell keeps its bottom nav. */
export const PIXEL_CHROME_MEDIA = '(min-width: 1024px)';
/** The expanded pole: 128 source px × the 3 px pixel (compact is 96 × 3 = 288). The live value is `--sidebar-width`. */
export const SIDEBAR_WIDTH_PX = 384;
export const SIDEBAR_COMPACT_WIDTH_PX = 288;

const ASSETS = {
  banner: '/ui/sidebar/Banner.png',
  pole: '/ui/sidebar/Pole.png',
  ribbon: '/ui/sidebar/Ribbon.png',
  separator: '/ui/sidebar/Separator.png',
};

/** Same rule as the game shell's `isActive`: Dashboard is exact, everything else is a prefix. */
export function activeMenuLabel(pathname: string | null): string | null {
  if (!pathname) return null;
  for (const item of MENU) {
    if ('external' in item) continue;
    if (item.href === '/game' ? pathname === '/game' : pathname.startsWith(item.href)) return item.label;
  }
  return null;
}

export function PixelSidebar() {
  const pathname = usePathname();
  const shellRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poleRef = useRef<HTMLCanvasElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const brandRef = useRef<HTMLButtonElement>(null);
  const rollRef = useRef<SidebarRoll | null>(null);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  /** A page pick taps (owner 2026-10-27) — not the page you are already on. */
  const pickPage = (label: string) => { if (activeMenuLabel(pathnameRef.current) !== label) playUiClick(); };
  useEffect(() => { preloadUiClicks(); }, []);

  // The engine measures the menu, so it only runs while the chrome is displayed (≥ lg); it is created before
  // the first paint so the compact start state never transitions from the open position.
  useLayoutEffect(() => {
    const mq = window.matchMedia(PIXEL_CHROME_MEDIA);
    const create = () => {
      if (rollRef.current || !sidebarRef.current || !canvasRef.current || !poleRef.current || !toggleRef.current || !overlayRef.current || !listRef.current) return;
      rollRef.current = new SidebarRoll(
        { sidebar: sidebarRef.current, scroller: shellRef.current ?? undefined, canvas: canvasRef.current, pole: poleRef.current, toggle: toggleRef.current, menuOverlay: overlayRef.current, menuList: listRef.current },
        { assets: ASSETS, initialSelection: activeMenuLabel(pathnameRef.current) },
      );
    };
    const destroy = () => { rollRef.current?.destroy(); rollRef.current = null; };
    const sync = () => { if (mq.matches) create(); else destroy(); };
    sync();
    mq.addEventListener('change', sync);
    return () => { mq.removeEventListener('change', sync); destroy(); };
  }, []);

  useEffect(() => { void rollRef.current?.select(activeMenuLabel(pathname)); }, [pathname]);

  return (
    <>
      {/* COMPONENT: standalone wordmark — sibling of the sidebar; never rolled/clipped with the menu. */}
      <header aria-label="Clawbada" className="standalone-brand">
        <button ref={brandRef} aria-hidden="true" className="brand-trigger" tabIndex={-1} type="button">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 512 px pixel-art wordmark shown at 192 px, unoptimised on purpose */}
          <img alt="Clawbada" src="/ui/brand/logo-wordmark-512.png" width={192} height={192} />
        </button>
        <PixelMusicToggle />
      </header>

      {/* COMPONENT: sidebar, menu, pole trigger */}
      <aside ref={shellRef} aria-label="Clawbada sidebar" className="sidebar-shell" id="sidebar-shell">
        <div ref={sidebarRef} className="sidebar-preview" id="sidebar">
          <canvas ref={poleRef} aria-hidden="true" className="sidebar-pole" height={16} id="sidebar-pole" width={96} />
          <canvas ref={canvasRef} aria-label="Sidebar" className="sidebar-panel" height={336} id="panel" role="img" width={48} />
          <div ref={overlayRef} className="menu-overlay" hidden id="menu-overlay" inert>
            <nav aria-label="Clawbada navigation">
              <ul ref={listRef} className="menu-list" id="menu-list">
                {MENU.map((item) => {
                  const key = item.label.toLowerCase();
                  const content = (
                    <>
                      <canvas aria-hidden="true" className="active-ribbon" data-ribbon={item.label} height={16} width={48} />
                      <span aria-hidden="true" className="menu-icon" style={{ '--icon': item.icon } as CSSProperties} />
                      <span className="menu-label">{item.label}</span>
                    </>
                  );
                  return (
                    <Fragment key={item.label}>
                      {item.label === 'Activity' && (
                        <li className="menu-separator" role="separator">
                          <canvas aria-hidden="true" />
                        </li>
                      )}
                      <li data-menu={key}>
                        {'external' in item ? (
                          <a aria-label={item.label} className="menu-item" data-menu={key} href={item.href} onClick={() => pickPage(item.label)} rel="noopener noreferrer" target="_blank" title={item.label}>{content}</a>
                        ) : (
                          <Link aria-label={item.label} className="menu-item" data-menu={key} href={item.href} onClick={() => pickPage(item.label)} title={item.label}>{content}</Link>
                        )}
                      </li>
                    </Fragment>
                  );
                })}
              </ul>
            </nav>
          </div>
          <button ref={toggleRef} aria-controls="menu-overlay" aria-expanded="false" aria-label="Expand sidebar" className="sidebar-toggle" disabled id="toggle" title="Click the pole to expand or collapse the sidebar" type="button" />
        </div>
      </aside>
    </>
  );
}
