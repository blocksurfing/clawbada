import { describe, test, expect, mock, beforeEach } from 'bun:test';

/**
 * tryMatchForPlayer - S1 rating band (locked 2026-09-02).
 *
 * The drizzle predicate helpers are mocked as row predicates and the transaction's
 * SELECTs evaluate them against an in-memory queue, so the WHERE clause the matcher
 * builds is exercised for real (band inside the Power radius, widening on the
 * 30/60/120 s steps, hard cap 300) instead of asserting on call arguments.
 */

// ── In-memory queue the predicate mocks evaluate against ──
interface Row {
  id: bigint;
  address: string;
  teamId: bigint;
  stakeBracket: number;
  powerScore: number;
  elo: number;
  enqueuedAt: Date;
}
let queueRows: Row[] = [];
/** Flip off to bypass the SQL band so the in-memory re-check is exercised alone. */
let sqlRatingFilter = true;

type Pred = (row: any) => boolean;

const sqlTag: any = (strings: TemplateStringsArray, ...values: any[]) => ({ _sql: strings.join('?'), values });
sqlTag.raw = (s: string) => ({ _raw: s });
sqlTag.join = (...args: any[]) => ({ _sql: 'joined', args });

mock.module('drizzle-orm', () => ({
  eq: (col: string, v: unknown): Pred => (row) => row[col] === v,
  ne: (col: string, v: unknown): Pred => (row) => row[col] !== v,
  gte: (col: string, v: number): Pred => (row) => row[col] >= v,
  lte: (col: string, v: number): Pred => (row) => row[col] <= v,
  between: (col: string, lo: number, hi: number): Pred => (row) =>
    !sqlRatingFilter || (row[col] >= lo && row[col] <= hi),
  and: (...preds: Pred[]): Pred => (row) => preds.every((p) => p(row)),
  or: (...preds: Pred[]): Pred => (row) => preds.some((p) => p(row)),
  asc: (col: string) => col,
  desc: (col: string) => col,
  count: () => 'count',
  sql: sqlTag,
}));

// ── Mock @clawbada/db ──
const QUEUE_TABLE = {
  id: 'id',
  address: 'address',
  teamId: 'teamId',
  stakeBracket: 'stakeBracket',
  powerScore: 'powerScore',
  elo: 'elo',
  enqueuedAt: 'enqueuedAt',
};
const BATTLES_TABLE = { _name: 'battles' };
const DECISIONS_TABLE = { _name: 'matchmaking_decisions' };
const JOBS_TABLE = { _name: 'operator_jobs' };

const inserts: { table: any; values: any }[] = [];
const deletes: { table: any; pred: any }[] = [];

function insertChain(table: any) {
  const chain: any = {
    values: (v: any) => {
      inserts.push({ table, values: v });
      return chain;
    },
    returning: () => chain,
    onConflictDoNothing: () => chain,
    then: (resolve: Function, reject?: Function) => Promise.resolve([]).then(resolve as any, reject as any),
    catch: (fn: Function) => Promise.resolve([]).catch(fn as any),
  };
  return chain;
}

function deleteChain(table: any) {
  const chain: any = {
    where: (pred: any) => {
      deletes.push({ table, pred });
      return chain;
    },
    then: (resolve: Function, reject?: Function) => Promise.resolve([]).then(resolve as any, reject as any),
  };
  return chain;
}

function selectChain() {
  let pred: Pred | null = null;
  let limitN = Infinity;
  const chain: any = {
    from: () => chain,
    where: (p: Pred) => {
      pred = p;
      return chain;
    },
    orderBy: () => chain,
    for: () => chain,
    limit: (n: number) => {
      limitN = n;
      return chain;
    },
    then: (resolve: Function, reject?: Function) => {
      const rows = queueRows
        .filter((r) => (pred ? pred(r) : true))
        .sort((a, b) => a.enqueuedAt.getTime() - b.enqueuedAt.getTime())
        .slice(0, limitN);
      return Promise.resolve(rows).then(resolve as any, reject as any);
    },
  };
  return chain;
}

const txExecute = mock(async () => []);
const tx = {
  execute: txExecute,
  select: () => selectChain(),
  insert: (t: any) => insertChain(t),
  delete: (t: any) => deleteChain(t),
};

mock.module('@clawbada/db', () => ({
  db: {
    transaction: async (fn: Function) => fn(tx),
    insert: (t: any) => insertChain(t),
    select: () => selectChain(),
  },
  matchmakingQueue: QUEUE_TABLE,
  battles: BATTLES_TABLE,
  matchmakingDecisions: DECISIONS_TABLE,
  operatorJobs: JOBS_TABLE,
}));

