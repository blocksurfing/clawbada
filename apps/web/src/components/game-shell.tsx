'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ConnectKitButton } from 'connectkit';
import { DevBurnerButton } from '@/components/dev-burner-button';
import { cn } from '@/lib/utils';
import { MoreHorizontal, X } from 'lucide-react';
import { useState } from 'react';
import { SidebarFrame } from '@/components/sidebar-frame';

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

const NAV_GAME = [
  { href: '/game', label: 'Dashboard', icon: makeIcon('Dashboard') },
  { href: '/game/mining', label: 'Mining', icon: makeIcon('Mining') },
  { href: '/game/battle', label: 'Battle', icon: makeIcon('Battle') },
  { href: '/game/breeding', label: 'Breeding', icon: makeIcon('Breeding') },
  { href: '/game/evolution', label: 'Evolve', icon: makeIcon('Evolve') },
  { href: '/game/repair', label: 'Repair', icon: makeIcon('Repair') },
  { href: '/game/teams', label: 'Teams', icon: makeIcon('Teams') },
  { href: '/market', label: 'Market', icon: makeIcon('Market') },
];

const NAV_SOCIAL = [
  { href: '/activity', label: 'Activity', icon: makeIcon('Activity') },
  { href: '/leaderboard', label: 'Ranks', icon: makeIcon('Ranks') },
  { href: 'https://docs.clawbada.com', label: 'Docs', icon: makeIcon('Docs'), external: true },
];

/* Bottom nav shows 4 primary + More drawer */
const BOTTOM_NAV = [
  { href: '/game', label: 'Home', icon: makeIcon('Dashboard') },
  { href: '/game/mining', label: 'Mine', icon: makeIcon('Mining') },
  { href: '/game/battle', label: 'Battle', icon: makeIcon('Battle') },
  { href: '/market', label: 'Market', icon: makeIcon('Market') },
];

const MORE_NAV = [
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

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  external,
  onClick,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  external?: boolean;
  onClick?: () => void;
}) {
  const cls = cn(
    'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-pixel transition-colors relative',
    active
      ? 'bg-sand-light text-foreground font-medium'
      : 'text-text-secondary hover:text-foreground hover:bg-ocean-surface/50',
  );

  const activeBar = active && (
    <span className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full bg-coral" />
  );

  const content = (
    <>
      {activeBar}
      <Icon className="size-7 shrink-0" />
      <span>{label}</span>
    </>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls} onClick={onClick}>
        {content}
      </a>
    );
  }

  return (
    <Link href={href} className={cls} onClick={onClick}>
      {content}
    </Link>
  );
}

export function GameShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex items-center px-6 pt-5 pb-4">
        <Link href="/">
          <Image
            src="/assets/logo-text.png"
            alt="Clawbada"
            width={160}
            height={47}
            className="drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]"
          />
        </Link>
      </div>

      {/* Game nav */}
      <nav className="flex-1 px-4 space-y-0.5">
        {NAV_GAME.map((link) => (
          <NavItem
            key={link.href}
            {...link}
            active={isActive(pathname, link.href)}
          />
        ))}

        {/* Divider */}
        <div className="my-3 mx-2 border-t border-sidebar-border/50" />

        {NAV_SOCIAL.map((link) => (
          <NavItem
            key={link.href}
            {...link}
            active={'external' in link ? false : isActive(pathname, link.href)}
            external={'external' in link}
          />
        ))}
      </nav>

      {/* Wallet */}
      <div className="px-5 pb-6 pt-3">
        <DevBurnerButton />
        <ConnectKitButton />
      </div>
    </>
  );

  const isMoreActive = MORE_NAV.some((link) => isActive(pathname, link.href));

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 z-40 w-60">
        <SidebarFrame className="h-full w-full" scale={0.5}>{sidebarContent}</SidebarFrame>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-h-screen lg:ml-60 pb-20 lg:pb-0">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-sidebar/95 backdrop-blur-md border-t border-sidebar-border">
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
