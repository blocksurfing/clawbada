'use client';

import { useAccount } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import Image from 'next/image';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { FrostedSkeletonCard } from '@/components/ui/frosted-skeleton';
import { PageBackground } from '@/components/ui/page-background';
import { PixelIcon } from '@/components/ui/pixel-icon';
import { ICONS, BACKGROUNDS } from '@/lib/assets';
import { formatClaw, formatCountdown, tierLabel } from '@/lib/format';
import {
  Pickaxe,
  Swords,
  Egg,
  ShoppingBag,
  Clock,
  Users,
  ArrowRight,
  ArrowUpCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';

export default function GameDashboard() {
  const { address } = useAccount();

  const { data: profile } = useQuery({
    queryKey: ['profile', address],
    queryFn: () => api.agent.profile(address!),
    enabled: !!address,
    refetchInterval: 30_000,
  });

  const { data: expeditionsData } = useQuery({
    queryKey: ['expeditions', address],
    queryFn: () => api.mining.list(address!),
    enabled: !!address,
    refetchInterval: 30_000,
  });

  const { data: lobstersData } = useQuery({
    queryKey: ['lobsters', address],
    queryFn: () => api.agent.lobsters(address!),
    enabled: !!address,
  });

  if (!address) {
    return (
      <PageBackground variant="reef" scene={BACKGROUNDS.dashboard}>
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <Image
            src="/lobster-hero.png"
            alt="Clawbada Lobster"
            width={80}
            height={80}
            className="pixel-art mb-4"
          />
          <h1 className="font-pixel text-2xl text-foreground mb-2">Welcome to Clawbada</h1>
          <p className="text-sm text-text-secondary max-w-sm">
            Connect your wallet to start mining, battling, and breeding lobsters.
          </p>
        </div>
      </PageBackground>
    );
  }

  const isLoading = !profile && !lobstersData;
  const activeExpeditions = expeditionsData?.expeditions.filter((e) => !e.claimed) ?? [];

  return (
    <PageBackground variant="reef" scene={BACKGROUNDS.dashboard}>
      <div className="p-4 md:p-8 space-y-8 max-w-4xl mx-auto">
        <div>
          <div className="flex items-center gap-2">
            <img src="/assets/icons/Dashboard.svg" alt="" width={28} height={28} style={{ imageRendering: 'pixelated' as const }} />
            <h1 className="font-pixel text-xl text-foreground">Dashboard</h1>
          </div>
          <p className="text-sm text-text-secondary mt-1">Your Clawbada overview</p>
        </div>

        {/* Stats — loading skeleton */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <FrostedSkeletonCard key={i} className="h-[76px]" />
            ))}
          </div>
        ) : lobstersData?.count === 0 ? (
          /* Empty state — no lobsters */
          <FrostedPanel variant="highlight" className="text-center py-8">
            <PixelIcon src={ICONS.empty} alt="No lobsters" size={48} className="mx-auto mb-3" />
            <h2 className="font-pixel text-sm text-foreground mb-1">Your ocean awaits</h2>
            <p className="text-sm text-text-secondary mb-4 max-w-sm mx-auto">
              Claim your free starter lobsters from the faucet, or browse the marketplace.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Link href="/faucet" className="frosted-panel-highlight px-4 py-2 text-xs font-pixel text-claw-gold hover:border-[rgba(255,210,128,0.3)] transition-colors">
                Claim Free Lobsters
              </Link>
              <Link href="/market" className="frosted-panel px-4 py-2 text-xs text-text-secondary hover:text-foreground transition-colors">
                Browse Market
              </Link>
            </div>
          </FrostedPanel>
        ) : null}

        {/* Stats */}
        {!isLoading && (lobstersData?.count ?? 0) > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Lobsters', value: lobstersData?.count ?? 0, accent: 'text-foreground' },
              { label: 'ELO', value: profile?.elo ?? 1000, accent: 'text-ocean', mono: true },
              { label: 'W / L', value: `${profile?.wins ?? 0} / ${profile?.losses ?? 0}`, accent: 'text-coral' },
              { label: 'Expeditions', value: profile?.totalExpeditions ?? 0, accent: 'text-claw-gold' },
            ].map(({ label, value, accent, mono }) => (
              <FrostedPanel key={label} className="p-3">
                <div className="text-xs text-text-secondary mb-1">{label}</div>
                <div className={`text-2xl font-bold ${accent} ${mono ? 'font-mono' : ''}`}>{value}</div>
              </FrostedPanel>
            ))}
          </div>
        )}

        {/* Active expeditions */}
        {activeExpeditions.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-pixel text-xs text-text-accent uppercase tracking-wider">Active Expeditions</h2>
            <div className="space-y-2">
              {activeExpeditions.map((exp) => (
                <ExpeditionCard key={exp.expeditionId} expedition={exp} />
              ))}
            </div>
          </div>
        )}

        {/* Quick actions */}
        <div className="space-y-3">
          <h2 className="font-pixel text-xs text-text-accent uppercase tracking-wider">Quick Actions</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { href: '/game/mining', icon: Pickaxe, label: 'Mining', desc: `${activeExpeditions.length} active`, iconBg: 'bg-claw-gold/15', color: 'text-claw-gold' },
              { href: '/game/battle', icon: Swords, label: 'Battle', desc: 'PvP arena', iconBg: 'bg-coral/15', color: 'text-coral' },
              { href: '/game/breeding', icon: Egg, label: 'Breeding', desc: 'Breed lobsters', iconBg: 'bg-teal/15', color: 'text-teal' },
              { href: '/game/teams', icon: Users, label: 'Teams', desc: 'Manage teams', iconBg: 'bg-ocean/15', color: 'text-ocean' },
              { href: '/game/evolution', icon: ArrowUpCircle, label: 'Evolve', desc: 'Power up', iconBg: 'bg-claw-gold/15', color: 'text-claw-gold' },
              { href: '/market', icon: ShoppingBag, label: 'Market', desc: 'Buy & sell', iconBg: 'bg-ocean/15', color: 'text-ocean' },
            ].map(({ href, icon: Icon, label, desc, iconBg, color }) => (
              <Link key={href} href={href}>
                <FrostedPanel className="card-hover hover:border-[rgba(255,210,128,0.3)] cursor-pointer group p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className={`size-8 rounded-lg flex items-center justify-center ${iconBg}`}>
                      <Icon className={`size-4 ${color}`} />
                    </div>
                    <ArrowRight className="size-3 text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="text-sm font-medium text-foreground">{label}</div>
                  <div className="text-xs text-text-secondary">{desc}</div>
                </FrostedPanel>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </PageBackground>
  );
}

function ExpeditionCard({ expedition }: { expedition: { expeditionId: string; reward: string; completionTime: number; mineTier: number } }) {
  const [countdown, setCountdown] = useState(formatCountdown(expedition.completionTime));
  const isComplete = expedition.completionTime <= Math.floor(Date.now() / 1000);

  useEffect(() => {
    if (isComplete) return;
    const interval = setInterval(() => {
      setCountdown(formatCountdown(expedition.completionTime));
    }, 1000);
    return () => clearInterval(interval);
  }, [expedition.completionTime, isComplete]);

  return (
    <FrostedPanel className="flex items-center justify-between p-3">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-pixel text-[10px] text-text-accent">{tierLabel(expedition.mineTier)} Mine</span>
        </div>
        <div className="text-sm font-medium text-text-accent font-mono">{formatClaw(expedition.reward)}</div>
      </div>
      {isComplete ? (
        <Badge className="bg-coral text-white font-pixel text-[10px]">Ready to claim</Badge>
      ) : (
        <div className="flex items-center gap-1.5 text-sm text-text-secondary font-mono">
          <Clock className="size-3" />
          {countdown}
        </div>
      )}
    </FrostedPanel>
  );
}
