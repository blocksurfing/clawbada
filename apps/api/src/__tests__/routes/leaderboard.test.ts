import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Mock @clawbada/db ──
function mockDbChain(result: any[] = []) {
  const chain: any = {};
  const methods = ['select', 'from', 'where', 'groupBy', 'orderBy', 'limit'];
  for (const m of methods) {
    chain[m] = mock(() => chain);
  }
  chain.then = (resolve: Function) => resolve(result);
  return chain;
}

const dbChainResult: any[] = [];
const mockDb = mockDbChain(dbChainResult);

mock.module('@clawbada/db', () => ({
  db: {
    select: () => mockDb,
  },
  agents: { address: 'address', elo: 'elo', wins: 'wins', losses: 'losses', totalBattles: 'totalBattles' },
  expeditions: { owner: 'owner', reward: 'reward', season: 'season' },
  breeds: { parentA: 'parentA', cost: 'cost' },
}));

// sql tagged template mock that returns chainable object with .as()
function sqlTag(strings: TemplateStringsArray, ...values: any[]): any {
  const result: any = { _sql: strings.join('') };
  result.as = (name: string) => result;
  result.join = (...args: any[]) => result;
  return result;
}
sqlTag.join = (...args: any[]) => ({ _sql: 'joined' });

mock.module('drizzle-orm', () => ({
  desc: (col: any) => col,
  sql: sqlTag,
  eq: (...args: any[]) => args,
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

// ── Mock ../../lib/chain (only serializeBigInts) ──
mock.module('../../lib/chain', () => ({
  serializeBigInts: _serializeBigInts,
}));

// ── Import AFTER mocking ──
import { leaderboardRoutes } from '../../routes/leaderboard';
import { createTestApp } from '../helpers/route-test-utils';

const app = createTestApp(leaderboardRoutes, '/leaderboard');

describe('leaderboard routes', () => {
  // ──────────── GET /leaderboard/battle ────────────

  describe('GET /leaderboard/battle', () => {
    test('returns battle leaderboard', async () => {
      const res = await app.request('/leaderboard/battle');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('sort');
      expect(body).toHaveProperty('count');
      expect(body).toHaveProperty('leaderboard');
    });

    test('accepts sort=wins parameter', async () => {
      const res = await app.request('/leaderboard/battle?sort=wins');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sort).toBe('wins');
    });
  });

  // ──────────── GET /leaderboard/mining ────────────

  describe('GET /leaderboard/mining', () => {
    test('returns mining leaderboard', async () => {
      const res = await app.request('/leaderboard/mining');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('season');
      expect(body).toHaveProperty('count');
      expect(body).toHaveProperty('leaderboard');
    });
  });

  // ──────────── GET /leaderboard/breeding ────────────

  describe('GET /leaderboard/breeding', () => {
    test('returns breeding leaderboard', async () => {
      const res = await app.request('/leaderboard/breeding');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('count');
      expect(body).toHaveProperty('leaderboard');
    });
  });
});
