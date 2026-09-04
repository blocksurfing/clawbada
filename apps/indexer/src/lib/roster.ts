/**
 * Team Power from the DB mirror of a roster.
 *
 * Shared by team-watcher (TeamCreated) and lobster-watcher (LobsterEvolved): Team Power is
 * the sum of the three lobsters' tier weights and no contract event carries it, so both
 * handlers derive it from the `lobsters` rows the LobsterWatcher keeps in step.
 */
import { inArray } from 'drizzle-orm';
import { db, lobsters } from '@clawbada/db';
import { EvolutionTier, computeTeamPower } from '@clawbada/game-logic';

export type RosterIds = readonly [bigint, bigint, bigint];

/** Team Power (3..9) for a roster, or null when it cannot battle: a lobster the mirror
 *  does not know yet (event ordering) or one still at Base tier. Callers treat null as
 *  "skip" - the API's queue join re-derives power once the team is actually eligible. */
export async function loadTeamPower(lobsterIds: RosterIds): Promise<number | null> {
  const rows = await db
    .select({ tokenId: lobsters.tokenId, evolutionTier: lobsters.evolutionTier })
    .from(lobsters)
    .where(inArray(lobsters.tokenId, [...lobsterIds]));

  const tierById = new Map<bigint, number>();
  for (const row of rows) tierById.set(BigInt(row.tokenId), Number(row.evolutionTier));

  const tiers: EvolutionTier[] = [];
  for (const id of lobsterIds) {
    const tier = tierById.get(id);
    if (tier === undefined || tier === EvolutionTier.Base) return null;
    tiers.push(tier as EvolutionTier);
  }
  return computeTeamPower(tiers);
}