// ── Mock @clawbada/chain ──
const simulateCreateBattle = mock(async () => ({ result: 777n }));
mock.module('@clawbada/chain', () => ({
  addresses: {},
  getPublicClient: () => ({}),
  getBattleArena: () => ({ simulate: { createBattle: simulateCreateBattle } }),
}));

// ── Mock ../lib/chain: per-team rosters so computePowerForTeam reproduces the
//    snapshot power (anything else trips the M-02 mutation path). ──
const rosters = new Map<string, bigint[]>();
const tiers = new Map<string, number>();

function setTeamPower(teamId: bigint, power: number): void {
  // Distribute power 3..9 over three Evolved+ lobsters (tier weight 1..3 each).
  const weights = [1, 1, 1];
  let extra = power - 3;
  for (let i = 0; i < 3 && extra > 0; i++) {
    const add = Math.min(2, extra);
    weights[i] += add;
    extra -= add;
  }
  const ids = weights.map((_, i) => teamId * 10n + BigInt(i + 1));
  rosters.set(teamId.toString(), ids);
  ids.forEach((id, i) => tiers.set(id.toString(), weights[i]));
}

// Real copy, not identity: bun module mocks persist across test files, and
// chain-utils.test.ts asserts on the real serializeBigInts behaviour.
function _serializeBigInts(obj: any): any {
  if (typeof obj === 'bigint') return obj.toString();
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(_serializeBigInts);
  if (typeof obj === 'object') {
    const r: any = {};
    for (const [k, v] of Object.entries(obj)) r[k] = _serializeBigInts(v);
    return r;
  }
  return obj;
}

mock.module('../lib/chain', () => ({
  readTeam: async (teamId: bigint) => ({
    teamId,
    owner: '0x0000000000000000000000000000000000000000',
    lobsterIds: rosters.get(teamId.toString()) ?? [teamId * 10n + 1n, teamId * 10n + 2n, teamId * 10n + 3n],
    active: false,
  }),
  readLobster: async (id: bigint) => ({ tokenId: id, evolutionTier: tiers.get(id.toString()) ?? 1, damage: 0 }),
  serializeBigInts: _serializeBigInts,
}));

// ── Mock ../logger and ../lib/ws ──
const logStub = { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}), debug: mock(() => {}) };
mock.module('../logger', () => ({ log: { child: () => logStub, ...logStub } }));

const notifyAddress = mock(() => {});
mock.module('../lib/ws', () => ({ battleWS: { notifyAddress, broadcast: mock(() => {}) } }));

// ── Import AFTER mocking ──
import { tryMatchForPlayer } from '../lib/matchmaker/match';

const ME = '0x00000000000000000000000000000000000000aa';
const OPP = '0x00000000000000000000000000000000000000bb';
const THIRD = '0x00000000000000000000000000000000000000cc';
const FOURTH = '0x00000000000000000000000000000000000000dd';

let nextId = 1n;
function enqueue(
  address: string,
  opts: { elo: number; power?: number; bracket?: number; waitedSec?: number },
): Row {
  const teamId = nextId;
  const power = opts.power ?? 3;
  setTeamPower(teamId, power);
  const row: Row = {
    id: nextId++,
    address,
    teamId,
    stakeBracket: opts.bracket ?? 0,
    powerScore: power,
    elo: opts.elo,
    enqueuedAt: new Date(Date.now() - (opts.waitedSec ?? 0) * 1000),
  };
  queueRows.push(row);
  return row;
}

function decisions(): any[] {
  return inserts.filter((i) => i.table === DECISIONS_TABLE).flatMap((i) => i.values);
}
function battleInserts(): any[] {
  return inserts.filter((i) => i.table === BATTLES_TABLE).map((i) => i.values);
}

