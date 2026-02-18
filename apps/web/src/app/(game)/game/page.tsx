'use client';

import { useAccount } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatClaw, formatCountdown } from '@/lib/format';
import {
  Pickaxe,
  Swords,
  Heart,
  Store,
  Clock,
  Trophy,
  Users,
  ArrowRight,
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
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
        <span className="text-5xl mb-4">🦞</span>
        <h1 className="text-2xl font-bold mb-2">Welcome to Clawbada</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          Connect your wallet to start mining, battling, and breeding lobsters.
        </p>
      </div>
    );
  }

  const activeExpeditions = expeditionsData?.expeditions.filter((e) => !e.claimed) ?? [];

  return (
    <div className="p-4 md:p-8 space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Your Clawbada overview</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Lobsters', value: lobstersData?.count ?? 0, icon: '🦞' },
          { label: 'ELO', value: profile?.elo ?? 1000, mono: true },
          { label: 'W / L', value: `${profile?.wins ?? 0} / ${profile?.losses ?? 0}` },
          { label: 'Expeditions', value: profile?.totalExpeditions ?? 0 },
        ].map(({ label, value, icon, mono }) => (
          <div key={label} className="border border-border rounded-md p-4">
            <div className="text-xs text-muted-foreground mb-1">{icon ? `${icon} ` : ''}{label}</div>
            <div className={`text-2xl font-bold ${mono ? 'font-mono' : ''}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Active expeditions */}
      {activeExpeditions.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Active Expeditions</h2>
          <div className="space-y-2">
            {activeExpeditions.map((exp) => (
              <ExpeditionCard key={exp.expeditionId} expedition={exp} />
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { href: '/game/mining', icon: Pickaxe, label: 'Mining', desc: `${activeExpeditions.length} active`, color: 'text-coral' },
            { href: '/game/battle', icon: Swords, label: 'Battle', desc: 'PvP arena', color: 'text-destructive' },
            { href: '/game/breeding', icon: Heart, label: 'Breeding', desc: 'Breed lobsters', color: 'text-teal' },
            { href: '/game/teams', icon: Users, label: 'Teams', desc: 'Manage teams', color: 'text-ocean' },
            { href: '/market', icon: Store, label: 'Market', desc: 'Buy & sell', color: 'text-claw-gold' },
            { href: '/leaderboard', icon: Trophy, label: 'Leaderboard', desc: 'Rankings', color: 'text-muted-foreground' },
          ].map(({ href, icon: Icon, label, desc, color }) => (
            <Link key={href} href={href}>
              <div className="border border-border rounded-md p-4 card-hover hover:border-muted-foreground/30 cursor-pointer group">
                <div className="flex items-center justify-between mb-2">
                  <Icon className={`size-4 ${color}`} />
                  <ArrowRight className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
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

  const tierNames = ['Base', 'Evolved', 'Elite', 'Apex'];

  return (
    <div className="border border-border rounded-md p-4 flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <Badge variant="outline" className="text-xs">{tierNames[expedition.mineTier]} Mine</Badge>
        </div>
        <div className="text-sm font-medium">{formatClaw(expedition.reward)}</div>
      </div>
      {isComplete ? (
        <Badge className="bg-coral text-white">Ready to claim</Badge>
      ) : (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground font-mono">
          <Clock className="size-3" />
          {countdown}
        </div>
      )}
    </div>
  );
}
