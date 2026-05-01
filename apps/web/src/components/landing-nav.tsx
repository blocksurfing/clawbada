'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/game', label: 'Play' },
  { href: '/market', label: 'Market' },
  { href: '/leaderboard', label: 'Ranks' },
  { href: '/agents', label: 'Agents' },
] as const;

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-300',
        scrolled
          ? 'bg-[#0a2040]/90 backdrop-blur-md border-b border-white/10'
          : 'bg-black/30 backdrop-blur-sm',
      )}
    >
      <div className="max-w-5xl mx-auto flex items-center justify-center h-14 px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center">
            <Image
              src="/assets/logo-text.png"
              alt="Clawbada"
              width={140}
              height={41}
              className="drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]"
            />
          </Link>
          <nav className="hidden sm:flex items-center gap-1 text-sm font-bold uppercase">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-3 py-1.5 rounded-md text-white/90 hover:text-claw-gold transition-colors drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
