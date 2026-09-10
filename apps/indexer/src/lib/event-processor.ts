/**
 * Base class for contract event watchers.
 * Provides common functionality: block tracking, backfill, live watching.
 */
import type { Log } from 'viem';
import { getPublicClient } from '@clawbada/chain';
import { db, onChainEvents } from '@clawbada/db';
import { BlockTracker } from './block-tracker';
import type { Logger } from '@clawbada/logger';
import { log as baseLog } from '../logger';

export interface WatcherConfig {
  contractName: string;
  abi: readonly unknown[];
  address: `0x${string}`;
  events: string[];
}

const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
const BACKFILL_BATCH_SIZE = 2000n;

/** `INDEXER_START_BLOCK` as a bigint, or null when unset / not a non-negative integer. */
export function parseStartBlock(raw: string | undefined): bigint | null {
  if (raw === undefined || raw.trim() === '') return null;
  if (!/^\d+$/.test(raw.trim())) return null;
  return BigInt(raw.trim());
}

/**
 * Where a watcher's backfill starts. A stored `lastProcessedBlock` always wins (resume from
 * the next block). On a cold start (no row) the configured start block is used, so a fresh
 * database catches up on everything since the deploy — including `SeasonStarted` from
 * Configure, which the boost epoch clock needs. Unset on a cold start → null: live only.
 */
export function resolveBackfillStart(lastBlock: bigint, configuredStart: bigint | null, currentBlock: bigint): bigint | null {
  const from = lastBlock > 0n ? lastBlock + 1n : configuredStart;
  if (from === null || from > currentBlock) return null;
  return from;
}

export abstract class EventWatcher {
  protected running = false;
  protected unwatch?: () => void;
  private blockTracker: BlockTracker;
  protected get log(): Logger {
    return baseLog.child({ module: 'watcher', contract: this.config.contractName });
  }

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

    this.log.info({ fromBlock: lastBlock.toString(), currentBlock: currentBlock.toString() }, 'Starting watcher');

    // Backfill missed blocks (resume), or everything since INDEXER_START_BLOCK on a cold start.
    const configuredStart = parseStartBlock(process.env.INDEXER_START_BLOCK);
    const backfillFrom = resolveBackfillStart(lastBlock, configuredStart, currentBlock);
    if (backfillFrom !== null) {
      await this.backfill(client, backfillFrom, currentBlock);
    } else if (lastBlock === 0n) {
      this.log.warn(
        { currentBlock: currentBlock.toString() },
        'cold start with no INDEXER_START_BLOCK — watching live from the current block; events emitted before now (e.g. SeasonStarted) are not indexed',
      );
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
            this.log.error({ err }, 'Error processing log');
          }
        }
      },
    });

    this.log.info('Watcher active');
  }

  async stop(): Promise<void> {
    this.running = false;
    this.unwatch?.();
    this.log.info('Watcher stopped');
  }

  /**
   * Backfill events from a range of blocks.
   * Block tracker is updated once per batch (not per-log) for performance.
   */
  private async backfill(client: any, fromBlock: bigint, toBlock: bigint): Promise<void> {
    this.log.info({ fromBlock: fromBlock.toString(), toBlock: toBlock.toString() }, 'Backfilling blocks');

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
        this.log.info({ count: logs.length, fromBlock: start.toString(), toBlock: end.toString() }, 'Backfilled events');
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
