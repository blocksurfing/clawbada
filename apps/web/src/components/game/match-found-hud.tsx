'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { powerMatchSeverity, type PowerMatchSeverity } from '@clawbada/game-logic';
import { formatAddress } from '@/lib/format';
import type { MatchedState } from '@/hooks/use-queue-state';
import { Swords } from 'lucide-react';

// B-40: distinguishing `advantage` from `even` more clearly. Both are still
// teal-family (the underlying signal is "you're not at risk") but advantage
// gets a stronger fill + bolder type, plus the label leads with a "+" delta
// hint so the player sees they have an edge at a glance.
const SEVERITY_CHROME: Record<
  PowerMatchSeverity,
  { ring: string; pill: string; label: string }
> = {
  even: {
    ring: 'ring-teal/60',
    pill: 'bg-teal/15 text-teal border-teal/30',
    label: 'Even match',
  },
  advantage: {
    ring: 'ring-teal/60',
    pill: 'bg-teal/25 text-teal border-teal/40 font-semibold',
    label: 'Power advantage — you are stronger',
  },
  'slight-disadvantage': {
    ring: 'ring-claw-gold/60',
    pill: 'bg-claw-gold/15 text-claw-gold border-claw-gold/30',
    label: 'Opponent slightly stronger',
  },
  'significant-disadvantage': {
    ring: 'ring-coral/60',
    pill: 'bg-coral/15 text-coral border-coral/30',
    label: 'Opponent significantly stronger',
  },
};

interface Props {
  match: MatchedState;
  /** Optional countdown to deposit-window close (seconds remaining). Used on
   *  the active-battle page once the player has navigated through the HUD —
   *  not the same as `autoSkipMs` (HUD pause).
   *  The matchmaker doesn't currently surface this; the page can pass it in
   *  if it tracks a local `Date.now() - matchedAt` clock. */
  depositSecondsRemaining?: number;
  /** B-07: auto-skip the HUD after this many milliseconds and call `onApprove`.
   *  Renders a visible countdown ("Battle starts in 3…"). User can preempt
   *  via the manual buttons.
   *
   *  Set to `0` or omit to disable auto-skip and require explicit click. */
  autoSkipMs?: number;
  /** Optional callback when the player clicks "Approve & Deposit", OR when
   *  the autoSkip timer hits zero. The page is responsible for the actual
   *  navigation / TX flow. */
  onApprove?: () => void;
  /** Optional callback when the player walks away. Cancels the auto-skip
   *  timer. The 2-min deposit-window timeout will refund automatically;
   *  this callback is for UX (e.g. reset to idle, navigate back to queue). */
  onWalkAway?: () => void;
  className?: string;
}

/**
 * Match-reveal HUD shown at the moment a queue resolves into a match. The
 * traffic-light chrome (green / yellow / orange) communicates the power
 * delta at a glance — this is the consent surface for the V3 S1 design:
 * the player either deposits within the 2-min window (accepting the match)
 * or walks away (refunds via deposit-timeout).
 */
