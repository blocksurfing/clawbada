import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Mock @clawbada/chain ──
const mockVerifyMessage = mock(() => Promise.resolve(true));
const mockGetAddress = mock((addr: string) => addr);
const mockEncodeFunctionData = mock(() => '0xabcdef');
// F5-01: the reveal route verifies (battleId, player, teamId, salt) against the on-chain
// commit through this helper; the tests pin it so the fixture can carry a matching commit.
const mockTeamCommitHash = mock((..._args: unknown[]) => '0xcommit');

mock.module('@clawbada/chain', () => ({
  verifyMessage: mockVerifyMessage,
  getAddress: mockGetAddress,
  encodeFunctionData: mockEncodeFunctionData,
  teamCommitHash: mockTeamCommitHash,
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
  LAUNCH_STAKES: [2500n, 10000n, 50000n],
  STAKE_BRACKET_LABELS: ['Low', 'Mid', 'High'],
  NUM_STAKE_BRACKETS: 3,
  ANTI_GRIEF_DEPOSIT_BPS: 500n,
  DAMAGE_THRESHOLD: 80,
  EvolutionTier: { 0: 'Base', 1: 'Evolved', 2: 'Elite', 3: 'Apex', Base: 0, Evolved: 1, Elite: 2, Apex: 3 },
  // The REAL contract enum (packages/game-logic/src/types.ts). This mock used to carry the V2
  // numbers (TeamReveal: 2, Settled: 5), so route tests passed against phases that do not exist.
  BattlePhase: { None: 0, Deposit: 1, StakeDeposit: 1, TeamCommit: 2, TeamReveal: 3, Active: 4, AwaitingFinalize: 5, Settled: 6, Cancelled: 7, Frozen: 8 },
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
// F5-01 reveal: db.update(battles).set(...).where(...) + db.query.battles.findFirst(...)
const mockUpdateWhere = mock(async () => []);
const mockUpdateSet = mock((_values: Record<string, unknown>) => ({ where: mockUpdateWhere }));
const updateChain = { set: mockUpdateSet };
const mockFindFirst = mock<any>();

const mockSessionFindFirst = mock<any>();

mock.module('@clawbada/db', () => ({
  db: {
    select: () => selectChain,
    insert: () => insertChain,
    update: () => updateChain,
    delete: () => deleteChain,
    query: { battles: { findFirst: mockFindFirst }, battleSessions: { findFirst: mockSessionFindFirst } },
    transaction: mock(async (fn: Function) => fn({
      delete: () => deleteChain,
      insert: () => insertChain,
    })),
  },
  battles: { battleId: 'battleId', playerA: 'playerA', playerB: 'playerB', createdAt: 'createdAt', phase: 'phase', teamA: 'teamA', teamB: 'teamB', stakeBracket: 'stakeBracket', stakeAmount: 'stakeAmount', winner: 'winner', settledAt: 'settledAt', powerA: 'powerA', powerB: 'powerB', status: 'status', revealSaltA: 'revealSaltA', revealSaltB: 'revealSaltB' },
  battleRounds: { battleId: 'battleId', round: 'round' },
  battleSessions: { id: 'id' },
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
const mockReadStakeQuote = mock<any>();

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

const mockReadChainTime = mock<any>();
mock.module('../../lib/chain', () => ({
  readTeam: mockReadTeam,
  readLobster: mockReadLobster,
  readBattle: mockReadBattle,
  readStakeQuote: mockReadStakeQuote,
  readChainTime: mockReadChainTime,
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
    mockUpdateSet.mockClear();
    mockUpdateWhere.mockClear();
    mockFindFirst.mockReset();
    mockTeamCommitHash.mockReset();
    mockTeamCommitHash.mockImplementation(() => '0xcommit');
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
        body: JSON.stringify({ bracket: 0 }),
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
        body: JSON.stringify({ teamId: '1', bracket: 9 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('bracket must be');
    });

    test('D-E: the old stakeAmount body is refused with a pointer to the quote endpoint', async () => {
      mockReadTeam.mockResolvedValue(mockTeam());
      const res = await app.request('/combat/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1', stakeAmount: '2500' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('send bracket');
      expect(body.message).toContain('/api/game/combat/stakes');
    });

    test('D-E: a decimal-string bracket is accepted', async () => {
      mockReadTeam.mockResolvedValue(mockTeam({ active: false }));
      mockReadLobster.mockImplementation((id: bigint) =>
        Promise.resolve(mockLobster({ tokenId: id, evolutionTier: 1 })),
      );
      const res = await app.request('/combat/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1', bracket: '1' }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).bracket).toBe(1);
    });

    test('returns 400 when not team owner', async () => {
      mockReadTeam.mockResolvedValue(mockTeam({ owner: OTHER_ADDRESS }));

      const res = await app.request('/combat/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ teamId: '1', bracket: 0 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('Not the team owner');
    });

    test('returns 401 without auth', async () => {
      const res = await app.request('/combat/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: '1', bracket: 0 }),
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
        body: JSON.stringify({ teamId: '1', bracket: 0 }),
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
        body: JSON.stringify({ teamId: '1', bracket: 0 }),
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

  describe('POST /combat/:battleId/deposit (D-08 consent + D-13 commit in the deposit)', () => {
    const WEI = 10n ** 18n;
    // The match this server made for TEST_ADDRESS: Low bracket, Power 3 v 4.
    const matchRow = (over: Record<string, unknown> = {}) => ({ playerA: TEST_ADDRESS, playerB: OTHER_ADDRESS, stakeBracket: 0, powerA: 3, powerB: 4, queuedTeamA: 1n, queuedTeamB: 2n, fromMatchmaker: true, ...over });
    const onChain = (over: Record<string, unknown> = {}) => mockBattle({ phase: 1, stakeAmount: 2_500n * WEI, bracket: 0, powerA: 3, powerB: 4, ...over });
    const COMMIT = '0x' + 'c0'.repeat(32);
    const SALT = '0x' + 'ab'.repeat(32);
    const deposit = (body: unknown, headers = authHeaders()) =>
      app.request('/combat/1/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const depositCall = () => (mockEncodeFunctionData.mock.calls as any[]).map((c) => c[0]).find((x: any) => x.functionName === 'deposit');

    beforeEach(() => mockEncodeFunctionData.mockClear());

    test('a client-built commit: approve + deposit(battleId, expectedStake, maxOpponentPower, commit) from the MATCH RECORD', async () => {
      mockReadBattle.mockResolvedValue(onChain());
      mockFindFirst.mockResolvedValue(matchRow());
      const res = await deposit({ commitHash: COMMIT });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.steps).toHaveLength(2);
      expect(body.steps[0].description).toContain('Approve');
      expect(body.steps[1].description).toContain('commit your team');
      // Consent: the Low stake in wei and the opponent Power the caller (A) was shown — B's 4.
      expect(depositCall().args).toEqual([1n, 2_500n * WEI, 4, COMMIT]);
      expect(body.preview).toMatchObject({ commitHash: COMMIT, consent: { expectedStake: (2_500n * WEI).toString(), maxOpponentPower: 4 }, revealPrepared: false });
      expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    test('player B consents to A\'s Power', async () => {
      mockReadBattle.mockResolvedValue(onChain());
      mockFindFirst.mockResolvedValue(matchRow());
      expect((await deposit({ commitHash: COMMIT }, authHeaders(OTHER_ADDRESS))).status).toBe(200);
      expect(depositCall().args).toEqual([1n, 2_500n * WEI, 3, COMMIT]);
    });

    test('teamId + salt: the server builds the commit and keeps the salt for the reveal', async () => {
      mockReadBattle.mockResolvedValue(onChain());
      mockFindFirst.mockResolvedValue(matchRow());
      mockTeamCommitHash.mockImplementation(() => COMMIT);
      const res = await deposit({ teamId: '1', salt: SALT });
      expect(res.status).toBe(200);
      expect(mockTeamCommitHash).toHaveBeenCalledWith(1n, TEST_ADDRESS.toLowerCase(), 1n, SALT);
      expect(depositCall().args).toEqual([1n, 2_500n * WEI, 4, COMMIT]);
      expect(mockUpdateSet).toHaveBeenCalledWith({ teamA: 1n, revealSaltA: SALT });
      expect((await res.json()).preview.revealPrepared).toBe(true);
    });

    test('teamId + salt for a team other than the one queued (D-17): refused, nothing stored', async () => {
      mockReadBattle.mockResolvedValue(onChain());
      mockFindFirst.mockResolvedValue(matchRow());
      const res = await deposit({ teamId: '9', salt: SALT });
      expect(res.status).toBe(400);
      expect(mockUpdateSet).not.toHaveBeenCalled();
      expect(depositCall()).toBeUndefined();
    });

    test('no commit at all, or a zero commit: refused (the commit is part of the deposit)', async () => {
      mockReadBattle.mockResolvedValue(onChain());
      mockFindFirst.mockResolvedValue(matchRow());
      expect((await deposit({})).status).toBe(400);
      expect((await deposit({ commitHash: '0x' + '0'.repeat(64) })).status).toBe(400);
      expect((await deposit({ commitHash: '0x1234' })).status).toBe(400);
      expect((await deposit({ teamId: '1' })).status).toBe(400);
    });

    test('not in the Deposit phase: refused', async () => {
      mockReadBattle.mockResolvedValue(onChain({ phase: 3 }));
      mockFindFirst.mockResolvedValue(matchRow());
      expect((await deposit({ commitHash: COMMIT })).status).toBe(409);
    });

    test('a match record without the opponent Power: refused rather than consenting to anything', async () => {
      mockReadBattle.mockResolvedValue(onChain());
      mockFindFirst.mockResolvedValue(matchRow({ powerB: null }));
      expect((await deposit({ commitHash: COMMIT })).status).toBe(409);
    });

    // Review 2026-10-03: a retry after the deposit landed must not swap a good salt for a bad one.
    describe('once the deposit is on-chain', () => {
      test('a new salt that does NOT open the on-chain commit is not stored, and the response says so', async () => {
        mockReadBattle.mockResolvedValue(onChain({ depositA: true, teamCommitA: COMMIT }));
        mockFindFirst.mockResolvedValue(matchRow());
        mockTeamCommitHash.mockImplementation(() => '0x' + 'd1'.repeat(32)); // a fresh salt → a different hash
        const res = await deposit({ teamId: '1', salt: SALT });
        expect(res.status).toBe(200);
        expect(mockUpdateSet).not.toHaveBeenCalled();
        const body = await res.json();
        expect(body.preview.revealPrepared).toBe(false);
        expect(body.preview.revealNote).toContain('salt already on record was kept');
      });

      test('a salt that opens the on-chain commit is stored (idempotent re-send)', async () => {
        mockReadBattle.mockResolvedValue(onChain({ depositA: true, teamCommitA: COMMIT }));
        mockFindFirst.mockResolvedValue(matchRow());
        mockTeamCommitHash.mockImplementation(() => COMMIT);
        const res = await deposit({ teamId: '1', salt: SALT });
        expect(res.status).toBe(200);
        expect(mockUpdateSet).toHaveBeenCalledWith({ teamA: 1n, revealSaltA: SALT });
        const body = await res.json();
        expect(body.preview.revealPrepared).toBe(true);
        expect(body.preview.revealNote).toBeUndefined();
      });

      test('player B is checked against depositB / teamCommitB', async () => {
        mockReadBattle.mockResolvedValue(onChain({ depositB: true, teamCommitB: COMMIT }));
        mockFindFirst.mockResolvedValue(matchRow());
        mockTeamCommitHash.mockImplementation(() => '0x' + 'd1'.repeat(32));
        const res = await deposit({ teamId: '2', salt: SALT }, authHeaders(OTHER_ADDRESS));
        expect(res.status).toBe(200);
        expect(mockUpdateSet).not.toHaveBeenCalled();
        expect((await res.json()).preview.revealPrepared).toBe(false);
      });

      test('before the deposit lands, any salt for the queued team is stored (the commit is not final yet)', async () => {
        mockReadBattle.mockResolvedValue(onChain({ depositA: false, teamCommitA: '0x0' }));
        mockFindFirst.mockResolvedValue(matchRow());
        mockTeamCommitHash.mockImplementation(() => '0x' + 'd1'.repeat(32));
        const res = await deposit({ teamId: '1', salt: SALT });
        expect(res.status).toBe(200);
        expect(mockUpdateSet).toHaveBeenCalledWith({ teamA: 1n, revealSaltA: SALT });
      });
    });
  });

  // ── D-06: GET /combat/:battleId says whether the on-chain proposal is OUR result ──

  describe('GET /combat/:battleId — settlement check (D-06)', () => {
    const H1 = '0x' + '11'.repeat(32);
    const H2 = '0x' + '22'.repeat(32);
    const proposal = (over: Record<string, unknown> = {}) =>
      mockBattle({ phase: 5, proposedWinner: TEST_ADDRESS, finalStateHash: H1, turnLogHash: H2, payoutDeadline: 1_300n, ...over });
    const session = (over: Record<string, unknown> = {}) =>
      ({ status: 'settling', winner: 'A', playerA: TEST_ADDRESS, playerB: OTHER_ADDRESS, finalStateHash: H1, turnLogHash: H2, ...over });
    const read = async () => (await (await app.request('/combat/1')).json()).settlement;

    beforeEach(() => mockSessionFindFirst.mockReset());

    test('no proposal pending: no settlement block, and no session read', async () => {
      mockReadBattle.mockResolvedValue(mockBattle({ phase: 4 }));
      expect(await read()).toBeNull();
      expect(mockSessionFindFirst).not.toHaveBeenCalled();
    });

    test('the proposal is the result this server computed', async () => {
      mockReadBattle.mockResolvedValue(proposal());
      mockSessionFindFirst.mockResolvedValue(session());
      const r = await read();
      expect(r).toMatchObject({ status: 'in_review', verdict: 'matches', rogue: false, proposedWinner: TEST_ADDRESS.toLowerCase(), payoutDeadline: '1300', frozenAt: null, longStopAt: null });
      expect(r).not.toHaveProperty('disputeRoute');
    });

    test('a frozen result: status frozen_for_review with the 72 h long-stop', async () => {
      mockReadBattle.mockResolvedValue(proposal({ phase: 8, frozenAt: 2_000 }));
      mockSessionFindFirst.mockResolvedValue(session({ winner: 'B' }));
      expect(await read()).toMatchObject({ status: 'frozen_for_review', frozenAt: 2_000, longStopAt: 2_000 + 72 * 3600, verdict: 'result_mismatch', rogue: true });
    });

    test('a proposal while this server is still playing the battle is flagged rogue', async () => {
      mockReadBattle.mockResolvedValue(proposal({ proposedWinner: OTHER_ADDRESS }));
      mockSessionFindFirst.mockResolvedValue(session({ status: 'active', winner: null, finalStateHash: null, turnLogHash: null }));
      expect(await read()).toMatchObject({ verdict: 'session_still_active', rogue: true });
    });

    test('a different winner, or hashes that are not ours, is flagged rogue', async () => {
      mockReadBattle.mockResolvedValue(proposal({ proposedWinner: OTHER_ADDRESS }));
      mockSessionFindFirst.mockResolvedValue(session());
      expect(await read()).toMatchObject({ verdict: 'result_mismatch', rogue: true });

      mockReadBattle.mockResolvedValue(proposal({ turnLogHash: '0x' + 'ee'.repeat(32) }));
      expect(await read()).toMatchObject({ verdict: 'result_mismatch', rogue: true });
    });

    test('a draw we computed and a draw on-chain match', async () => {
      mockReadBattle.mockResolvedValue(proposal({ proposedWinner: '0x0000000000000000000000000000000000000000' }));
      mockSessionFindFirst.mockResolvedValue(session({ winner: 'draw' }));
      expect(await read()).toMatchObject({ verdict: 'matches', rogue: false });
    });

    test('NO session row (settled before this server claimed the battle): flagged rogue', async () => {
      mockReadBattle.mockResolvedValue(proposal());
      mockSessionFindFirst.mockResolvedValue(undefined);
      expect(await read()).toMatchObject({ verdict: 'no_session', rogue: true });
    });
  });

  // ── D-08: deposit calldata is only built for the match this server made ──

  describe('POST /combat/:battleId/deposit — consent binding (D-08)', () => {
    const WEI = 10n ** 18n;
    const matchRow = (over: Record<string, unknown> = {}) => ({ playerA: TEST_ADDRESS, playerB: OTHER_ADDRESS, stakeBracket: 0, powerA: 3, powerB: 3, fromMatchmaker: true, ...over });
    const onChain = (over: Record<string, unknown> = {}) => mockBattle({ phase: 1, stakeAmount: 2_500n * WEI, bracket: 0, powerA: 3, powerB: 3, ...over });
    const deposit = (headers = authHeaders()) =>
      app.request('/combat/1/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ commitHash: '0x' + 'c0'.repeat(32) }) });

    test('the rogue-matchmaker attack: queued for Low, the chain says 50,000 — refused, no calldata', async () => {
      mockReadBattle.mockResolvedValue(onChain({ stakeAmount: 50_000n * WEI }));
      mockFindFirst.mockResolvedValue(matchRow());
      const res = await deposit();
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.message).toContain('the stake differs');
      expect(body.message).toContain('50000 CLAW');
      expect(body.steps).toBeUndefined();
    });

    test('D-E: a battle in another bracket than the one queued for is refused', async () => {
      mockReadBattle.mockResolvedValue(onChain({ bracket: 2, stakeAmount: 50_000n * WEI }));
      mockFindFirst.mockResolvedValue(matchRow());
      const res = await deposit();
      expect(res.status).toBe(409);
      expect((await res.json()).message).toContain('the bracket differs');
    });

    test('D-E: a pegged Low stake below the launch value is accepted; the consent is the amount the chain bound', async () => {
      mockReadBattle.mockResolvedValue(onChain({ stakeAmount: 1_500n * WEI }));
      mockFindFirst.mockResolvedValue(matchRow());
      const res = await deposit();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.preview.consent.expectedStake).toBe((1_500n * WEI).toString());
      expect(body.preview.totalDeposit).toBe((1_575n * WEI).toString());
    });

    test('a different opponent than the match on record is refused', async () => {
      mockReadBattle.mockResolvedValue(onChain({ playerB: '0x9999999999999999999999999999999999999999' }));
      mockFindFirst.mockResolvedValue(matchRow());
      const res = await deposit();
      expect(res.status).toBe(409);
      expect((await res.json()).message).toContain('the players differ');
    });

    test('an opponent Power other than the one matched is refused (Power 3 v 9)', async () => {
      mockReadBattle.mockResolvedValue(onChain({ powerB: 9 }));
      mockFindFirst.mockResolvedValue(matchRow());
      const res = await deposit();
      expect(res.status).toBe(409);
      expect((await res.json()).message).toContain('Team Power B differs');
    });

    test('a battle this matchmaker never made (indexer fallback row) is refused', async () => {
      mockReadBattle.mockResolvedValue(onChain());
      mockFindFirst.mockResolvedValue(matchRow({ fromMatchmaker: false }));
      const res = await deposit();
      expect(res.status).toBe(409);
      expect((await res.json()).message).toContain('not created by this matchmaker');
    });

    test('no row at all is refused', async () => {
      mockReadBattle.mockResolvedValue(onChain());
      mockFindFirst.mockResolvedValue(undefined);
      expect((await deposit()).status).toBe(409);
    });

    test('a wallet that is not in the battle is refused', async () => {
      mockReadBattle.mockResolvedValue(onChain({ playerA: '0x1111111111111111111111111111111111111111', playerB: '0x2222222222222222222222222222222222222222' }));
      mockFindFirst.mockResolvedValue(matchRow({ playerA: '0x1111111111111111111111111111111111111111', playerB: '0x2222222222222222222222222222222222222222' }));
      const res = await deposit();
      expect(res.status).toBe(409);
      expect((await res.json()).message).toContain('not a participant');
    });

    test('player B of an honest Mid match gets calldata for 10,500', async () => {
      mockReadBattle.mockResolvedValue(onChain({ stakeAmount: 10_000n * WEI, bracket: 1, powerA: 5, powerB: 6 }));
      mockFindFirst.mockResolvedValue(matchRow({ stakeBracket: 1, powerA: 5, powerB: 6 }));
      const res = await deposit(authHeaders(OTHER_ADDRESS));
      expect(res.status).toBe(200);
      expect((await res.json()).preview.totalDeposit).toBe((10_500n * WEI).toString());
    });
  });

  // ── D-E: the stake quote ──

  describe('GET /combat/stakes (D-E quote)', () => {
    test('returns the chain quote, serialized, without auth', async () => {
      const WEI = 10n ** 18n;
      mockReadStakeQuote.mockResolvedValue({
        brackets: [
          { bracket: 0, label: 'Low', stakeWei: 1_500n * WEI, launchStakeWei: 2_500n * WEI },
          { bracket: 1, label: 'Mid', stakeWei: 6_000n * WEI, launchStakeWei: 10_000n * WEI },
          { bracket: 2, label: 'High', stakeWei: 30_000n * WEI, launchStakeWei: 50_000n * WEI },
        ],
        peg: { stakeReferenceWei: 625n * WEI, liveBaseRewardWei: 600n * WEI, effectiveReferenceWei: 625n * WEI, genesisBaseRewardWei: 1_250n * WEI, fixedBps: 2_000n },
      });
      const res = await app.request('/combat/stakes');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.brackets).toHaveLength(3);
      expect(body.brackets[0]).toMatchObject({ bracket: 0, label: 'Low', stakeWei: (1_500n * WEI).toString(), launchStakeWei: (2_500n * WEI).toString() });
      expect(body.peg.fixedBps).toBe('2000');
      expect(body.note).toContain('createBattle');
    });
  });

  // ── Player disputes were removed (owner decision 2026-10-01) ──

  test('there is no dispute route any more', async () => {
    mockReadBattle.mockResolvedValue(mockBattle({ phase: 5 }));
    const res = await app.request('/combat/1/dispute', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: '{}' });
    expect(res.status).toBe(404);
  });

  test('there is no separate commit-team route: the commit rides in the deposit', async () => {
    const res = await app.request('/combat/1/commit-team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ commitHash: '0xabc123' }),
    });
    expect(res.status).toBe(404);
  });

  // ── D-14: an accused player opens their own commit ──
  describe('POST /combat/:battleId/open-commit (D-14)', () => {
    const SALT = '0x' + 'ab'.repeat(32);
    const open = (body: unknown, headers = authHeaders()) =>
      app.request('/combat/1/open-commit', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

    beforeEach(() => mockEncodeFunctionData.mockClear());

    test('accused, salt opens the commit: openOwnCommit calldata', async () => {
      mockReadBattle.mockResolvedValue(mockBattle({ phase: 3, teamCommitA: '0xcommit', accusedA: true }));
      const res = await open({ teamId: '1', salt: SALT });
      expect(res.status).toBe(200);
      const call = (mockEncodeFunctionData.mock.calls as any[]).map((c) => c[0]).find((x: any) => x.functionName === 'openOwnCommit');
      expect(call.args).toEqual([1n, 1n, SALT]);
    });

    test('not accused: refused (use /reveal-team)', async () => {
      mockReadBattle.mockResolvedValue(mockBattle({ phase: 3, teamCommitA: '0xcommit' }));
      expect((await open({ teamId: '1', salt: SALT })).status).toBe(409);
    });

    test('a salt that does not open the commit: refused', async () => {
      mockReadBattle.mockResolvedValue(mockBattle({ phase: 3, teamCommitA: '0xsomethingelse', accusedA: true }));
      expect((await open({ teamId: '1', salt: SALT })).status).toBe(400);
    });

    test('outside TeamReveal, or not a participant: refused', async () => {
      mockReadBattle.mockResolvedValue(mockBattle({ phase: 4, teamCommitA: '0xcommit', accusedA: true }));
      expect((await open({ teamId: '1', salt: SALT })).status).toBe(409);
      mockReadBattle.mockResolvedValue(mockBattle({ phase: 3, playerA: '0x1111111111111111111111111111111111111111', playerB: '0x2222222222222222222222222222222222222222' }));
      expect((await open({ teamId: '1', salt: SALT })).status).toBe(401);
    });
  });

  // ──────────── POST /combat/:battleId/reveal-team (F5-01: salt POST, no calldata) ────────────

  describe('POST /combat/:battleId/reveal-team', () => {
    const revealBody = (over: Record<string, string> = {}) =>
      JSON.stringify({ teamId: '1', salt: '0x' + 'ab'.repeat(32), ...over });

    test('stores the salt and reports waiting when the opponent has not revealed', async () => {
      mockReadBattle.mockResolvedValue(mockBattle({ phase: 3, teamCommitA: '0xcommit' }));
      mockFindFirst.mockResolvedValue({ queuedTeamA: 1n, queuedTeamB: 2n, revealSaltA: '0x' + 'ab'.repeat(32), revealSaltB: null });

      const res = await app.request('/combat/1/reveal-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: revealBody(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('waiting_for_opponent');
      expect(body.steps).toBeUndefined(); // the player signs nothing to reveal
      // Player A's teamId + salt were written to the battle row.
      expect(mockUpdateSet).toHaveBeenCalledTimes(1);
      // An accepted reveal also clears any refusal noted for this side.
      expect(mockUpdateSet.mock.calls[0][0]).toEqual({ teamA: 1n, revealSaltA: '0x' + 'ab'.repeat(32), revealRefusedA: null });
      // The hash was checked for THIS player, battle 1, team 1.
      const [battleId, player, teamId] = mockTeamCommitHash.mock.calls[0] as unknown as [bigint, string, bigint, string];
      expect(battleId).toBe(1n);
      expect(player.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
      expect(teamId).toBe(1n);
    });

    test('reports both_revealed once the opponent salt is present', async () => {
      mockReadBattle.mockResolvedValue(mockBattle({ phase: 3, teamCommitA: '0xcommit' }));
      mockFindFirst.mockResolvedValue({ queuedTeamA: 1n, queuedTeamB: 2n, revealSaltA: '0xaa', revealSaltB: '0xbb' });

      const res = await app.request('/combat/1/reveal-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: revealBody(),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe('both_revealed');
    });

    test('player B writes the B-side columns', async () => {
      mockReadBattle.mockResolvedValue(mockBattle({ phase: 3, teamCommitB: '0xcommit' }));
      mockFindFirst.mockResolvedValue({ queuedTeamA: 1n, queuedTeamB: 2n, revealSaltA: null, revealSaltB: '0xbb' });

      const res = await app.request('/combat/1/reveal-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(OTHER_ADDRESS) },
        body: revealBody({ teamId: '2' }),
      });
      expect(res.status).toBe(200);
      expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({ teamB: 2n });
    });

    test('rejects a non-participant (401)', async () => {
      mockReadBattle.mockResolvedValue(
        mockBattle({ phase: 3, playerA: '0x1111111111111111111111111111111111111111', playerB: '0x2222222222222222222222222222222222222222' }),
      );
      const res = await app.request('/combat/1/reveal-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: revealBody(),
      });
      expect(res.status).toBe(401);
      expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    test('rejects a battle that is not in the TeamReveal phase (409)', async () => {
      mockReadBattle.mockResolvedValue(mockBattle({ phase: 1, teamCommitA: '0xcommit' }));
      const res = await app.request('/combat/1/reveal-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: revealBody(),
      });
      expect(res.status).toBe(409);
      expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    test('rejects a salt/teamId that does not match the on-chain commit (400)', async () => {
      mockReadBattle.mockResolvedValue(mockBattle({ phase: 3, teamCommitA: '0xsomethingelse' }));
      const res = await app.request('/combat/1/reveal-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: revealBody(),
      });
      expect(res.status).toBe(400);
      expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    // ── D-17: the revealed team must be the queued team ──

    test('D-17: rejects a reveal of a different team than the one queued, even with a valid commit (400)', async () => {
      // The counter-pick: the player committed team 7 on-chain (the hash matches), but
      // queued with team 1. Same owner, same Power — the contract would accept it.
      mockReadBattle.mockResolvedValue(mockBattle({ phase: 3, teamCommitA: '0xcommit' }));
      mockFindFirst.mockResolvedValue({ queuedTeamA: 1n, queuedTeamB: 2n, revealSaltA: null, revealSaltB: null });

      const res = await app.request('/combat/1/reveal-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: revealBody({ teamId: '7' }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).message).toContain('not the team you queued with');
      // No salt reaches the reveal watcher — but the refusal is noted on the row, so the watcher
      // does not report this side for a reveal the SERVER refused (review 2026-10-03).
      expect(mockUpdateSet).toHaveBeenCalledTimes(1);
      expect(mockUpdateSet.mock.calls[0][0]).toEqual({ revealRefusedA: 'teamId 7 is not the queued team' });
    });

    test('D-17: player B is held to queuedTeamB, not queuedTeamA', async () => {
      mockReadBattle.mockResolvedValue(mockBattle({ phase: 3, teamCommitB: '0xcommit' }));
      mockFindFirst.mockResolvedValue({ queuedTeamA: 1n, queuedTeamB: 2n, revealSaltA: null, revealSaltB: null });

      const res = await app.request('/combat/1/reveal-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(OTHER_ADDRESS) },
        body: revealBody({ teamId: '1' }), // A's queued team, not B's
      });
      expect(res.status).toBe(400);
      expect(mockUpdateSet).toHaveBeenCalledTimes(1);
      expect(mockUpdateSet.mock.calls[0][0]).toEqual({ revealRefusedB: 'teamId 1 is not the queued team' });
    });

    test('D-17: fails closed when no queued team is on record (409)', async () => {
      mockReadBattle.mockResolvedValue(mockBattle({ phase: 3, teamCommitA: '0xcommit' }));
      mockFindFirst.mockResolvedValue({ queuedTeamA: null, queuedTeamB: null, revealSaltA: null, revealSaltB: null });

      const res = await app.request('/combat/1/reveal-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: revealBody(),
      });
      expect(res.status).toBe(409);
      // The indexer's fallback row: the player did nothing wrong, so the refusal is recorded and
      // the engine lets the window lapse into a mutual cancel instead of accusing them.
      expect(mockUpdateSet).toHaveBeenCalledTimes(1);
      expect(mockUpdateSet.mock.calls[0][0]).toEqual({ revealRefusedA: 'no queued team on record' });
    });

    test('D-17: fails closed when the battle row is missing entirely (409)', async () => {
      mockReadBattle.mockResolvedValue(mockBattle({ phase: 3, teamCommitA: '0xcommit' }));
      mockFindFirst.mockResolvedValue(undefined);

      const res = await app.request('/combat/1/reveal-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: revealBody(),
      });
      expect(res.status).toBe(409);
      expect(mockUpdateSet).not.toHaveBeenCalled();
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
