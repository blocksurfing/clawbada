import type { Log } from 'viem';
import { EventWatcher, type WatcherConfig } from '../lib/event-processor';

/**
 * Watches Treasury events for protocol fee tracking.
 *
 * Events: FeeProcessed
 */
export class TreasuryWatcher extends EventWatcher {
  readonly config: WatcherConfig = {
    contractName: 'Treasury',
    abi: [], // TODO: Import from @clawbada/chain
    address: (process.env.TREASURY_ADDRESS ?? '0x') as `0x${string}`,
    events: ['FeeProcessed'],
  };

  async handleEvent(_log: Log): Promise<void> {
    // TODO: Decode event, insert into on_chain_events for analytics
  }
}