export function MatchFoundHud({
  match,
  depositSecondsRemaining,
  autoSkipMs,
  onApprove,
  onWalkAway,
  className,
}: Props) {
  const severity = powerMatchSeverity(match.yourPower, match.opponentPower);
  const chrome = SEVERITY_CHROME[severity];

  // B-07: auto-skip countdown. Tick state holds remaining ms; we render
  // `Math.ceil(remaining / 1000)` so the user sees `3, 2, 1` (not `3, 2, 1, 0`).
  // The internal `cancelledRef` flag is set when the user clicks Walk away or
  // Approve — it survives async timer fires and prevents late callbacks.
  //
  // B-39: tab visibility — pause the countdown while `document.hidden`. We
  // track `totalHiddenMs` via visibilitychange events so elapsed only accrues
  // wall-clock time the player could actually see. Without this, a player
  // who tabs away for 30s during the 3s pause would return to find themselves
  // already navigated to the active battle screen.
  const [autoSkipRemaining, setAutoSkipRemaining] = useState<number | null>(
    autoSkipMs && autoSkipMs > 0 ? autoSkipMs : null,
  );
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (autoSkipMs == null || autoSkipMs <= 0) return;
    cancelledRef.current = false;

    const startedAt = Date.now();
    let totalHiddenMs = 0;
    let lastHiddenAt: number | null =
      typeof document !== 'undefined' && document.hidden ? startedAt : null;

    const handleVisibility = () => {
      if (document.hidden) {
        lastHiddenAt = Date.now();
      } else if (lastHiddenAt !== null) {
        totalHiddenMs += Date.now() - lastHiddenAt;
        lastHiddenAt = null;
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    const intervalId = setInterval(() => {
      if (cancelledRef.current) {
        clearInterval(intervalId);
        return;
      }
      // Skip state updates while hidden — saves renders and avoids racing
      // visibilitychange. The countdown effectively pauses; the user sees
      // their remaining time when they tab back.
      if (typeof document !== 'undefined' && document.hidden) return;

      const elapsed = Date.now() - startedAt - totalHiddenMs;
      const remaining = autoSkipMs - elapsed;
      if (remaining <= 0) {
        clearInterval(intervalId);
        setAutoSkipRemaining(0);
        if (!cancelledRef.current) {
          cancelledRef.current = true; // mutual-exclusion w/ manual handlers
          if (onApprove) onApprove();
        }
        return;
      }
      setAutoSkipRemaining(remaining);
    }, 100); // tick at 10Hz so the visible "3, 2, 1" shows promptly

    return () => {
      clearInterval(intervalId);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
    // Reset the timer if the matched battleId changes (rare, but defensive).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSkipMs, match.battleId]);

  const autoSkipLabel =
    autoSkipRemaining != null && autoSkipRemaining > 0
      ? `${Math.ceil(autoSkipRemaining / 1000)}s`
      : null;

  // B-34: mutual-exclusion guards on the two handlers. Without these, a
  // ~100ms race window between the auto-skip's onApprove call and a user's
  // Walk-away click could fire BOTH callbacks. The cancelledRef latch makes
  // whichever runs first the only one to actually invoke a parent callback.
  const handleApprove = () => {
    if (cancelledRef.current) return;
    cancelledRef.current = true;
    if (onApprove) onApprove();
  };

  const handleWalkAway = () => {
    if (cancelledRef.current) return;
    cancelledRef.current = true;
    setAutoSkipRemaining(null);
    if (onWalkAway) onWalkAway();
  };

  return (
    <div
      className={cn(
        'rounded-2xl border border-white/10 bg-ocean-mid/80 p-6 backdrop-blur-sm ring-1',
        chrome.ring,
        className,
      )}
    >
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-foreground/70">
          <Swords className="size-4 text-coral" />
          Match Found
        </div>
        <span
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-xs font-medium',
            chrome.pill,
          )}
        >
          {chrome.label}
        </span>
      </div>

      {/* Power face-off */}
      <div className="mb-5 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="text-center">
          <div className="text-xs uppercase tracking-wider opacity-60">You</div>
          <div className="my-1 text-4xl font-bold tabular-nums">{match.yourPower}</div>
          <div className="text-xs opacity-60">Team Power</div>
        </div>

        <div className="flex flex-col items-center gap-1">
          <span className="text-xs uppercase tracking-wider opacity-50">vs</span>
          <span
            className={cn(
              'rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums',
              chrome.pill,
            )}
          >
            {match.powerDelta > 0 ? '+' : ''}
            {match.powerDelta}
          </span>
        </div>

        <div className="text-center">
          <div className="text-xs uppercase tracking-wider opacity-60">
            Opponent · {formatAddress(match.opponent)}
          </div>
          <div className="my-1 text-4xl font-bold tabular-nums">{match.opponentPower}</div>
          <div className="text-xs opacity-60">Team Power</div>
        </div>
      </div>

      {/* Footer: countdown + actions
          B-37: countdown number is now the visual focal point — large
          tabular-nums on its own line so the seconds tick is unmissable.
          B-31: footer copy explicitly states the auto-cancel behavior so
          "Walk away" doesn't read as "match never happened."
          B-33: aria-live="polite" + aria-atomic on the countdown so screen
          readers announce "3 seconds. 2 seconds. 1 second." instead of
          silently navigating users on auto-skip. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          {autoSkipLabel != null ? (
            <>
              <div
                className="text-3xl font-bold tabular-nums text-foreground leading-none"
                aria-live="polite"
                aria-atomic="true"
              >
                Battle starts in {autoSkipLabel}
              </div>
              <div className="text-xs opacity-70">
                Skip with <span className="font-semibold">Continue to deposit</span>, or walk
                away (battle auto-cancels in 2 minutes if neither side deposits).
              </div>
            </>
          ) : depositSecondsRemaining != null ? (
            <div className="text-xs opacity-70">
              Deposit within{' '}
              <span className="font-semibold tabular-nums">
                {Math.max(0, Math.floor(depositSecondsRemaining))}s
              </span>{' '}
              to confirm — or walk away (battle auto-cancels at 2 min).
            </div>
          ) : (
            <div className="text-xs opacity-70">
              Deposit to confirm. Walking away costs nothing — battle auto-cancels at 2 min.
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {onWalkAway && (
            <button
              type="button"
              onClick={handleWalkAway}
              className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
            >
              Walk away
            </button>
          )}
          {onApprove && (
            // B-35: label changed from "Approve & Deposit" to "Continue to
            // deposit" — describes the click's IMMEDIATE effect (advance to
            // active battle screen) rather than the next-page action.
            <button
              type="button"
              onClick={handleApprove}
              className="rounded-md bg-coral px-3 py-1.5 text-sm font-semibold text-ocean-deep hover:bg-coral/90"
            >
              Continue to deposit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
