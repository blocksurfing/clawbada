import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Mock @clawbada/chain ──
const mockVerifyMessage = mock(() => Promise.resolve(true));
const mockGetAddress = mock((addr: string) => addr);

mock.module('@clawbada/chain', () => ({
  verifyMessage: mockVerifyMessage,
  getAddress: mockGetAddress,
  base: { id: 8453 },
  baseSepolia: { id: 84532 },
}));

// ── Mock @clawbada/game-logic ──
mock.module('@clawbada/game-logic', () => ({
  decodeDNA: mock(() => ({ class: 0, legend: 0, breedType: 0, bodyParts: [] })),
  getBaseStats: mock(() => ({ hp: 700, attack: 70, armor: 120, speed: 80, critical: 90 })),
  scaleStats: mock((stats: any) => stats),
  EvolutionTier: { 0: 'Base', 1: 'Evolved', 2: 'Elite', 3: 'Apex', Base: 0, Evolved: 1, Elite: 2, Apex: 3 },
  LegendStatus: { Normal: 0, Legend: 1, 0: 'Normal', 1: 'Legend' },
  CLASS_NAMES: ['Bulwark', 'Mantis', 'Leviathan', 'Tempest', 'Specter', 'Sentinel', 'Reaver', 'Abyss', 'Kraken', 'Ember'],
  CLASS_ROLES: ['Tank', 'Assassin', 'Bruiser', 'Nuker', 'Debuffer', 'Support', 'DPS', 'Lifesteal', 'Controller', 'Glass Cannon'],
}));

// ── Mock @clawbada/db ──
const mockDbSelect = mock<any>();
const mockDbInsert = mock<any>();

function mockDbChain(result: any[] = []) {
  const chain: any = {};
  const methods = ['select', 'from', 'where', 'limit', 'orderBy'];
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

const selectChain = mockDbChain([]);
const insertChain = mockInsertChain([]);

mock.module('@clawbada/db', () => ({
  db: {
    select: () => selectChain,
    insert: () => insertChain,
  },
  agents: {
    address: 'address',
    elo: 'elo',
    wins: 'wins',
    losses: 'losses',
    totalBattles: 'totalBattles',
  },
}));

mock.module('drizzle-orm', () => ({
  eq: (...args: any[]) => args,
}));

// ── Mock ../../lib/chain ──
const mockReadLobstersByOwner = mock<any>();

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
  readLobstersByOwner: mockReadLobstersByOwner,
  serializeBigInts: _serializeBigInts,
}));

// ── Import AFTER mocking ──
import { agentRoutes } from '../../routes/agent/index';
import {
  TEST_ADDRESS,
  authHeaders,
  mockLobster,
  createTestApp,
} from '../helpers/route-test-utils';

const app = createTestApp(agentRoutes, '/agent');

describe('agent routes', () => {
  beforeEach(() => {
    mockReadLobstersByOwner.mockReset();
    mockVerifyMessage.mockImplementation(() => Promise.resolve(true));
    mockGetAddress.mockImplementation((addr: string) => addr);
  });

  // ──────────── POST /agent/register ────────────

  describe('POST /agent/register', () => {
    test('returns registered true for new agent', async () => {
      const res = await app.request('/agent/register', {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.registered).toBe(true);
    });

    test('returns 401 without auth headers', async () => {
      const res = await app.request('/agent/register', {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });
  });

  // ──────────── GET /agent/profile/:address ────────────

  describe('GET /agent/profile/:address', () => {
    test('returns default profile for unregistered agent', async () => {
      const res = await app.request(`/agent/profile/${TEST_ADDRESS}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.registered).toBe(false);
      expect(body.elo).toBe(1200);
      expect(body.wins).toBe(0);
    });
  });

  // ──────────── GET /agent/lobsters/:address ────────────

  describe('GET /agent/lobsters/:address', () => {
    test('returns enriched lobster list', async () => {
      mockReadLobstersByOwner.mockResolvedValue([
        mockLobster({ tokenId: 1n }),
        mockLobster({ tokenId: 2n }),
      ]);

      const res = await app.request(`/agent/lobsters/${TEST_ADDRESS}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.count).toBe(2);
      expect(body.lobsters).toHaveLength(2);
      expect(body.lobsters[0]).toHaveProperty('className');
      expect(body.lobsters[0]).toHaveProperty('stats');
    });

    test('returns empty array for address with no lobsters', async () => {
      mockReadLobstersByOwner.mockResolvedValue([]);

      const res = await app.request(`/agent/lobsters/${TEST_ADDRESS}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.count).toBe(0);
      expect(body.lobsters).toHaveLength(0);
    });
  });
});
