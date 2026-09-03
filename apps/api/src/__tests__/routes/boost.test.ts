import { describe, test, expect, mock, beforeEach } from 'bun:test';

/**
 * Battle-rank mining boost reads. The db mock hands each SELECT the next queued
 * result for the table it reads FROM, so a handler that issues several queries
 * (rating row, floor row, played count, live epoch, boost rows) gets each one in
 * order. game-logic is real: rankQualified / floorPlayedForEpoch are the oracle.
 */

// ── Tables (column names double as the values the passthrough predicates receive) ──
const teams = { _name: 'teams', teamId: 'teamId', disbandedAt: 'disbandedAt' };
const teamRatings = {
  _name: 'team_ratings',
  teamId: 'teamId', owner: 'owner', rating: 'rating', power: 'power', epochId: 'epochId',
  gamesPlayedEpoch: 'gamesPlayedEpoch', gamesPlayedTotal: 'gamesPlayedTotal', wins: 'wins', losses: 'losses',
  lineageParentId: 'lineageParentId', lineageShared: 'lineageShared', lineageReason: 'lineageReason', lastBattleAt: 'lastBattleAt',
};
const battleParticipation = { _name: 'battle_participation', battleId: 'battleId', teamId: 'teamId', epochId: 'epochId' };
const boostEpochs = { _name: 'boost_epochs', epochId: 'epochId', chainEpoch: 'chainEpoch', status: 'status' };
const teamBoosts = { _name: 'team_boosts', epochId: 'epochId', teamId: 'teamId', rank: 'rank' };

// ── Per-table FIFO of SELECT results ──
const results = new Map<string, any[][]>();
function queue(table: { _name: string }, rows: any[]): void {
  const q = results.get(table._name) ?? [];
  q.push(rows);
  results.set(table._name, q);
}

