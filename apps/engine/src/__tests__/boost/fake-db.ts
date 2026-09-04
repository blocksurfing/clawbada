/** Chainable drizzle stand-in for the boost epoch job tests.
 *
 *  Every builder call (`select/from/where/...`) is recorded on a QueryRecord; awaiting
 *  the chain hands that record to the test's handler for the verb, which returns rows
 *  (select / returning) or applies the write to its own in-memory state. Nothing is
 *  parsed except the WHERE expression: with the mocked tables' columns being plain
 *  string keys, drizzle's `eq(col, v)` yields an SQL whose raw chunks are `[col, v]`,
 *  so `whereValue('boost_epochs.epochId')` recovers the bound id. */
import { Param, SQL, StringChunk } from 'drizzle-orm';

export interface QueryCall {
  method: string;
  args: unknown[];
}

export interface QueryRecord {
  verb: 'select' | 'insert' | 'update' | 'delete';
  table: string;
  projection: Record<string, unknown> | undefined;
  values: unknown;
  set: Record<string, unknown> | undefined;
  calls: QueryCall[];
  has(method: string): boolean;
  args(method: string): unknown[] | undefined;
  /** Raw values bound in the WHERE expression, in order (column keys and params). */
  whereValues(): unknown[];
  /** The bound value following `columnKey` in the WHERE expression, if any. */
  whereValue(columnKey: string): unknown;
  /** `{ column: value }` for every `col = value` in the WHERE whose key starts with `prefix`. */
  wherePairs(prefix: string): Record<string, unknown>;
}

export interface FakeDbHandlers {
  select?: (q: QueryRecord) => unknown[];
  insert?: (q: QueryRecord) => unknown[];
  update?: (q: QueryRecord) => unknown[];
  delete?: (q: QueryRecord) => unknown[];
}

export interface FakeDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  queries: QueryRecord[];
  byTable(verb: QueryRecord['verb'], table: string): QueryRecord[];
}

const CHAIN_METHODS = [
  'from',
  'innerJoin',
  'leftJoin',
  'where',
  'groupBy',
  'having',
  'orderBy',
  'limit',
  'for',
  'values',
  'set',
  'onConflictDoNothing',
  'returning',
] as const;

/** Walk an SQL expression tree and collect the raw bound values in order. */
export function sqlValues(expr: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (node instanceof StringChunk) return;
    if (node instanceof Param) {
      out.push(node.value);
      return;
    }
    if (node instanceof SQL) {
      for (const chunk of node.queryChunks) walk(chunk);
      return;
    }
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (typeof node === 'object') {
      const o = node as { queryChunks?: unknown[]; value?: unknown; encoder?: unknown };
      if (Array.isArray(o.queryChunks)) {
        for (const chunk of o.queryChunks) walk(chunk);
        return;
      }
      if ('encoder' in o && 'value' in o) {
        out.push(o.value);
        return;
      }
      if (Array.isArray(o.value) && o.value.every((s) => typeof s === 'string') && !(node instanceof Date)) return;
    }
    out.push(node);
  };
  walk(expr);
  return out;
}

function tableName(table: unknown): string {
  return (table as { _?: { name?: string } } | undefined)?._?.name ?? 'unknown';
}

export function makeFakeDb(handlers: FakeDbHandlers): FakeDb {
  const queries: QueryRecord[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const start = (verb: QueryRecord['verb'], first: unknown): any => {
    const rec: QueryRecord = {
      verb,
      table: verb === 'select' ? '' : tableName(first),
      projection: verb === 'select' ? (first as Record<string, unknown> | undefined) : undefined,
      values: undefined,
      set: undefined,
      calls: [],
      has(method) {
        return this.calls.some((c) => c.method === method);
      },
      args(method) {
        return this.calls.find((c) => c.method === method)?.args;
      },
      whereValues() {
        const w = this.args('where');
        return w ? sqlValues(w[0]) : [];
      },
      whereValue(columnKey) {
        const vals = this.whereValues();
        const i = vals.indexOf(columnKey);
        return i >= 0 ? vals[i + 1] : undefined;
      },
      wherePairs(prefix) {
        const vals = this.whereValues();
        const pairs: Record<string, unknown> = {};
        for (let i = 0; i < vals.length; i++) {
          const v = vals[i];
          if (typeof v !== 'string' || !v.startsWith(prefix)) continue;
          const next = vals[i + 1];
          if (typeof next === 'string' && next.startsWith(prefix)) continue;
          if (next === undefined) continue;
          pairs[v.slice(prefix.length)] = next;
        }
        return pairs;
      },
    };

    let executed: Promise<unknown[]> | null = null;
    const run = (): Promise<unknown[]> => {
      if (executed === null) {
        queries.push(rec);
        executed = Promise.resolve().then(() => handlers[rec.verb]?.(rec) ?? []);
      }
      return executed;
    };

    const chain: Record<string, unknown> = {};
    for (const method of CHAIN_METHODS) {
      chain[method] = (...args: unknown[]) => {
        rec.calls.push({ method, args });
        if (method === 'from') rec.table = tableName(args[0]);
        if (method === 'values') rec.values = args[0];
        if (method === 'set') rec.set = args[0] as Record<string, unknown>;
        return chain;
      };
    }
    chain.then = (onFulfilled?: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
      run().then(onFulfilled, onRejected);
    chain.catch = (onRejected?: (e: unknown) => unknown) => run().catch(onRejected);
    chain.finally = (onFinally?: () => void) => run().finally(onFinally);
    return chain;
  };

  const db = {
    select: (projection?: Record<string, unknown>) => start('select', projection),
    insert: (table: unknown) => start('insert', table),
    update: (table: unknown) => start('update', table),
    delete: (table: unknown) => start('delete', table),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(db),
  };

  return {
    db,
    queries,
    byTable: (verb, table) => queries.filter((q) => q.verb === verb && q.table === table),
  };
}

/** Table objects for `mock.module('@clawbada/db')`: `_ .name` for the fake's dispatch,
 *  and every column as a unique string key so WHERE values can be read back. */
export function mockDbTables() {
  const T = (name: string, cols: string[]) => ({
    _: { name },
    ...Object.fromEntries(cols.map((c) => [c, `${name}.${c}`])),
  });
  return {
    boostEpochs: T('boost_epochs', [
      'epochId', 'chainEpoch', 'startsAt', 'endsAt', 'floorPlayed', 'status', 'ratedCount', 'qualifiedCount',
      'lapsedCount', 'avgBoostBps', 'setJobIds', 'activateJobId', 'activateTxHash', 'activatedAt', 'flags',
      'lastError', 'createdAt', 'updatedAt',
    ]),
    teamBoosts: T('team_boosts', [
      'epochId', 'teamId', 'earnedEpochId', 'rating', 'rank', 'percentile', 'boostBps', 'power', 'gamesPlayed',
      'batchIndex', 'txHash', 'createdAt',
    ]),
    teamRatings: T('team_ratings', [
      'teamId', 'owner', 'rating', 'power', 'epochId', 'gamesPlayedEpoch', 'gamesPlayedTotal', 'wins', 'losses',
    ]),
    teams: T('teams', ['teamId', 'owner', 'disbandedAt']),
    battleParticipation: T('battle_participation', ['battleId', 'teamId', 'opponentTeamId', 'epochId', 'kind']),
    operatorJobs: T('operator_jobs', [
      'id', 'jobType', 'payload', 'idempotencyKey', 'status', 'attempts', 'lastError', 'nextAttemptAt', 'txHash',
    ]),
  };
}
