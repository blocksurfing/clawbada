'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConnectKitButton } from 'connectkit';
import { cn } from '@/lib/utils';
import { Menu, X } from 'lucide-react';
import { useState } from 'react';

const NAV_LINKS = [
  { href: '/game', label: 'Dashboard' },
  { href: '/game/mining', label: 'Mining' },
  { href: '/game/battle', label: 'Battle' },
  { href: '/game/breeding', label: 'Breeding' },
  { href: '/game/teams', label: 'Teams' },
  { href: '/market', label: 'Market' },
  { href: '/leaderboard', label: 'Ranks' },
  { href: 'https://docs.clawbada.com', label: 'Docs', external: true },
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto flex items-center h-14 px-4 gap-4">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <span className="text-xl">🦞</span>
            <span className="font-bold text-foreground">clawbada</span>
          </Link>

          <nav className="hidden md:flex items-center gap-0.5 ml-2 text-sm">
            {NAV_LINKS.map((link) => {
              const isExternal = 'external' in link && link.external;
              const active = !isExternal && (
                link.href === '/game'
                  ? pathname === '/game'
                  : pathname.startsWith(link.href)
              );
              const cls = cn(
                'px-3 py-1.5 rounded-md transition-colors',
                active
                  ? 'text-foreground font-medium bg-secondary'
                  : 'text-muted-foreground hover:text-foreground',
              );
              if (isExternal) {
                return (
                  <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className={cls}>
                    {link.label}
                  </a>
                );
              }
              return (
                <Link key={link.href} href={link.href} className={cls}>
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <ConnectKitButton />
            <button
              className="md:hidden p-2 text-muted-foreground hover:text-foreground"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <nav className="md:hidden border-t border-border/60 bg-background px-4 py-2 space-y-0.5">
            {NAV_LINKS.map((link) => {
              const isExternal = 'external' in link && link.external;
              const active = !isExternal && (
                link.href === '/game'
                  ? pathname === '/game'
                  : pathname.startsWith(link.href)
              );
              const cls = cn(
                'block px-3 py-2 rounded-md text-sm transition-colors',
                active
                  ? 'text-foreground font-medium bg-secondary'
                  : 'text-muted-foreground hover:text-foreground',
              );
              if (isExternal) {
                return (
                  <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" onClick={() => setMobileOpen(false)} className={cls}>
                    {link.label}
                  </a>
                );
              }
              return (
                <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)} className={cls}>
                  {link.label}
                </Link>
              );
            })}
          </nav>
        )}
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
