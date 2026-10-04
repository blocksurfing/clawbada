/**
 * The live half of EventWatcher (lib/event-processor.ts): the viem watch reports its errors
 * (`indexer_watch_error`) and a lag probe pages `indexer_lagging` when the chain holds events
 * older than LAG_THRESHOLD_BLOCKS that the watcher never processed — and stays quiet on a
 * contract that simply has nothing to say.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { Log } from 'viem';
import { makeDb, makeLogger, makeEventLog, tables, logMessages } from './helpers/mock-db';

// -- Mocks BEFORE importing the processor --
const db = makeDb();
const logger = makeLogger();
mock.module('@clawbada/db', () => ({ db, onChainEvents: tables.onChainEvents, indexerState: tables.indexerState }));

const client = {
  head: 100n,
  watch: null as null | { onLogs: (logs: Log[]) => Promise<void>; onError?: (err: Error) => void },
  events: [] as Log[],
  getBlockNumber: mock(async () => client.head),
  getContractEvents: mock(async (_args: unknown) => client.events),
  watchContractEvent: mock((opts: any) => {
    client.watch = opts;
    return () => {};
  }),
};
mock.module('@clawbada/chain', () => ({ getPublicClient: () => client }));
mock.module('../logger', () => ({ log: logger }));

import { EventWatcher, lagProbeRange, LAG_THRESHOLD_BLOCKS } from '../lib/event-processor';

class TestWatcher extends EventWatcher {
  readonly config = { contractName: 'Test', abi: [], address: '0x00000000000000000000000000000000000000a1' as const, events: ['Ping'] };
  handled: Log[] = [];
  async handleEvent(log: Log): Promise<void> {
    this.handled.push(log);
  }
}

beforeEach(() => {
  db.reset();
  for (const m of ['error', 'warn', 'info'] as const) logger[m].mockClear();
  client.head = 100n;
  client.events = [];
  client.watch = null;
  client.getContractEvents.mockClear();
});

describe('lagProbeRange (pure)', () => {
  test('nothing has aged past the threshold yet: null', () => {
    expect(lagProbeRange(0n, 0n, LAG_THRESHOLD_BLOCKS)).toBeNull();
    expect(lagProbeRange(100n, 0n, 100n + LAG_THRESHOLD_BLOCKS)).toBeNull();
  });
  test('starts after the later of last-processed and already-probed, ends threshold blocks behind the head', () => {
    expect(lagProbeRange(100n, 0n, 200n)).toEqual({ fromBlock: 101n, toBlock: 200n - LAG_THRESHOLD_BLOCKS });
    expect(lagProbeRange(100n, 150n, 200n)).toEqual({ fromBlock: 151n, toBlock: 200n - LAG_THRESHOLD_BLOCKS });
    expect(lagProbeRange(0n, 0n, 31n, 30n)).toEqual({ fromBlock: 1n, toBlock: 1n });
  });
});

describe('EventWatcher live watch', () => {
  test('a failing poll is reported as indexer_watch_error (viem would otherwise swallow it)', async () => {
    const w = new TestWatcher();
    await w.start();
    expect(client.watch?.onError).toBeFunction();
    client.watch!.onError!(new Error('getLogs: 429 Too Many Requests'));
    expect(logMessages(logger.error)[0]).toStartWith('indexer_watch_error');
    await w.stop();
  });

  test('a quiet contract never pages: the probe confirms the aged range is empty and moves on', async () => {
    const w = new TestWatcher();
    await w.start(); // cold start, no backfill: last processed = 0
    client.head = 100n;
    expect(await w.probeLag()).toBe(0);
    expect(client.getContractEvents).toHaveBeenLastCalledWith(expect.objectContaining({ fromBlock: 1n, toBlock: 100n - LAG_THRESHOLD_BLOCKS }));
    client.head = 110n;
    expect(await w.probeLag()).toBe(0);
    expect(client.getContractEvents).toHaveBeenLastCalledWith(expect.objectContaining({ fromBlock: 100n - LAG_THRESHOLD_BLOCKS + 1n, toBlock: 110n - LAG_THRESHOLD_BLOCKS }));
    expect(logMessages(logger.error)).toEqual([]);
    await w.stop();
  });

  test('events older than the threshold that the live watch never processed: indexer_lagging, every probe until processed', async () => {
    const w = new TestWatcher();
    await w.start();
    // The live watch processed block 40; the chain also has an event at block 60 it never delivered.
    await client.watch!.onLogs([makeEventLog('Ping', {}, 40n)]);
    expect(w.handled).toHaveLength(1);
    client.head = 100n;
    client.events = [makeEventLog('Ping', {}, 60n)];
    expect(await w.probeLag()).toBe(1);
    expect(client.getContractEvents).toHaveBeenLastCalledWith(expect.objectContaining({ fromBlock: 41n, toBlock: 70n }));
    expect(logMessages(logger.error)).toEqual([expect.stringContaining('indexer_lagging')]);
    expect(logger.error.mock.calls[0]![0]).toMatchObject({ count: 1, oldestBlock: '60', lastProcessedBlock: '40', head: '100' });
    // Still there next probe: pages again. Once the live loop has caught up past it: silent.
    expect(await w.probeLag()).toBe(1);
    await client.watch!.onLogs([makeEventLog('Ping', {}, 60n)]);
    expect(await w.probeLag()).toBe(0);
    expect(logMessages(logger.error)).toHaveLength(2);
    await w.stop();
  });

  test('events the live loop processed while the RPC was answering are not lag', async () => {
    const w = new TestWatcher();
    await w.start();
    client.head = 100n;
    client.getContractEvents.mockImplementationOnce(async () => {
      await client.watch!.onLogs([makeEventLog('Ping', {}, 65n)]);
      return [makeEventLog('Ping', {}, 65n)];
    });
    expect(await w.probeLag()).toBe(0);
    expect(logMessages(logger.error)).toEqual([]);
    await w.stop();
  });
});
