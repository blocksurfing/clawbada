import type { Log } from 'viem';
import { EventWatcher, type WatcherConfig } from '../lib/event-processor';

/**
 * Watches MiningPool events and syncs expedition state to DB.
 *
 * Events: SeasonStarted, ExpeditionStarted, ExpeditionClaimed, BaseRewardUpdated
 */
export class MiningWatcher extends EventWatcher {
  readonly config: WatcherConfig = {
    contractName: 'MiningPool',
    abi: [], // TODO: Import from @clawbada/chain
    address: (process.env.MINING_POOL_ADDRESS ?? '0x') as `0x${string}`,
    events: ['SeasonStarted', 'ExpeditionStarted', 'ExpeditionClaimed', 'BaseRewardUpdated'],
  };

  async handleEvent(_log: Log): Promise<void> {
    // TODO: Decode event, update expeditions/seasons tables
  }
}
