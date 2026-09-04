import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Mock @clawbada/db ──
function mockDbChain(result: any[] = []) {
  const chain: any = {};
  const methods = ['select', 'from', 'where', 'orderBy', 'limit'];
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
  onChainEvents: {
    id: 'id',
    eventName: 'eventName',
    contractName: 'contractName',
    txHash: 'txHash',
    blockNumber: 'blockNumber',
    createdAt: 'createdAt',
    args: 'args',
  },
}));

mock.module('drizzle-orm', () => ({
  desc: (col: any) => col,
  lt: (...args: any[]) => args,
  inArray: (...args: any[]) => args,
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: any[]) => strings.join(''),
    { join: (...args: any[]) => '' },
  ),
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
import { activityRoutes } from '../../routes/activity';
import { createTestApp } from '../helpers/route-test-utils';

const app = createTestApp(activityRoutes, '/activity');

describe('activity routes', () => {
  // ──────────── GET /activity/recent ────────────

  describe('GET /activity/recent', () => {
    test('returns events array and nextCursor', async () => {
      const res = await app.request('/activity/recent');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('events');
      expect(body).toHaveProperty('nextCursor');
      expect(Array.isArray(body.events)).toBe(true);
    });

    test('accepts limit parameter', async () => {
      const res = await app.request('/activity/recent?limit=10');
      expect(res.status).toBe(200);
    });

    test('accepts cursor parameter', async () => {
      const res = await app.request('/activity/recent?cursor=100');
      expect(res.status).toBe(200);
    });

    test('accepts type filter parameter', async () => {
      const res = await app.request('/activity/recent?type=battle_settled');
      expect(res.status).toBe(200);
    });
  });
});
