'use client';

import { cn } from '@/lib/utils';
import { MIN_TEAM_POWER, MAX_TEAM_POWER } from '@clawbada/game-logic';
import type { PowerRadiusPayload } from '@/lib/api';

interface Props {
  /** The seeker's own power score (3..9). */
  ownPower: number;
  /** Active match radius from the matchmaker. */
  radius: PowerRadiusPayload;
  /** Optional pool-depth annotation rendered above the bar. */
  poolDepthInRange?: number;
  className?: string;
}

const POWERS = Array.from(
  { length: MAX_TEAM_POWER - MIN_TEAM_POWER + 1 },
  (_, i) => MIN_TEAM_POWER + i,
);

/**
 * Visual radius-expansion bar for the queue UI. Renders a row of cells for
 * powers 3..9, highlighting:
 *
 *  - The seeker's own power (blue ring)
 *  - The current match-radius range (filled band)
 *
 * As the matchmaker expands the radius (every 30/60/120 seconds while
 * queued), the highlighted band widens. At the final expansion threshold
 * (`halfWidth: 'all'`) the entire bracket lights up with a subtle warning.
 */
export function QueueRadiusBar({ ownPower, radius, poolDepthInRange, className }: Props) {
  const isFullExpansion = radius.halfWidth === 'all';

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="opacity-70">
          Match range:{' '}
          <span className="font-semibold tabular-nums">
            Power {radius.low}–{radius.high}
          </span>
          {isFullExpansion && (
            <span className="ml-1.5 text-claw-gold">
              · all powers in bracket
            </span>
          )}
        </span>
        {poolDepthInRange != null && (
          <span className="opacity-70">
            <span className="font-semibold tabular-nums">{poolDepthInRange}</span> active in range
          </span>
        )}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {POWERS.map((p) => {
          const inRange = p >= radius.low && p <= radius.high;
          const isOwn = p === ownPower;

          return (
            <div
              key={p}
              className={cn(
                'flex aspect-square items-center justify-center rounded-md border text-sm font-semibold tabular-nums transition-colors',
                inRange
                  ? isFullExpansion
                    ? 'border-claw-gold/40 bg-claw-gold/15 text-claw-gold'
                    : 'border-ocean/40 bg-ocean/15 text-ocean'
                  : 'border-white/10 bg-white/5 text-foreground/40',
                isOwn && 'ring-2 ring-coral/60 ring-offset-1 ring-offset-ocean-deep',
              )}
              aria-label={`Power ${p}${isOwn ? ' (your team)' : ''}${inRange ? ' — in match range' : ''}`}
            >
              {p}
            </div>
          );
        })}
      </div>
    </div>
  );
}
