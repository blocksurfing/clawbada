/**
 * Watches Treasury events for protocol fee tracking.
 *
 * Events: FeeProcessed
 *
 * Fee events are already stored in on_chain_events by the base class.
 * This watcher provides a hook for future analytics or alerting.
 */
import type { Log } from 'viem';
import { TreasuryAbi, addresses } from '@clawbada/chain';
import { EventWatcher, type WatcherConfig } from '../lib/event-processor';

export class TreasuryWatcher extends EventWatcher {
  readonly config: WatcherConfig = {
    contractName: 'Treasury',
    abi: TreasuryAbi as any,
    address: addresses.treasury,
    events: ['FeeProcessed'],
  };

  async handleEvent(log: Log): Promise<void> {
    const event = log as any;
    const name = event.eventName;
    const args = event.args ?? {};

    if (name === 'FeeProcessed') {
      const burnAmount = BigInt(args.burnAmount ?? 0);
      const devAmount = BigInt(args.devAmount ?? 0);
      const total = burnAmount + devAmount;
      console.log(
        `[Treasury] Fee processed: ${total} $CLAW (${burnAmount} burned, ${devAmount} to dev)`,
      );
    }
  }
}
