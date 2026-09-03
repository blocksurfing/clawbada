/**
 * Watches TeamManager events and syncs team state to DB.
 *
 * Events: TeamCreated, TeamDisbanded, TeamActivityUpdated
 *
 * Boost: a roster change on chain is disbandTeam + createTeam (new teamId), so
 * TeamDisbanded stamps `disbandedAt` (what makes the old team a lineage parent) and
 * TeamCreated rates a battle-eligible roster right away (consuming that lineage).
 */
import type { Log } from 'viem';
import { and, eq, isNull } from 'drizzle-orm';
import { TeamManagerAbi, addresses } from '@clawbada/chain';
import { db, teams, matchmakingQueue, ensureTeamRating, currentBoostEpochId } from '@clawbada/db';
import { EventWatcher, type WatcherConfig } from '../lib/event-processor';
import { loadTeamPower, type RosterIds } from '../lib/roster';
// Aliased: `handleEvent(log: Log)` shadows the module-scope name.
import { log as pinoLog } from '../logger';

export class TeamWatcher extends EventWatcher {
  readonly config: WatcherConfig = {
    contractName: 'TeamManager',
    abi: TeamManagerAbi as any,
    address: addresses.teamManager,
    events: ['TeamCreated', 'TeamDisbanded', 'TeamActivityUpdated'],
  };

  async handleEvent(log: Log): Promise<void> {
    const event = log as any;
    const name = event.eventName;
    const args = event.args ?? {};

    switch (name) {
      case 'TeamCreated': {
        const teamId = BigInt(args.teamId);
        const owner = (args.owner as string).toLowerCase();
        const ids = (args.lobsterIds as readonly (bigint | number | string)[]).map((id) => BigInt(id));
        const lobsterIds: RosterIds = [ids[0], ids[1], ids[2]];

        // TeamManager.createTeam stores `active = false`; the flag only flips
        // via TeamActivityUpdated. Inserting `true` made a fresh team look
        // busy until its first expedition ended.
        await db.insert(teams).values({
          teamId,
          owner,
          lobster0: lobsterIds[0],
          lobster1: lobsterIds[1],
          lobster2: lobsterIds[2],
          active: false,
        });

        await this.rateIfBattleEligible(teamId, owner, lobsterIds);
        break;
      }

      case 'TeamDisbanded': {
        const teamId = BigInt(args.teamId);
        // isNull guard: a replay keeps the original timestamp (lineage ties
        // are broken by most-recent disband).
        await db
          .update(teams)
          .set({ active: false, disbandedAt: new Date() })
          .where(and(eq(teams.teamId, teamId), isNull(teams.disbandedAt)));

        // A disbanded team can no longer battle; drop its queue entry so the
        // matchmaker never pairs it.
        const removed = await db
          .delete(matchmakingQueue)
          .where(eq(matchmakingQueue.teamId, teamId))
          .returning({ id: matchmakingQueue.id });
        if (removed.length > 0) {
          pinoLog.info(
            { teamId: teamId.toString(), module: 'team-watcher', op: 'TeamDisbanded' },
            'removed disbanded team from matchmaking queue',
          );
        }
        break;
      }

      case 'TeamActivityUpdated': {
        const teamId = BigInt(args.teamId);
        const active = args.active as boolean;
        await db
          .update(teams)
          .set({ active })
          .where(eq(teams.teamId, teamId));
        break;
      }
    }
  }

  /** Boost: rate a battle-eligible roster (all three Evolved+) as soon as it exists so
   *  lineage from its disbanded predecessor is consumed at creation, not at the first
   *  queue join. Base rosters and lobsters the mirror does not know yet are skipped -
   *  the API's queue join calls ensureTeamRating lazily once the team can battle - so
   *  failures are logged rather than thrown. */
  private async rateIfBattleEligible(teamId: bigint, owner: string, lobsterIds: RosterIds): Promise<void> {
    try {
      const power = await loadTeamPower(lobsterIds);
      if (power === null) return;

      const epochId = await currentBoostEpochId(db);
      const result = await ensureTeamRating(db, { teamId, owner, lobsterIds, power, epochId });
      pinoLog.info(
        {
          teamId: teamId.toString(),
          owner,
          power,
          epochId,
          rating: result.rating,
          created: result.created,
          reset: result.reset,
          module: 'team-watcher',
          op: 'TeamCreated',
        },
        result.created ? 'rated new team' : result.reset ? 'team rating reset (power changed)' : 'team already rated',
      );
    } catch (err) {
      pinoLog.error(
        { err, teamId: teamId.toString(), module: 'team-watcher', op: 'TeamCreated' },
        'failed to rate new team; queue join will rate it lazily',
      );
    }
  }
}
