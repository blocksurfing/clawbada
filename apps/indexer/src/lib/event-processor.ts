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
/** An event this old (~60 s on Base) that the live watch has not processed is lag. */
export const LAG_THRESHOLD_BLOCKS = 30n;
/** How often the lag probe asks the RPC. */
const LAG_PROBE_MS = 30_000;

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

/**
 * Pure: the block range the lag probe asks the RPC about — blocks old enough that the live watch
 * must have processed their events by now (`threshold` behind the head), past whatever was
 * processed or already probed clean. `null` when nothing new has aged past the threshold.
 */
export function lagProbeRange(
  lastProcessed: bigint,
  probedThrough: bigint,
  head: bigint,
  threshold: bigint = LAG_THRESHOLD_BLOCKS,
): { fromBlock: bigint; toBlock: bigint } | null {
  const fromBlock = (lastProcessed > probedThrough ? lastProcessed : probedThrough) + 1n;
  const toBlock = head - threshold;
  if (toBlock < fromBlock) return null;
  return { fromBlock, toBlock };
}

/** Event args for the JSON `on_chain_events.args` column: bigints (every uint) become decimal strings. */
export function serializeEventArgs(args: unknown): unknown {
  return JSON.parse(JSON.stringify(args ?? {}, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

export abstract class EventWatcher {
  protected running = false;
  protected unwatch?: () => void;
  private blockTracker: BlockTracker;
  private client: any;
  /** In-memory mirror of the block tracker (it only moves when a log is processed). */
  private lastProcessedBlock = 0n;
  /** Highest block the lag probe has confirmed holds nothing unprocessed. */
  private probedThrough = 0n;
  private lagTimer?: ReturnType<typeof setInterval>;
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
    this.client = client;
    const lastBlock = await this.blockTracker.getLastBlock(this.config.contractName);
    this.lastProcessedBlock = lastBlock;
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
      // Without this viem swallows a failing poll (RPC down, getLogs rejected) and the watcher
      // looks alive while indexing nothing. viem keeps retrying the same range, so one error is
      // a blip; a stream of them is an outage — the lag probe below says whether events were missed.
      onError: (err: Error) => {
        this.log.error({ err }, 'indexer_watch_error — the live event poll failed; if this repeats, events are not being indexed');
      },
    });
    this.lagTimer = setInterval(() => {
      this.probeLag().catch((err) => this.log.warn({ err }, 'lag probe failed'));
    }, LAG_PROBE_MS);

    this.log.info('Watcher active');
  }

  async stop(): Promise<void> {
    this.running = false;
    this.unwatch?.();
    if (this.lagTimer) {
      clearInterval(this.lagTimer);
      this.lagTimer = undefined;
    }
    this.log.info('Watcher stopped');
  }

  /**
   * Lag alarm (review 2026-10-03, section C). The block tracker only moves when a log is
   * processed, so "head minus last processed block" alone would page forever on a quiet contract.
   * Instead the probe asks the RPC whether this contract emitted anything older than
   * LAG_THRESHOLD_BLOCKS that the live watch has not processed. Anything found is a real miss (a
   * dead watch, a hung handler, an RPC that stopped returning logs): `indexer_lagging`, error
   * level, repeated every probe until the events are processed. Returns the number missed.
   */
  async probeLag(): Promise<number> {
    const head: bigint = await this.client.getBlockNumber();
    const range = lagProbeRange(this.lastProcessedBlock, this.probedThrough, head);
    if (!range) return 0;
    const logs: Log[] = await this.client.getContractEvents({
      address: this.config.address,
      abi: this.config.abi,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
    });
    // The live loop may have processed part of the range while the RPC answered: not lag.
    const missed = logs.filter((log) => (log.blockNumber ?? 0n) > this.lastProcessedBlock);
    if (missed.length > 0) {
      this.log.error(
        {
          count: missed.length,
          oldestBlock: missed[0]!.blockNumber?.toString(),
          lastProcessedBlock: this.lastProcessedBlock.toString(),
          head: head.toString(),
          thresholdBlocks: LAG_THRESHOLD_BLOCKS.toString(),
        },
        'indexer_lagging — events older than the threshold that the live watch has not processed; restart the indexer (the backfill resumes from lastProcessedBlock)',
      );
      return missed.length;
    }
    this.probedThrough = range.toBlock;
    return 0;
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
      this.lastProcessedBlock = end;

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
      // viem decodes uint args as bigint; JSON columns cannot take them. Before this every
      // game event (LobsterMinted, StakeDeposited, SeasonStarted…) threw here and its handler
      // never ran — only bigint-free events such as RoleGranted were indexed.
      args: serializeEventArgs((log as any).args),
    });

    // Let subclass handle the specific event
    await this.handleEvent(log);

    // Update block tracker (live mode only — backfill updates per-batch)
    if (updateBlockTracker && log.blockNumber) {
      await this.blockTracker.setLastBlock(this.config.contractName, log.blockNumber);
      if (log.blockNumber > this.lastProcessedBlock) this.lastProcessedBlock = log.blockNumber;
    }
  }

  /**
   * Handle a specific event. Implemented by each watcher subclass.
   */
  abstract handleEvent(log: Log): Promise<void>;
}
