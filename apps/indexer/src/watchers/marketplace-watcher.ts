import type { Log } from 'viem';
import { EventWatcher, type WatcherConfig } from '../lib/event-processor';

/**
 * Watches Marketplace events and syncs listing state to DB.
 *
 * Events: LobsterListed, LobsterSold, ListingCancelled, ListingPriceUpdated
 */
export class MarketplaceWatcher extends EventWatcher {
  readonly config: WatcherConfig = {
    contractName: 'Marketplace',
    abi: [], // TODO: Import from @clawbada/chain
    address: (process.env.MARKETPLACE_ADDRESS ?? '0x') as `0x${string}`,
    events: ['LobsterListed', 'LobsterSold', 'ListingCancelled', 'ListingPriceUpdated'],
  };

  async handleEvent(_log: Log): Promise<void> {
    // TODO: Decode event, update listings/price_history tables
  }
}
