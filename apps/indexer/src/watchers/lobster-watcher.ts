import type { Log } from 'viem';
import { EventWatcher, type WatcherConfig } from '../lib/event-processor';

/**
 * Watches LobsterNFT events and syncs lobster state to DB.
 *
 * Events: LobsterMinted, LobsterBurned, LobsterEvolved,
 *         LobsterDamageUpdated, LobsterLocked, LobsterBred
 */
export class LobsterWatcher extends EventWatcher {
  readonly config: WatcherConfig = {
    contractName: 'LobsterNFT',
    abi: [], // TODO: Import from @clawbada/chain
    address: (process.env.LOBSTER_NFT_ADDRESS ?? '0x') as `0x${string}`,
    events: [
      'LobsterMinted',
      'LobsterBurned',
      'LobsterEvolved',
      'LobsterDamageUpdated',
      'LobsterLocked',
      'LobsterBred',
    ],
  };

  async handleEvent(_log: Log): Promise<void> {
    // TODO: Decode event, update lobsters table
    // - LobsterMinted: INSERT new lobster with DNA, owner, generation, soulbound
    // - LobsterBurned: SET burnedAt
    // - LobsterEvolved: UPDATE evolutionTier
    // - LobsterDamageUpdated: UPDATE damage
    // - LobsterLocked: UPDATE locked
    // - LobsterBred: UPDATE breedCount
  }
}
