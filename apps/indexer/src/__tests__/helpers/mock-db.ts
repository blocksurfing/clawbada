/**
 * Test doubles for the indexer watchers.
 *
 * `makeDb()` is a drizzle-shaped fake: each `select/insert/update/delete` call returns a
 * recording chain (every builder method returns the chain; awaiting it resolves to the
 * next queued result for that method), and `transaction(fn)` runs `fn` with the same
 * fake so query helpers see "the tx". Tables are plain objects (house style, see
 * apps/api/src/__tests__/routes/combat.test.ts) - drizzle's operators accept them.
 */
import { mock } from 'bun:test';
import type { Log } from 'viem';

export interface RecordedCall {
  method: string;
  args: unknown[];
}

/** A builder chain that records its calls and resolves to `result` when awaited. */
export function makeChain(result: unknown = []): any {
  const calls: RecordedCall[] = [];
  const proxy: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(onFulfilled, onRejected);
        }
        if (prop === 'calls') return calls;
        if (typeof prop === 'symbol') return undefined;
        return (...args: unknown[]) => {
          calls.push({ method: String(prop), args });
          return proxy;
        };
      },
    },
  );
  return proxy;
}

type Method = 'select' | 'insert' | 'update' | 'delete';
const METHODS: Method[] = ['select', 'insert', 'update', 'delete'];

export function makeDb() {
  const queues: Record<Method, unknown[]> = { select: [], insert: [], update: [], delete: [] };
  const next = (m: Method) => (queues[m].length > 0 ? queues[m].shift() : []);
  const db: any = {
    select: mock((..._args: unknown[]) => makeChain(next('select'))),
    insert: mock((..._args: unknown[]) => makeChain(next('insert'))),
    update: mock((..._args: unknown[]) => makeChain(next('update'))),
    delete: mock((..._args: unknown[]) => makeChain(next('delete'))),
    transaction: mock(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    /** Queue what the next chains of `method` resolve to, in call order. */
    queue(method: Method, ...results: unknown[]) {
      queues[method].push(...results);
    },
    reset() {
      for (const m of METHODS) {
        db[m].mockClear();
        queues[m].length = 0;
      }
      db.transaction.mockClear();
    },
  };
  return db;
}

/** The recorded builder calls of the i-th chain a db method returned. */
export function chainCalls(spy: any, i: number): RecordedCall[] {
  return spy.mock.results[i].value.calls;
}

/** First argument of the first `method` call in a chain (e.g. the `.set({...})` payload). */
export function argOf(calls: RecordedCall[], method: string): any {
  const call = calls.find((c) => c.method === method);
  if (!call) throw new Error(`no ${method}() call recorded; saw ${calls.map((c) => c.method).join(', ')}`);
  return call.args[0];
}

function table(name: string, columns: string[]) {
  const t: Record<string, unknown> = { _: { name } };
  for (const c of columns) t[c] = `${name}.${c}`;
  return t;
}

export const tables = {
  battles: table('battles', [
    'battleId', 'playerA', 'playerB', 'teamA', 'teamB', 'queuedTeamA', 'queuedTeamB', 'phase',
    'powerA', 'powerB', 'winner', 'winnerPayout', 'protocolFee', 'totalRounds', 'settledAt',
  ]),
  battleSessions: table('battle_sessions', ['id', 'status', 'turn', 'finalStateHash', 'turnLogHash', 'updatedAt']),
  agents: table('agents', ['address', 'elo', 'wins', 'losses', 'totalBattles']),
  operatorJobs: table('operator_jobs', ['jobType', 'payload', 'idempotencyKey']),
  teams: table('teams', ['teamId', 'owner', 'lobster0', 'lobster1', 'lobster2', 'active', 'disbandedAt']),
  lobsters: table('lobsters', ['tokenId', 'owner', 'evolutionTier', 'damage', 'locked', 'breedCount', 'updatedAt']),
  matchmakingQueue: table('matchmaking_queue', ['id', 'address', 'teamId']),
  expeditions: table('expeditions', ['expeditionId', 'teamId', 'owner', 'season', 'mineTier', 'startTime', 'reward', 'boostBps', 'claimed', 'claimedAt']),
  seasons: table('seasons', ['season', 'totalEmission', 'baseReward', 'totalMinted', 'startTime']),
  onChainEvents: table('on_chain_events', ['contractName', 'eventName']),
  indexerState: table('indexer_state', ['contractName', 'lastProcessedBlock']),
};

export function makeLogger() {
  const logger: any = {
    trace: mock(() => {}),
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    fatal: mock(() => {}),
  };
  logger.child = mock(() => logger);
  return logger;
}

/** Message strings a pino spy was called with (the second positional arg). */
export function logMessages(spy: any): string[] {
  return spy.mock.calls.map((c: unknown[]) => String(c[1] ?? c[0]));
}

/** A decoded viem log as the watchers receive it from watchContractEvent / getContractEvents. */
export function makeEventLog(eventName: string, args: Record<string, unknown>, blockNumber: bigint | null = 100n): Log {
  return { eventName, args, blockNumber, transactionHash: '0xabc', logIndex: 0 } as unknown as Log;
}
