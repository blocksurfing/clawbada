import type { Log } from 'viem';
import { EventWatcher, type WatcherConfig } from '../lib/event-processor';

/**
 * Watches TeamManager events and syncs team state to DB.
 *
 * Events: TeamCreated, TeamDisbanded, TeamActivityUpdated
 */
export class TeamWatcher extends EventWatcher {
  readonly config: WatcherConfig = {
    contractName: 'TeamManager',
    abi: [], // TODO: Import from @clawbada/chain
    address: (process.env.TEAM_MANAGER_ADDRESS ?? '0x') as `0x${string}`,
    events: ['TeamCreated', 'TeamDisbanded', 'TeamActivityUpdated'],
  };

  async handleEvent(_log: Log): Promise<void> {
    // TODO: Decode event, update teams table
  }
}
