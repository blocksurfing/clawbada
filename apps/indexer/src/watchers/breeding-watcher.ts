import type { Log } from 'viem';
import { EventWatcher, type WatcherConfig } from '../lib/event-processor';

/**
 * Watches BreedingLab events and syncs breed records to DB.
 *
 * Events: LobsterBred
 */
export class BreedingWatcher extends EventWatcher {
  readonly config: WatcherConfig = {
    contractName: 'BreedingLab',
    abi: [], // TODO: Import from @clawbada/chain
    address: (process.env.BREEDING_LAB_ADDRESS ?? '0x') as `0x${string}`,
    events: ['LobsterBred'],
  };

  async handleEvent(_log: Log): Promise<void> {
    // TODO: Decode event, insert into breeds table
  }
}
