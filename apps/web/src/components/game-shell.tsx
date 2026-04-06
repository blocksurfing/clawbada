'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ConnectKitButton } from 'connectkit';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Pickaxe,
  Swords,
  Egg,
  Users,
  ShoppingBag,
  Trophy,
  Activity,
  BookOpen,
  ArrowUpCircle,
  Wrench,
  PanelLeftClose,
  PanelLeftOpen,
  MoreHorizontal,
  X,
} from 'lucide-react';
import { useState } from 'react';

const NAV_GAME = [
  { href: '/game', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/game/mining', label: 'Mining', icon: Pickaxe },
  { href: '/game/battle', label: 'Battle', icon: Swords },
  { href: '/game/breeding', label: 'Breeding', icon: Egg },
  { href: '/game/evolution', label: 'Evolve', icon: ArrowUpCircle },
  { href: '/game/repair', label: 'Repair', icon: Wrench },
  { href: '/game/teams', label: 'Teams', icon: Users },
  { href: '/market', label: 'Market', icon: ShoppingBag },
] as const;

const NAV_SOCIAL = [
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/leaderboard', label: 'Ranks', icon: Trophy },
  { href: 'https://docs.clawbada.com', label: 'Docs', icon: BookOpen, external: true },
] as const;

/* Bottom nav shows 4 primary + More drawer */
const BOTTOM_NAV = [
  { href: '/game', label: 'Home', icon: LayoutDashboard },
  { href: '/game/mining', label: 'Mine', icon: Pickaxe },
  { href: '/game/battle', label: 'Battle', icon: Swords },
  { href: '/market', label: 'Market', icon: ShoppingBag },
] as const;

const MORE_NAV = [
  { href: '/game/breeding', label: 'Breeding', icon: Egg },
  { href: '/game/evolution', label: 'Evolve', icon: ArrowUpCircle },
  { href: '/game/repair', label: 'Repair', icon: Wrench },
  { href: '/game/teams', label: 'Teams', icon: Users },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/leaderboard', label: 'Ranks', icon: Trophy },
] as const;

function isActive(pathname: string, href: string) {
  if (href === '/game') return pathname === '/game';
  return pathname.startsWith(href);
}

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
  external,
  onClick,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
  external?: boolean;
  onClick?: () => void;
}) {
  const cls = cn(
    'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors relative',
    active
      ? 'bg-sand-light text-foreground font-medium'
      : 'text-text-secondary hover:text-foreground hover:bg-ocean-surface/50',
    collapsed && 'justify-center px-0',
  );

  const activeBar = active && (
    <span className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full bg-coral" />
  );

  const content = (
    <>
      {activeBar}
      <Icon className={cn('size-5 shrink-0', active && 'text-coral')} />
      {!collapsed && <span>{label}</span>}
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
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className={cn(
        'flex items-center px-4 pt-5 pb-4',
        collapsed && 'justify-center px-2',
      )}>
        <Link href="/">
          <Image
            src="/assets/logo-text.png"
            alt="Clawbada"
            width={collapsed ? 36 : 160}
            height={collapsed ? 11 : 47}
            className="drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]"
          />
        </Link>
      </div>

      {/* Game nav */}
      <nav className="flex-1 px-2 space-y-0.5">
        {NAV_GAME.map((link) => (
          <NavItem
            key={link.href}
            {...link}
            active={isActive(pathname, link.href)}
            collapsed={collapsed}
          />
        ))}

        {/* Divider */}
        <div className="my-3 mx-2 border-t border-sidebar-border" />

        {NAV_SOCIAL.map((link) => (
          <NavItem
            key={link.href}
            {...link}
            active={'external' in link ? false : isActive(pathname, link.href)}
            collapsed={collapsed}
            external={'external' in link}
          />
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="px-2 pb-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center w-full py-2 text-text-secondary hover:text-foreground transition-colors rounded-md hover:bg-ocean-surface/50"
        >
          {collapsed
            ? <PanelLeftOpen className="size-5" />
            : <PanelLeftClose className="size-5" />
          }
        </button>
      </div>

      {/* Wallet */}
      <div className={cn(
        'px-3 pb-4 pt-2 border-t border-sidebar-border',
        collapsed && 'px-1',
      )}>
        <ConnectKitButton />
      </div>
    </>
  );

  const isMoreActive = MORE_NAV.some((link) => isActive(pathname, link.href));

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden lg:flex flex-col fixed inset-y-0 left-0 z-40 bg-sidebar border-r border-sidebar-border transition-[width] duration-200',
          collapsed ? 'w-16' : 'w-56',
        )}
      >
        {sidebarContent}
      </aside>

      {/* Main content */}
      <main
        className={cn(
          'flex-1 min-h-screen transition-[margin] duration-200',
          collapsed ? 'lg:ml-16' : 'lg:ml-56',
          'pb-20 lg:pb-0', /* bottom padding for mobile nav */
        )}
      >
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
