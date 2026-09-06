'use client';

import { cn } from '@/lib/utils';
import type { TeamPowerSummary } from '@/hooks/use-team-power';

const POWER_TIER_COLORS: Record<'low' | 'mid' | 'high', string> = {
  low: 'bg-teal/15 text-teal border-teal/30',
  mid: 'bg-ocean/15 text-ocean border-ocean/30',
  high: 'bg-claw-gold/15 text-claw-gold border-claw-gold/30',
};

function colorBucket(power: number): keyof typeof POWER_TIER_COLORS {
  if (power <= 4) return 'low';
  if (power <= 7) return 'mid';
  return 'high';
}

interface Props {
  summary: TeamPowerSummary;
  /** Hide the composition string and render power-only. Useful in dense rows. */
  compact?: boolean;
  className?: string;
}

/**
 * Compact pill rendering of a team's matchmaking Power Score.
 *
 * - Battle-eligible team → colored pill `Power 6 · 3 × Elite`
 * - Ineligible team → muted pill with the reason as tooltip
 *
 * Designed to slot inline next to a team selector in the queue UI; matches
 * the existing `Badge` component's compact size.
 */
export function TeamPowerBadge({ summary, compact = false, className }: Props) {
  if (!summary.battleEligible || summary.power == null) {
    return (
      <span
        title={summary.ineligibleReason ?? 'Team not battle-eligible'}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs font-medium text-foreground/60',
          className,
        )}
      >
        <span className="opacity-70">Power</span>
        <span>—</span>
      </span>
    );
  }

  const bucket = colorBucket(summary.power);
  const color = POWER_TIER_COLORS[bucket];

  return (
    <span
      title={summary.composition ?? undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tabular-nums',
        color,
        className,
      )}
    >
      <span className="opacity-70">Power</span>
      <span className="font-semibold">{summary.power}</span>
      {!compact && summary.composition && (
        <>
          <span className="opacity-30">·</span>
          <span className="opacity-80">{summary.composition}</span>
        </>
      )}
    </span>
  );
}
