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
// Partial on purpose: bun keeps the real export for every key not listed
// (computeTeamPower, getCurrentRadius, getCurrentRatingRadius stay real).
mock.module('@clawbada/game-logic', () => ({
  STAKE_BRACKETS: [2500n, 10000n, 50000n],
  ANTI_GRIEF_DEPOSIT_BPS: 500n,
  DAMAGE_THRESHOLD: 80,
  EvolutionTier: { 0: 'Base', 1: 'Evolved', 2: 'Elite', 3: 'Apex', Base: 0, Evolved: 1, Elite: 2, Apex: 3 },
  BattlePhase: { StakeDeposit: 0, TeamCommit: 1, TeamReveal: 2, RoundCommit: 3, RoundReveal: 4, Settled: 5 },
}));

// ── Mock @clawbada/db ──
// `result` may be a thunk so a test can swap the select result without
// rebuilding the shared chain object.
function mockDbChain(result: any[] | (() => any[]) = []) {
  const chain: any = {};
  const methods = ['select', 'from', 'where', 'orderBy', 'limit', 'offset', 'groupBy'];
  for (const m of methods) {
    chain[m] = mock(() => chain);
  }
  chain.then = (resolve: Function) => resolve(typeof result === 'function' ? result() : result);
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

let selectResult: any[] = [];
const selectChain = mockDbChain(() => selectResult);
const insertChain = mockInsertChain([{ id: 7n, enqueuedAt: new Date() }]);
const deleteChain = mockDeleteChain();

const mockEnsureTeamRating = mock<any>();
const mockCurrentBoostEpochId = mock<any>();

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
  battles: { battleId: 'battleId', playerA: 'playerA', playerB: 'playerB', createdAt: 'createdAt', phase: 'phase', teamA: 'teamA', teamB: 'teamB', stakeBracket: 'stakeBracket', stakeAmount: 'stakeAmount', winner: 'winner', settledAt: 'settledAt', powerA: 'powerA', powerB: 'powerB', status: 'status' },
  battleRounds: { battleId: 'battleId', round: 'round' },
  matchmakingQueue: { id: 'id', address: 'address', stakeBracket: 'stakeBracket', powerScore: 'powerScore', enqueuedAt: 'enqueuedAt', teamId: 'teamId', elo: 'elo' },
  agents: { address: 'address', elo: 'elo' },
  ensureTeamRating: mockEnsureTeamRating,
  currentBoostEpochId: mockCurrentBoostEpochId,
}));

// `sql` needs `.raw`/`.join`: queue/status builds an interval with sql.raw.
// Defining it here also stops another file's bare `sql` mock leaking in.
const sqlTag: any = (strings: TemplateStringsArray, ...values: any[]) => ({ _sql: strings.join('?'), values });
sqlTag.raw = (s: string) => ({ _raw: s });
sqlTag.join = (...args: any[]) => ({ _sql: 'joined', args });

mock.module('drizzle-orm', () => ({
  eq: (...args: any[]) => args,
  and: (...args: any[]) => args,
  desc: (col: any) => col,
  asc: (col: any) => col,
  or: (...args: any[]) => args,
  gte: (...args: any[]) => args,
  lte: (...args: any[]) => args,
  ne: (...args: any[]) => args,
  between: (...args: any[]) => args,
  count: () => 'count',
  sql: sqlTag,
}));

// ── Mock ../../lib/ws ──
const mockNotifyAddress = mock(() => {});
mock.module('../../lib/ws', () => ({
  battleWS: { broadcast: mock(() => {}), notifyAddress: mockNotifyAddress },
}));

