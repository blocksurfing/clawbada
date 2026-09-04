import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Mock @clawbada/chain ──
const mockVerifyMessage = mock(() => Promise.resolve(true));
const mockGetAddress = mock((addr: string) => addr);
const mockEncodeFunctionData = mock(() => '0xabcdef');

mock.module('@clawbada/chain', () => ({
  verifyMessage: mockVerifyMessage,
  getAddress: mockGetAddress,
  encodeFunctionData: mockEncodeFunctionData,
  BattleArenaAbi: [],
  ClawTokenAbi: [],
  addresses: { battleArena: '0xBATTLE', clawToken: '0xCLAW' },
  base: { id: 8453 },
  baseSepolia: { id: 84532 },
  getPublicClient: mock(() => ({})),
  getBattleArena: mock(() => ({})),
}));

// ── Mock @clawbada/game-logic ──
mock.module('@clawbada/game-logic', () => ({
  STAKE_BRACKETS: [2500n, 10000n, 50000n],
  ANTI_GRIEF_DEPOSIT_BPS: 500n,
  DAMAGE_THRESHOLD: 80,
  EvolutionTier: { 0: 'Base', 1: 'Evolved', 2: 'Elite', 3: 'Apex', Base: 0, Evolved: 1, Elite: 2, Apex: 3 },
  BattlePhase: { StakeDeposit: 0, TeamCommit: 1, TeamReveal: 2, RoundCommit: 3, RoundReveal: 4, Settled: 5 },
}));

// ── Mock @clawbada/db ──
function mockDbChain(result: any[] = []) {
  const chain: any = {};
  const methods = ['select', 'from', 'where', 'orderBy', 'limit', 'groupBy'];
  for (const m of methods) {
    chain[m] = mock(() => chain);
  }
  chain.then = (resolve: Function) => resolve(result);
  return chain;
}

function mockInsertChain(result: any[] = []) {
  const chain: any = {};
  chain.values = mock(() => chain);
  chain.returning = mock(() => chain);
  chain.then = (resolve: Function) => resolve(result);
  return chain;
}

function mockDeleteChain() {
  const chain: any = {};
  chain.where = mock(() => chain);
  chain.then = (resolve: Function) => resolve([]);
  return chain;
}

const selectChain = mockDbChain([]);
const insertChain = mockInsertChain([]);
const deleteChain = mockDeleteChain();

mock.module('@clawbada/db', () => ({
  db: {
    select: () => selectChain,
    insert: () => insertChain,
    delete: () => deleteChain,
    transaction: mock(async (fn: Function) => fn({
      delete: () => deleteChain,
      insert: () => insertChain,
    })),
  },
  battles: { battleId: 'battleId', playerA: 'playerA', playerB: 'playerB', createdAt: 'createdAt', phase: 'phase', teamA: 'teamA', teamB: 'teamB', stakeBracket: 'stakeBracket', stakeAmount: 'stakeAmount' },
  battleRounds: { battleId: 'battleId', round: 'round' },
  matchmakingQueue: { address: 'address', stakeBracket: 'stakeBracket', enqueuedAt: 'enqueuedAt', teamId: 'teamId', elo: 'elo' },
  agents: { address: 'address', elo: 'elo' },
}));

mock.module('drizzle-orm', () => ({
  eq: (...args: any[]) => args,
  and: (...args: any[]) => args,
  desc: (col: any) => col,
  or: (...args: any[]) => args,
}));

// ── Mock ../../lib/ws ──
mock.module('../../lib/ws', () => ({
  battleWS: { broadcast: mock(() => {}) },
}));

// ── Mock ../../lib/chain ──
const mockReadTeam = mock<any>();
const mockReadLobster = mock<any>();
const mockReadBattle = mock<any>();

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
  readTeam: mockReadTeam,
  readLobster: mockReadLobster,
  readBattle: mockReadBattle,
  serializeBigInts: _serializeBigInts,
}));

