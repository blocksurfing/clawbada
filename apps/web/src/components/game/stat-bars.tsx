'use client';

import { cn } from '@/lib/utils';

interface Stats {
  hp: string;
  attack: string;
  armor: string;
  speed: string;
  critical: string;
}

const STAT_CONFIG = [
  { key: 'hp' as const, label: 'HP', max: 1200, color: 'bg-green-500' },
  { key: 'attack' as const, label: 'ATK', max: 250, color: 'bg-red-500' },
  { key: 'armor' as const, label: 'ARM', max: 200, color: 'bg-blue-500' },
  { key: 'speed' as const, label: 'SPD', max: 220, color: 'bg-yellow-500' },
  { key: 'critical' as const, label: 'CRT', max: 220, color: 'bg-purple-500' },
] as const;

interface StatBarsProps {
  stats: Stats;
  className?: string;
  compact?: boolean;
}

export function StatBars({ stats, className, compact }: StatBarsProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {STAT_CONFIG.map(({ key, label, max, color }) => {
        const value = Number(stats[key]);
        const pct = Math.min((value / max) * 100, 100);
        return (
          <div key={key} className="flex items-center gap-2">
            <span className={cn('text-xs font-medium text-muted-foreground', compact ? 'w-6' : 'w-8')}>
              {label}
            </span>
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
            </div>
            <span className={cn('text-xs tabular-nums', compact ? 'w-8' : 'w-10')}>
              {value}
            </span>
          </div>
        );
      })}
    </div>
  );
}