// ── Mock ../../lib/matchmaker/match ──
// The real tryMatchForPlayer needs a transactional db; the queue route only
// needs to know whether an opponent was found.
const mockTryMatchForPlayer = mock<any>(async () => null);
mock.module('../../lib/matchmaker/match', () => ({
  computePowerForTeam: mock(async () => ({ ok: true, power: 3 })),
  tryMatchForPlayer: mockTryMatchForPlayer,
  logJoinDecision: mock(async () => {}),
  logCancelDecision: mock(async () => {}),
  logExpansionDecision: mock(async () => {}),
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
    mockEnsureTeamRating.mockReset();
    mockCurrentBoostEpochId.mockReset();
    mockTryMatchForPlayer.mockReset();
    mockNotifyAddress.mockReset();
    insertChain.values.mockClear();
    selectResult = [];
    mockVerifyMessage.mockImplementation(() => Promise.resolve(true));
    mockGetAddress.mockImplementation((addr: string) => addr);
    mockEnsureTeamRating.mockResolvedValue({ rating: 1200, power: 3, created: true, reset: false });
    mockCurrentBoostEpochId.mockResolvedValue(3);
    mockTryMatchForPlayer.mockResolvedValue(null);
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

    test('stores the TEAM rating in the queue row and surfaces requalified', async () => {
      mockReadTeam.mockResolvedValue(mockTeam({ active: false }));
      mockReadLobster.mockImplementation((id: bigint) =>
        Promise.resolve(mockLobster({ tokenId: id, evolutionTier: 1 })),
      );
      mockEnsureTeamRating.mockResolvedValue({ rating: 1337, power: 3, created: false, reset: true });

      const res = await app.request('/combat/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1', stakeAmount: '2500' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('queued');
      expect(body.rating).toBe(1337);
      expect(body.requalified).toBe(true);
      expect(body.initialRatingRadius).toBe(75);
      expect(body.queueId).toBe('7');

      // ensureTeamRating gets the roster + power + current window.
      expect(mockEnsureTeamRating).toHaveBeenCalledTimes(1);
      const [, roster] = mockEnsureTeamRating.mock.calls[0] as any[];
      expect(roster.teamId).toBe(1n);
      expect(roster.owner).toBe(TEST_ADDRESS.toLowerCase());
      expect(roster.lobsterIds).toEqual([1n, 2n, 3n]);
      expect(roster.power).toBe(3);
      expect(roster.epochId).toBe(3);

      // The queue insert carries the team rating in the `elo` column (not the wallet ELO).
      const inserted = insertChain.values.mock.calls.at(-1)![0] as any;
      expect(inserted.elo).toBe(1337);
      expect(inserted.powerScore).toBe(3);
      expect(inserted.teamId).toBe(1n);

      // WS queue_joined carries the same fields for the client reducer.
      expect(mockNotifyAddress).toHaveBeenCalledTimes(1);
      const [, event, payload] = mockNotifyAddress.mock.calls[0] as any[];
      expect(event).toBe('queue_joined');
      expect(payload.rating).toBe(1337);
      expect(payload.requalified).toBe(true);
      expect(payload.initialRatingRadius).toBe(75);
    });

    test('immediate match response includes rating and requalified', async () => {
      mockReadTeam.mockResolvedValue(mockTeam({ active: false }));
      mockReadLobster.mockImplementation((id: bigint) =>
        Promise.resolve(mockLobster({ tokenId: id, evolutionTier: 1 })),
      );
      mockTryMatchForPlayer.mockResolvedValue({
        battleId: 42n,
        playerA: TEST_ADDRESS.toLowerCase(),
        playerB: OTHER_ADDRESS,
        stakeBracket: 0,
        powerA: 3,
        powerB: 3,
      });

      const res = await app.request('/combat/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1', stakeAmount: '2500' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('matched');
      expect(body.battleId).toBe('42');
      expect(body.opponent).toBe(OTHER_ADDRESS);
      expect(body.rating).toBe(1200);
      expect(body.requalified).toBe(false);
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

    test('returns rating and the current rating radius when queued', async () => {
      selectResult = [
        {
          id: 9n,
          address: TEST_ADDRESS.toLowerCase(),
          teamId: 1n,
          stakeBracket: 0,
          powerScore: 3,
          elo: 1250,
          enqueuedAt: new Date(Date.now() - 45_000), // 45 s in: power +/-1, rating +/-150
        },
      ];
      const res = await app.request('/combat/queue/status', {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.inQueue).toBe(true);
      expect(body.rating).toBe(1250);
      expect(body.elo).toBe(1250);
      expect(body.ratingRadius).toBe(150);
      expect(body.radius).toEqual({ low: 3, high: 4, halfWidth: 1 });
      expect(body.queueId).toBe('9');
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
