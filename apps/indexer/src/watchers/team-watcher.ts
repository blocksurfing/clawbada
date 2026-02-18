/**
 * Watches TeamManager events and syncs team state to DB.
 *
 * Events: TeamCreated, TeamDisbanded, TeamActivityUpdated
 */
import type { Log } from 'viem';
import { eq } from 'drizzle-orm';
import { TeamManagerAbi, addresses } from '@clawbada/chain';
import { db, teams } from '@clawbada/db';
import { EventWatcher, type WatcherConfig } from '../lib/event-processor';

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
        const lobsterIds = args.lobsterIds as bigint[];

        await db.insert(teams).values({
          teamId,
          owner: (args.owner as string).toLowerCase(),
          lobster0: lobsterIds[0],
          lobster1: lobsterIds[1],
          lobster2: lobsterIds[2],
          active: true,
        });
        break;
      }

      case 'TeamDisbanded': {
        const teamId = BigInt(args.teamId);
        await db
          .update(teams)
          .set({ active: false })
          .where(eq(teams.teamId, teamId));
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
}
