'use client';

import { cn } from '@/lib/utils';
import { Heart, Swords, Shield, Zap, Crosshair } from 'lucide-react';

interface Stats {
  hp: string;
  attack: string;
  armor: string;
  speed: string;
  critical: string;
}

const STAT_CONFIG = [
  { key: 'hp' as const, label: 'HP', icon: Heart, color: 'text-green-400', bg: 'bg-green-400/15' },
  { key: 'attack' as const, label: 'ATK', icon: Swords, color: 'text-red-400', bg: 'bg-red-400/15' },
  { key: 'armor' as const, label: 'ARM', icon: Shield, color: 'text-blue-400', bg: 'bg-blue-400/15' },
  { key: 'speed' as const, label: 'SPD', icon: Zap, color: 'text-yellow-400', bg: 'bg-yellow-400/15' },
  { key: 'critical' as const, label: 'CRT', icon: Crosshair, color: 'text-purple-400', bg: 'bg-purple-400/15' },
] as const;

interface StatPillsProps {
  stats: Stats;
  className?: string;
}

export function StatPills({ stats, className }: StatPillsProps) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {STAT_CONFIG.map(({ key, label, icon: Icon, color, bg }) => (
        <div
          key={key}
          className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5', bg)}
          title={label}
        >
          <Icon className={cn('size-3.5', color)} />
          <span className={cn('text-sm font-bold tabular-nums', color)}>
            {Number(stats[key])}
          </span>
        </div>
      ))}
    </div>
  );
}
