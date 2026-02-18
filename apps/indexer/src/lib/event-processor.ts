/**
 * Base class for contract event watchers.
 * Provides common functionality: block tracking, backfill, live watching.
 */
import type { Log } from 'viem';
import { getPublicClient } from '@clawbada/chain';
import { db, onChainEvents } from '@clawbada/db';
import { BlockTracker } from './block-tracker';

export interface WatcherConfig {
  contractName: string;
  abi: readonly unknown[];
  address: `0x${string}`;
  events: string[];
}

const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
const BACKFILL_BATCH_SIZE = 2000n;

export abstract class EventWatcher {
  protected running = false;
  protected unwatch?: () => void;
  private blockTracker: BlockTracker;

  constructor() {
    this.blockTracker = new BlockTracker();
  }

  abstract readonly config: WatcherConfig;

  /**
   * Start watching for events.
   * 1. Load last processed block
   * 2. Backfill missed events
   * 3. Start live watching
   */
  async start(): Promise<void> {
    this.running = true;
    const client = getPublicClient(isTestnet) as any;
    const lastBlock = await this.blockTracker.getLastBlock(this.config.contractName);
    const currentBlock = await client.getBlockNumber();

    console.log(`[${this.config.contractName}] Starting from block ${lastBlock}, current ${currentBlock}`);

    // Backfill missed blocks
    if (lastBlock > 0n && lastBlock < currentBlock) {
      await this.backfill(client, lastBlock + 1n, currentBlock);
    }

    // Start live watching
    this.unwatch = client.watchContractEvent({
      address: this.config.address,
      abi: this.config.abi,
      onLogs: async (logs: Log[]) => {
        for (const log of logs) {
          try {
            await this.processLog(log);
          } catch (err) {
            console.error(`[${this.config.contractName}] Error processing log:`, err);
          }
        }
      },
    });

    console.log(`[${this.config.contractName}] Watcher active`);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.unwatch?.();
    console.log(`[${this.config.contractName}] Watcher stopped`);
  }

  /**
   * Backfill events from a range of blocks.
   * Block tracker is updated once per batch (not per-log) for performance.
   */
  private async backfill(client: any, fromBlock: bigint, toBlock: bigint): Promise<void> {
    console.log(`[${this.config.contractName}] Backfilling blocks ${fromBlock}-${toBlock}`);

    for (let start = fromBlock; start <= toBlock; start += BACKFILL_BATCH_SIZE) {
      const end = start + BACKFILL_BATCH_SIZE - 1n > toBlock ? toBlock : start + BACKFILL_BATCH_SIZE - 1n;

      const logs = await client.getContractEvents({
        address: this.config.address,
        abi: this.config.abi,
        fromBlock: start,
        toBlock: end,
      });

      for (const log of logs) {
        await this.processLog(log as Log, false);
      }

      // Update block tracker once per batch range
      await this.blockTracker.setLastBlock(this.config.contractName, end);

      if (logs.length > 0) {
        console.log(`[${this.config.contractName}] Backfilled ${logs.length} events (blocks ${start}-${end})`);
      }
    }
  }

  /**
   * Process a single log: decode, store in events table, call handler.
   * Block tracker update is optional (skipped during backfill, done per-log during live watching).
   */
  private async processLog(log: Log, updateBlockTracker = true): Promise<void> {
    // Store raw event
    await db.insert(onChainEvents).values({
      contractName: this.config.contractName,
      eventName: (log as any).eventName ?? 'unknown',
      blockNumber: log.blockNumber ?? 0n,
      txHash: log.transactionHash ?? '',
      logIndex: log.logIndex ?? 0,
      args: (log as any).args ?? {},
    });

    // Let subclass handle the specific event
    await this.handleEvent(log);

    // Update block tracker (live mode only — backfill updates per-batch)
    if (updateBlockTracker && log.blockNumber) {
      await this.blockTracker.setLastBlock(this.config.contractName, log.blockNumber);
    }
  }

  /**
   * Handle a specific event. Implemented by each watcher subclass.
   */
  abstract handleEvent(log: Log): Promise<void>;
}