// ── Import AFTER mocking ──
import { combatRoutes } from '../../routes/game/combat/index';
import {
  TEST_ADDRESS,
  OTHER_ADDRESS,
  authHeaders,
  mockLobster,
  mockTeam,
  mockBattle,
  createTestApp,
} from '../helpers/route-test-utils';

const app = createTestApp(combatRoutes, '/combat');

describe('combat routes', () => {
  beforeEach(() => {
    mockReadTeam.mockReset();
    mockReadLobster.mockReset();
    mockReadBattle.mockReset();
    mockVerifyMessage.mockImplementation(() => Promise.resolve(true));
    mockGetAddress.mockImplementation((addr: string) => addr);
  });

  // ──────────── POST /combat/queue ────────────

  describe('POST /combat/queue', () => {
    test('returns 400 when teamId missing', async () => {
      const res = await app.request('/combat/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ stakeAmount: '2500' }),
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 for invalid stake bracket', async () => {
      mockReadTeam.mockResolvedValue(mockTeam());
      mockReadLobster.mockImplementation((id: bigint) =>
        Promise.resolve(mockLobster({ tokenId: id, evolutionTier: 1 })),
      );

      const res = await app.request('/combat/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1', stakeAmount: '999' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('stakeAmount');
    });

    test('returns 400 when not team owner', async () => {
      mockReadTeam.mockResolvedValue(mockTeam({ owner: OTHER_ADDRESS }));

      const res = await app.request('/combat/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1', stakeAmount: '2500' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('Not the team owner');
    });

    test('returns 401 without auth', async () => {
      const res = await app.request('/combat/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: '1', stakeAmount: '2500' }),
      });
      expect(res.status).toBe(401);
    });
  });

  // ──────────── GET /combat/queue/status ────────────

  describe('GET /combat/queue/status', () => {
    test('returns inQueue false when not queued', async () => {
      const res = await app.request('/combat/queue/status', {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.inQueue).toBe(false);
    });
  });

  // ──────────── DELETE /combat/queue ────────────

  describe('DELETE /combat/queue', () => {
    test('returns removed true', async () => {
      const res = await app.request('/combat/queue', {
        method: 'DELETE',
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.removed).toBe(true);
    });
  });

  // ──────────── GET /combat/history ────────────

  describe('GET /combat/history', () => {
    test('returns 400 when address missing', async () => {
      const res = await app.request('/combat/history');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('INVALID_INPUT');
    });

    test('returns battle history for address', async () => {
      const res = await app.request(`/combat/history?address=${TEST_ADDRESS}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('count');
      expect(body).toHaveProperty('battles');
    });
  });

  // ──────────── POST /combat/:battleId/deposit ────────────

  describe('POST /combat/:battleId/deposit', () => {
    test('returns approve+deposit calldata', async () => {
      mockReadBattle.mockResolvedValue(mockBattle());

      const res = await app.request('/combat/1/deposit', {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.steps).toHaveLength(2);
      expect(body.steps[0].description).toContain('Approve');
      expect(body.preview).toHaveProperty('totalDeposit');
    });
  });

  // ──────────── POST /combat/:battleId/commit-team ────────────

  describe('POST /combat/:battleId/commit-team', () => {
    test('returns commit calldata', async () => {
      const res = await app.request('/combat/1/commit-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ commitHash: '0xabc123' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.steps).toHaveLength(1);
      expect(body.steps[0].description).toContain('Commit');
    });

    test('returns 400 when commitHash missing', async () => {
      const res = await app.request('/combat/1/commit-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  // ──────────── POST /combat/:battleId/reveal-team ────────────

  describe('POST /combat/:battleId/reveal-team', () => {
    test('returns reveal calldata', async () => {
      const res = await app.request('/combat/1/reveal-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1', salt: '0xsalt' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.steps).toHaveLength(1);
      expect(body.steps[0].description).toContain('Reveal');
    });

    test('returns 400 when salt missing', async () => {
      const res = await app.request('/combat/1/reveal-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1' }),
      });
      expect(res.status).toBe(400);
    });
  });
});