function selectChain() {
  let table = '';
  const chain: any = {};
  for (const m of ['from', 'where', 'orderBy', 'limit', 'offset', 'groupBy', 'having', 'innerJoin', 'leftJoin']) {
    chain[m] = (...args: any[]) => {
      if (m === 'from') table = args[0]._name;
      return chain;
    };
  }
  chain.then = (resolve: Function, reject?: Function) => {
    const q = results.get(table);
    const rows = q && q.length > 0 ? q.shift()! : [];
    return Promise.resolve(rows).then(resolve as any, reject as any);
  };
  return chain;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Anchor so that window 5 is [now - 3d, now + 4d). */
const anchorMs = Date.now() - 5 * WEEK_MS - 3 * DAY_MS;
let currentEpoch = 5;

const mockCurrentBoostEpochId = mock(async () => currentEpoch);
const mockBoostEpochWindow = mock(async (_db: unknown, epochId: number) => ({
  startsAt: new Date(anchorMs + epochId * WEEK_MS),
  endsAt: new Date(anchorMs + (epochId + 1) * WEEK_MS),
}));

mock.module('@clawbada/db', () => ({
  db: { select: () => selectChain() },
  teams,
  teamRatings,
  battleParticipation,
  boostEpochs,
  teamBoosts,
  currentBoostEpochId: mockCurrentBoostEpochId,
  boostEpochWindow: mockBoostEpochWindow,
}));

const sqlTag: any = (strings: TemplateStringsArray, ...values: any[]) => {
  const r: any = { _sql: strings.join('?'), values };
  r.as = () => r;
  return r;
};
sqlTag.raw = (s: string) => ({ _raw: s });
sqlTag.join = (...args: any[]) => ({ _sql: 'joined', args });

mock.module('drizzle-orm', () => ({
  and: (...args: any[]) => args,
  or: (...args: any[]) => args,
  asc: (col: any) => col,
  desc: (col: any) => col,
  count: () => 'count',
  eq: (...args: any[]) => args,
  ne: (...args: any[]) => args,
  gte: (...args: any[]) => args,
  lte: (...args: any[]) => args,
  between: (...args: any[]) => args,
  inArray: (...args: any[]) => args,
  isNull: (col: any) => col,
  sql: sqlTag,
}));

// ── Local serializeBigInts ──
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

mock.module('../../lib/chain', () => ({
  serializeBigInts: _serializeBigInts,
}));

// ── Import AFTER mocking ──
import { boostRoutes } from '../../routes/game/boost';
import { createTestApp } from '../helpers/route-test-utils';

const app = createTestApp(boostRoutes, '/boost');

function epochRow(overrides: Record<string, any> = {}) {
  const epochId = overrides.epochId ?? 5;
  return {
    epochId,
    chainEpoch: epochId + 1,
    startsAt: new Date(anchorMs + epochId * WEEK_MS),
    endsAt: new Date(anchorMs + (epochId + 1) * WEEK_MS),
    floorPlayed: 14,
    status: 'announced',
    ratedCount: null,
    qualifiedCount: null,
    lapsedCount: null,
    avgBoostBps: null,
    activatedAt: null,
    activateTxHash: null,
    ...overrides,
  };
}

function boostRow(overrides: Record<string, any> = {}) {
  return {
    epochId: 2,
    teamId: 11n,
    earnedEpochId: 1,
    rating: 1250,
    rank: 3,
    percentile: '0.500000',
    boostBps: 3000,
    power: 4,
    gamesPlayed: 7,
    batchIndex: 0,
    txHash: '0x1',
    ...overrides,
  };
}

describe('boost routes', () => {
  beforeEach(() => {
    results.clear();
    currentEpoch = 5;
  });

  // ──────────── GET /boost/epoch ────────────

  describe('GET /boost/epoch', () => {
    test('computes current + next windows from the anchor when nothing is announced', async () => {
      const res = await app.request('/boost/epoch');
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.current).toMatchObject({ epochId: 5, chainEpoch: 6, floorPlayed: 14, announced: false, status: null });
      expect(body.current.startsAt).toBe(new Date(anchorMs + 5 * WEEK_MS).toISOString());
      expect(body.current.endsAt).toBe(new Date(anchorMs + 6 * WEEK_MS).toISOString());
      // ~4 days left, allow the test's own wall-clock drift.
      expect(body.current.secondsRemaining).toBeGreaterThan(4 * 86400 - 10);
      expect(body.current.secondsRemaining).toBeLessThanOrEqual(4 * 86400);
      expect(body.next).toMatchObject({ epochId: 6, chainEpoch: 7, floorPlayed: 14, announced: false });
      expect(body.live).toBeNull();
      expect(body.schedule).toEqual({ minBps: 1000, maxBps: 5000 });
      expect(body.radius).toEqual({ rating: [[0, 75], [30, 150], [60, 225], [120, 300]], cap: 300 });
    });

    test('floor ramps 7 -> 14 at window 4 when computed from the schedule', async () => {
      currentEpoch = 3;
      const res = await app.request('/boost/epoch');
      const body = await res.json();
      expect(body.current.floorPlayed).toBe(7);
      expect(body.next.floorPlayed).toBe(14);
    });

    test('uses the announced rows (ops floor override) and reports the live activated epoch', async () => {
      queue(boostEpochs, [
        epochRow({ epochId: 5, floorPlayed: 9, status: 'active' }),
        epochRow({ epochId: 6, floorPlayed: 14, status: 'announced' }),
      ]);
      queue(boostEpochs, [
        epochRow({
          epochId: 4,
          status: 'activated',
          qualifiedCount: 12,
          ratedCount: 40,
          lapsedCount: 3,
          avgBoostBps: 2800,
          activatedAt: new Date('2026-09-01T00:00:00.000Z'),
          activateTxHash: '0xabc',
        }),
      ]);

      const res = await app.request('/boost/epoch');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.current).toMatchObject({ epochId: 5, floorPlayed: 9, announced: true, status: 'active' });
      expect(body.next).toMatchObject({ epochId: 6, floorPlayed: 14, announced: true, status: 'announced' });
      expect(body.live).toEqual({
        chainEpoch: 5,
        earnedEpochId: 4,
        qualifiedCount: 12,
        ratedCount: 40,
        lapsedCount: 3,
        avgBoostBps: 2800,
        activatedAt: '2026-09-01T00:00:00.000Z',
        activateTxHash: '0xabc',
      });
    });
  });

  // ──────────── GET /boost/team/:teamId ────────────

  describe('GET /boost/team/:teamId', () => {
    test('returns 400 on a non-numeric team id', async () => {
      const res = await app.request('/boost/team/abc');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('INVALID_INPUT');
    });

    test('returns 404 when the team has no rating row', async () => {
      const res = await app.request('/boost/team/99');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('NOT_FOUND');
    });

    test('reports played vs floor, previous boost, lapse and lineage', async () => {
      currentEpoch = 2; // floor 7
      const lastBattleAt = new Date('2026-09-02T10:00:00.000Z');
      queue(teamRatings, [
        {
          teamId: 11n, owner: '0xowner', rating: 1290, power: 4, epochId: 2, gamesPlayedEpoch: 8,
          gamesPlayedTotal: 20, wins: 12, losses: 8, lineageParentId: 7n, lineageShared: 2,
          lineageReason: 'inherited', lastBattleAt,
        },
      ]);
      queue(boostEpochs, []); // no announced row -> schedule floor
      queue(battleParticipation, [{ value: 9 }]); // ledger says 9 (cache says 8)
      queue(boostEpochs, [epochRow({ epochId: 1, status: 'activated' })]); // live chain epoch 2
      queue(teamBoosts, [boostRow({ epochId: 1, teamId: 11n })]); // only the PREVIOUS epoch has a row

      const res = await app.request('/boost/team/11');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        teamId: '11',
        owner: '0xowner',
        rating: 1290,
        power: 4,
        epochId: 2,
        chainEpoch: 2,
        gamesPlayedEpoch: 9,
        cachedGamesPlayedEpoch: 8,
        cachedEpochId: 2,
        floorPlayed: 7,
        onTrack: true,
        wins: 12,
        losses: 8,
        gamesPlayedTotal: 20,
        lastBattleAt: lastBattleAt.toISOString(),
        live: null,
        lapsed: true,
        lineage: { parentTeamId: '7', shared: 2, reason: 'inherited' },
      });
      expect(body.previous).toMatchObject({ epochId: 1, teamId: '11', rank: 3, percentile: 0.5, boostBps: 3000, txHash: '0x1' });
    });

    test('live boost present -> not lapsed; below floor -> not on track', async () => {
      currentEpoch = 5; // floor 14
      queue(teamRatings, [
        {
          teamId: 11n, owner: '0xowner', rating: 1200, power: 3, epochId: 5, gamesPlayedEpoch: 3,
          gamesPlayedTotal: 3, wins: 1, losses: 2, lineageParentId: null, lineageShared: null,
          lineageReason: 'fresh', lastBattleAt: null,
        },
      ]);
      queue(boostEpochs, []);
      queue(battleParticipation, [{ value: 3 }]);
      queue(boostEpochs, [epochRow({ epochId: 4, status: 'activated' })]); // live chain epoch 5
      queue(teamBoosts, [boostRow({ epochId: 5, teamId: 11n, rank: 1, percentile: '1.000000', boostBps: 5000 })]);

      const res = await app.request('/boost/team/11');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.onTrack).toBe(false);
      expect(body.floorPlayed).toBe(14);
      expect(body.live).toMatchObject({ epochId: 5, boostBps: 5000, percentile: 1 });
      expect(body.previous).toBeNull();
      expect(body.lapsed).toBe(false);
      expect(body.lineage).toEqual({ parentTeamId: null, shared: null, reason: 'fresh' });
    });

    test('before the first activation there is no live or previous boost', async () => {
      queue(teamRatings, [
        {
          teamId: 11n, owner: '0xowner', rating: 1200, power: 3, epochId: 5, gamesPlayedEpoch: 0,
          gamesPlayedTotal: 0, wins: 0, losses: 0, lineageParentId: null, lineageShared: null,
          lineageReason: 'fresh', lastBattleAt: null,
        },
      ]);
      const res = await app.request('/boost/team/11');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.chainEpoch).toBe(0);
      expect(body.live).toBeNull();
      expect(body.previous).toBeNull();
      expect(body.lapsed).toBe(false);
      expect(body.gamesPlayedEpoch).toBe(0);
    });
  });

  // ──────────── GET /boost/leaderboard ────────────

  describe('GET /boost/leaderboard', () => {
    test('defaults to the live chain epoch and pages team_boosts by rank', async () => {
      queue(boostEpochs, [epochRow({ epochId: 2, status: 'activated' })]); // chain epoch 3
      queue(teamBoosts, [
        boostRow({ epochId: 3, teamId: 5n, rank: 1, percentile: '1.000000', boostBps: 5000 }),
        boostRow({ epochId: 3, teamId: 6n, rank: 2, percentile: '0.000000', boostBps: 1000 }),
      ]);
      queue(teamBoosts, [{ value: 2 }]);

      const res = await app.request('/boost/leaderboard');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ epoch: 3, count: 2, total: 2, limit: 100, offset: 0 });
      expect(body.rows[0]).toMatchObject({ teamId: '5', rank: 1, percentile: 1, boostBps: 5000 });
      expect(body.rows[1]).toMatchObject({ teamId: '6', rank: 2, percentile: 0, boostBps: 1000 });
    });

    test('reports chain epoch 0 with no rows before the first activation', async () => {
      const res = await app.request('/boost/leaderboard');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ epoch: 0, count: 0, total: 0, rows: [] });
    });

    test('validates the epoch param and clamps paging', async () => {
      const bad = await app.request('/boost/leaderboard?epoch=abc');
      expect(bad.status).toBe(400);

      const res = await app.request('/boost/leaderboard?epoch=2&limit=9999&offset=-4');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ epoch: 2, limit: 500, offset: 0 });
    });
  });

  // ──────────── GET /boost/ladder ────────────

  describe('GET /boost/ladder', () => {
    test('ranks live teams at or over the floor, sharing rank (and boost) on ties', async () => {
      currentEpoch = 2; // floor 7
      queue(boostEpochs, []);
      queue(teamRatings, [
        { teamId: 1n, owner: '0xa', rating: 1300, power: 3, played: 9 },
        { teamId: 2n, owner: '0xb', rating: 1250, power: 5, played: 7 },
        { teamId: 3n, owner: '0xc', rating: 1250, power: 4, played: 12 },
      ]);

      const res = await app.request('/boost/ladder');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ epochId: 2, chainEpoch: 3, floorPlayed: 7, qualifiedCount: 3 });
      expect(body.rows[0]).toMatchObject({ teamId: '1', owner: '0xa', rating: 1300, power: 3, gamesPlayed: 9, rank: 1, percentile: 1, boostBps: 5000 });
      expect(body.rows[1]).toMatchObject({ rating: 1250, rank: 2, percentile: 0.5, boostBps: 3000 });
      expect(body.rows[2]).toMatchObject({ rating: 1250, rank: 2, percentile: 0.5, boostBps: 3000 });
      expect(new Set([body.rows[1].teamId, body.rows[2].teamId])).toEqual(new Set(['2', '3']));
    });

    test('announced floor overrides the schedule; empty ladder is an empty list', async () => {
      queue(boostEpochs, [epochRow({ epochId: 5, floorPlayed: 3 })]);
      const res = await app.request('/boost/ladder');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ epochId: 5, chainEpoch: 6, floorPlayed: 3, qualifiedCount: 0, rows: [] });
    });
  });
});