describe('tryMatchForPlayer rating band', () => {
  beforeEach(() => {
    queueRows = [];
    inserts.length = 0;
    deletes.length = 0;
    sqlRatingFilter = true;
    nextId = 1n;
    rosters.clear();
    tiers.clear();
    simulateCreateBattle.mockClear();
  });

  test('pairs an opponent inside the initial +/-75 band and records radius telemetry', async () => {
    enqueue(ME, { elo: 1200 });
    enqueue(OPP, { elo: 1260 });

    const result = await tryMatchForPlayer(ME);
    expect(result).not.toBeNull();
    expect(result!.playerA).toBe(ME);
    expect(result!.playerB).toBe(OPP);
    expect(result!.battleId).toBe(777n);
    expect(battleInserts()).toHaveLength(1);
    expect(battleInserts()[0].queuedTeamA).toBe(1n);
    expect(battleInserts()[0].queuedTeamB).toBe(2n);

    const rows = decisions();
    expect(rows).toHaveLength(2);
    expect(rows[0].decision).toBe('matched');
    const meMeta = JSON.parse(rows[0].meta);
    expect(meMeta).toMatchObject({
      opponent: OPP,
      opponentPower: 3,
      opponentRating: 1260,
      ratingGap: 60,
      ratingRadius: 75,
      powerRadius: 0,
      battleId: '777',
    });
    const oppMeta = JSON.parse(rows[1].meta);
    expect(oppMeta).toMatchObject({ opponent: ME, opponentRating: 1200, ratingGap: 60, ratingRadius: 75, powerRadius: 0 });
  });

  test('skips an opponent outside the band at 0 s (gap 100 > 75)', async () => {
    enqueue(ME, { elo: 1200 });
    enqueue(OPP, { elo: 1300 });

    expect(await tryMatchForPlayer(ME)).toBeNull();
    expect(battleInserts()).toHaveLength(0);
    expect(deletes).toHaveLength(0);
    expect(decisions()).toHaveLength(0);
    expect(simulateCreateBattle).not.toHaveBeenCalled();
  });

  test('the band widens to 150 after 30 s', async () => {
    enqueue(ME, { elo: 1200, waitedSec: 31 });
    enqueue(OPP, { elo: 1300 });

    const result = await tryMatchForPlayer(ME);
    expect(result).not.toBeNull();
    const rows = decisions();
    expect(rows[0].decision).toBe('matched-after-expansion');
    const meta = JSON.parse(rows[0].meta);
    expect(meta.ratingRadius).toBe(150);
    expect(meta.powerRadius).toBe(1);
    expect(meta.ratingGap).toBe(100);
  });

  test('caps at 300 after 120 s: gap 301 never matches, gap 300 does', async () => {
    enqueue(ME, { elo: 1200, waitedSec: 200 });
    enqueue(OPP, { elo: 1501 });
    expect(await tryMatchForPlayer(ME)).toBeNull();
    expect(battleInserts()).toHaveLength(0);

    queueRows = [];
    inserts.length = 0;
    enqueue(ME, { elo: 1200, waitedSec: 200 });
    enqueue(OPP, { elo: 1500 });
    const result = await tryMatchForPlayer(ME);
    expect(result).not.toBeNull();
    const meta = JSON.parse(decisions()[0].meta);
    expect(meta.ratingRadius).toBe(300);
    expect(meta.ratingGap).toBe(300);
    // Power radius is fully open by then; Infinity is not JSON so it is reported as 'all'.
    expect(meta.powerRadius).toBe('all');
  });

  test('the band is symmetric (lower-rated opponents count too)', async () => {
    enqueue(ME, { elo: 1200 });
    enqueue(OPP, { elo: 1125 }); // exactly -75: inclusive
    const result = await tryMatchForPlayer(ME);
    expect(result).not.toBeNull();
    expect(JSON.parse(decisions()[0].meta).ratingGap).toBe(75);
  });

  test('band applies inside the Power radius, not instead of it', async () => {
    enqueue(ME, { elo: 1200 });
    enqueue(OPP, { elo: 1200, power: 5 }); // same rating, Power radius is exact at 0 s
    expect(await tryMatchForPlayer(ME)).toBeNull();
    expect(battleInserts()).toHaveLength(0);
  });

  test('never crosses a stake bracket, whatever the rating', async () => {
    enqueue(ME, { elo: 1200, waitedSec: 500 });
    enqueue(OPP, { elo: 1200, bracket: 1 });
    expect(await tryMatchForPlayer(ME)).toBeNull();
  });

  test('in-memory re-check rejects a candidate the SQL band let through', async () => {
    sqlRatingFilter = false;
    enqueue(ME, { elo: 1200 });
    enqueue(OPP, { elo: 1500 });
    expect(await tryMatchForPlayer(ME)).toBeNull();
    expect(battleInserts()).toHaveLength(0);
    expect(simulateCreateBattle).not.toHaveBeenCalled();
  });

  test('prefers the oldest opponent inside the band', async () => {
    enqueue(ME, { elo: 1200 });
    enqueue(THIRD, { elo: 1290, waitedSec: 100 }); // oldest, but out of band at the seeker's 0 s
    enqueue(OPP, { elo: 1240, waitedSec: 50 }); // oldest in band
    enqueue(FOURTH, { elo: 1210, waitedSec: 10 });

    const result = await tryMatchForPlayer(ME);
    expect(result).not.toBeNull();
    expect(result!.playerB).toBe(OPP);
  });
});
