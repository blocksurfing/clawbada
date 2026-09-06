'use client';

import { useMemo } from 'react';
import {
  computeTeamPower,
  EvolutionTier,
  MIN_TEAM_POWER,
  MAX_TEAM_POWER,
  DAMAGE_THRESHOLD,
} from '@clawbada/game-logic';
import type { LobsterData } from '@/lib/api';

const TIER_NAMES = ['Base', 'Evolved', 'Elite', 'Apex'] as const;

export interface TeamPowerSummary {
  /** Sum of tier weights across the 3 lobsters. Null when the team isn't
   *  battle-eligible (any Base lobster, fewer than 3 lobsters, etc.). */
  power: number | null;
  /** Display string like "3 × Evolved" or "1 Elite + 2 Apex". Null when invalid. */
  composition: string | null;
  /** True if every lobster meets the V3 entry rule (Evolved+). */
  battleEligible: boolean;
  /** Reason the team can't battle — null when eligible. */
  ineligibleReason: string | null;
}

/**
 * Pure, no-network hook that mirrors the server's `computeTeamPower`. Used
 * by the Team Builder UI to preview a team's matchmaking power score before
 * committing to the queue.
 *
 * Returns `power: null` (with `ineligibleReason` populated) when the team
 * isn't battle-eligible — keeps the rendering layer free of conditional
 * branching for the "incomplete team" / "Base lobster present" cases.
 */
export function useTeamPower(lobsters: readonly LobsterData[] | undefined): TeamPowerSummary {
  return useMemo(() => {
    if (!lobsters || lobsters.length !== 3) {
      return {
        power: null,
        composition: null,
        battleEligible: false,
        ineligibleReason: lobsters ? `Need 3 lobsters, have ${lobsters.length}` : 'No team selected',
      };
    }

    // V3 entry rule: every lobster must be Evolved or higher.
    const baseLobster = lobsters.find((l) => l.evolutionTier < EvolutionTier.Evolved);
    if (baseLobster) {
      return {
        power: null,
        composition: null,
        battleEligible: false,
        ineligibleReason: `Lobster #${baseLobster.tokenId} is Base tier — must evolve before battling`,
      };
    }

    // B-05 fix: damage gate — server rejects teams with any lobster at ≥80
    // damage. Surface that here so the badge says "ineligible" instead of
    // "eligible" before the user discovers it via a server error.
    const damagedLobster = lobsters.find((l) => l.damage >= DAMAGE_THRESHOLD);
    if (damagedLobster) {
      return {
        power: null,
        composition: null,
        battleEligible: false,
        ineligibleReason: `Lobster #${damagedLobster.tokenId} has ${damagedLobster.damage} damage (≥${DAMAGE_THRESHOLD}) — repair before battling`,
      };
    }

    const tiers = lobsters.map((l): EvolutionTier => l.evolutionTier);
    const power = computeTeamPower(tiers);

    // Composition string: count tier occurrences.
    const counts: Record<string, number> = {};
    for (const t of tiers) {
      const name = TIER_NAMES[t];
      counts[name] = (counts[name] ?? 0) + 1;
    }
    const composition = Object.entries(counts)
      .map(([name, n]) => (n === 3 ? `3 × ${name}` : `${n} ${name}`))
      .join(' + ');

    return {
      power,
      composition,
      battleEligible: power >= MIN_TEAM_POWER && power <= MAX_TEAM_POWER,
      ineligibleReason: null,
    };
  }, [lobsters]);
}
