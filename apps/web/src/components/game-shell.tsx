'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConnectKitButton } from 'connectkit';
import { cn } from '@/lib/utils';
import { MoreHorizontal, X } from 'lucide-react';
import { useState } from 'react';
import { PixelChrome } from '@/components/chrome/pixel-chrome';

/** Pixel art nav icon from /assets/icons/ */
function NavIcon({ name, className }: { name: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/assets/icons/${name}.svg`}
      alt=""
      width={28}
      height={28}
      className={cn('shrink-0', className)}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

/** Wrapper to make NavIcon compatible with the icon prop pattern */
function makeIcon(name: string) {
  const Icon = ({ className }: { className?: string }) => <NavIcon name={name} className={className} />;
  Icon.displayName = `NavIcon_${name}`;
  return Icon;
}

/* Bottom nav shows 4 primary + More drawer */
const BOTTOM_NAV = [
  { href: '/game', label: 'Home', icon: makeIcon('Dashboard') },
  { href: '/game/mining', label: 'Mine', icon: makeIcon('Mining') },
  { href: '/game/battle', label: 'Battle', icon: makeIcon('Battle') },
  { href: '/market', label: 'Market', icon: makeIcon('Market') },
];

const MORE_NAV = [
  { href: '/dojo', label: 'Dojo', icon: makeIcon('Battle') },
  { href: '/game/breeding', label: 'Breeding', icon: makeIcon('Breeding') },
  { href: '/game/evolution', label: 'Evolve', icon: makeIcon('Evolve') },
  { href: '/game/repair', label: 'Repair', icon: makeIcon('Repair') },
  { href: '/game/teams', label: 'Teams', icon: makeIcon('Teams') },
  { href: '/activity', label: 'Activity', icon: makeIcon('Activity') },
  { href: '/leaderboard', label: 'Ranks', icon: makeIcon('Ranks') },
];

function isActive(pathname: string, href: string) {
  if (href === '/game') return pathname === '/game';
  return pathname.startsWith(href);
}

export function GameShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isMoreActive = MORE_NAV.some((link) => isActive(pathname, link.href));

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop: Nzib's pixel sidebar + wallet panel (≥ lg) */}
      <PixelChrome />

      {/* Main content — the sidebar is 128 source px at the 3 px pixel; the compact state does not reflow it */}
      <main className="flex-1 min-h-screen lg:ml-[384px] pb-20 lg:pb-0">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav data-site-chrome className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-sidebar/95 backdrop-blur-md border-t border-sidebar-border">
        <div className="flex items-stretch">
          {BOTTOM_NAV.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center py-2 min-h-[52px] transition-colors',
                  active ? 'text-coral' : 'text-text-secondary',
                )}
              >
                <link.icon className="size-5" />
                <span className="text-[10px] mt-0.5 font-pixel">{link.label}</span>
              </Link>
            );
          })}

          {/* More button */}
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className={cn(
              'flex-1 flex flex-col items-center justify-center py-2 min-h-[52px] transition-colors',
              moreOpen || isMoreActive ? 'text-coral' : 'text-text-secondary',
            )}
          >
            {moreOpen ? <X className="size-5" /> : <MoreHorizontal className="size-5" />}
            <span className="text-[10px] mt-0.5 font-pixel">More</span>
          </button>
        </div>

        {/* More drawer */}
        {moreOpen && (
          <div className="border-t border-sidebar-border bg-sidebar/98 backdrop-blur-md px-4 py-3">
            <div className="grid grid-cols-3 gap-2">
              {MORE_NAV.map((link) => {
                const active = isActive(pathname, link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      'flex flex-col items-center justify-center py-3 rounded-lg transition-colors min-h-[60px]',
                      active
                        ? 'bg-sand-light text-coral'
                        : 'text-text-secondary hover:bg-ocean-surface/50 hover:text-foreground',
                    )}
                  >
                    <link.icon className="size-5" />
                    <span className="text-[10px] mt-1 font-pixel">{link.label}</span>
                  </Link>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-sidebar-border">
              <ConnectKitButton />
            </div>
          </div>
        )}
      </nav>

      {/* Backdrop for More drawer */}
      {moreOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setMoreOpen(false)}
        />
      )}
    </div>
  );
}
