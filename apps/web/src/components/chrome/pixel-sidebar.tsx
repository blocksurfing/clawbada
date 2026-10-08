'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { SidebarRoll } from './sidebar-roll';
import { PixelMusicToggle } from './pixel-music-toggle';

/**
 * Nzib's sidebar (design/website/mockups/mockups.html): the standalone wordmark with the music toggle beside it,
 * and the rolling banner with the twelve menu items. Order matters — it also indexes the icons in Icons.png.
 * Items are real links; the active one follows the route, and a route change drives the ribbon transition
 * (so back/forward animate too). The motion lives in `SidebarRoll`.
 */
const MENU = [
  { label: 'Dashboard', href: '/game' },
  { label: 'Mining', href: '/game/mining' },
  { label: 'Battle', href: '/game/battle' },
  { label: 'Dojo', href: '/dojo' },
  { label: 'Breeding', href: '/game/breeding' },
  { label: 'Evolve', href: '/game/evolution' },
  { label: 'Repair', href: '/game/repair' },
  { label: 'Teams', href: '/game/teams' },
  { label: 'Market', href: '/market' },
  { label: 'Activity', href: '/activity' },
  { label: 'Ranks', href: '/leaderboard' },
  { label: 'Docs', href: 'https://docs.clawbada.com', external: true },
] as const;

/** The chrome ships at the desktop breakpoint only (Tailwind `lg`); below it the game shell keeps its bottom nav. */
export const PIXEL_CHROME_MEDIA = '(min-width: 1024px)';
/** 128 source px × the 3 px pixel. */
export const SIDEBAR_WIDTH_PX = 384;

const ASSETS = {
  panel: '/ui/sidebar/Sidebar.png',
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
  const sidebarRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const brandRef = useRef<HTMLButtonElement>(null);
  const rollRef = useRef<SidebarRoll | null>(null);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  // The engine measures the menu, so it only runs while the chrome is displayed (≥ lg); it is created before
  // the first paint so the compact start state never transitions from the open position.
  useLayoutEffect(() => {
    const mq = window.matchMedia(PIXEL_CHROME_MEDIA);
    const create = () => {
      if (rollRef.current || !sidebarRef.current || !canvasRef.current || !toggleRef.current || !overlayRef.current || !listRef.current || !brandRef.current) return;
      rollRef.current = new SidebarRoll(
        { sidebar: sidebarRef.current, canvas: canvasRef.current, toggle: toggleRef.current, menuOverlay: overlayRef.current, menuList: listRef.current, brandTrigger: brandRef.current },
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
        <button ref={brandRef} aria-controls="menu-overlay" aria-label="Open sidebar" className="brand-trigger" tabIndex={-1} type="button">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 512 px pixel-art wordmark shown at 192 px, unoptimised on purpose */}
          <img alt="Clawbada" src="/ui/brand/logo-wordmark-512.png" width={192} height={192} />
        </button>
        <PixelMusicToggle />
      </header>

      {/* COMPONENT: sidebar, menu, pole trigger */}
      <aside aria-label="Clawbada sidebar" className="sidebar-shell" id="sidebar-shell">
        <div ref={sidebarRef} className="sidebar-preview" id="sidebar">
          <canvas ref={canvasRef} aria-label="Sidebar" className="sidebar-panel" height={336} id="panel" role="img" width={128} />
          <div ref={overlayRef} className="menu-overlay" hidden id="menu-overlay" inert>
            <nav aria-label="Clawbada navigation">
              <ul ref={listRef} className="menu-list" id="menu-list">
                {MENU.map((item, index) => {
                  const key = item.label.toLowerCase();
                  const content = (
                    <>
                      <canvas aria-hidden="true" className="active-ribbon" data-ribbon={item.label} height={16} width={48} />
                      <span aria-hidden="true" className="menu-icon" style={{ '--icon': index } as CSSProperties} />
                      <span>{item.label}</span>
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
                          <a className="menu-item" data-menu={key} href={item.href} rel="noopener noreferrer" target="_blank">{content}</a>
                        ) : (
                          <Link className="menu-item" data-menu={key} href={item.href}>{content}</Link>
                        )}
                      </li>
                    </Fragment>
                  );
                })}
              </ul>
            </nav>
          </div>
          <button ref={toggleRef} aria-controls="menu-overlay" aria-expanded="true" aria-label="Close sidebar" className="sidebar-toggle" disabled id="toggle" title="Click the pole to open or close the sidebar" type="button" />
        </div>
      </aside>
    </>
  );
}
