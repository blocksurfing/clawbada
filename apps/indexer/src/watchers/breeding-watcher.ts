/**
 * Watches BreedingLab events and syncs breed records to DB.
 *
 * Events: LobsterBred
 */
import type { Log } from 'viem';
import { BreedingLabAbi, addresses } from '@clawbada/chain';
import { db, breeds } from '@clawbada/db';
import { EventWatcher, type WatcherConfig } from '../lib/event-processor';

export class BreedingWatcher extends EventWatcher {
  readonly config: WatcherConfig = {
    contractName: 'BreedingLab',
    abi: BreedingLabAbi as any,
    address: addresses.breedingLab,
    events: ['LobsterBred'],
  };

  async handleEvent(log: Log): Promise<void> {
    const event = log as any;
    const name = event.eventName;
    const args = event.args ?? {};

    if (name === 'LobsterBred') {
      await db.insert(breeds).values({
        parentA: BigInt(args.parentA),
        parentB: BigInt(args.parentB),
        offspringId: BigInt(args.offspringId),
        cost: BigInt(args.cost).toString(),
        parentABreedIndex: Number(args.parentABreedIndex ?? 0),
        parentBBreedIndex: Number(args.parentBBreedIndex ?? 0),
        offspringGeneration: Number(args.offspringGeneration ?? 0),
        txHash: log.transactionHash ?? '',
      });
    }
  }
}
