import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Mock @clawbada/chain (walletAuth) ──
mock.module('@clawbada/chain', () => ({
  verifyMessage: mock(() => Promise.resolve(true)),
  getAddress: mock((addr: string) => addr),
  encodeFunctionData: mock(() => '0xabcdef'),
  BattleArenaAbi: [],
  ClawTokenAbi: [],
  addresses: { battleArena: '0xBATTLE', clawToken: '0xCLAW' },
  base: { id: 8453 },
  baseSepolia: { id: 84532 },
  getPublicClient: mock(() => ({})),
  getBattleArena: mock(() => ({})),
  DrandBeaconClient: class { async fetchLatest() { return { round: 1, randomness: 'ab'.repeat(32) }; } toBigInt(r: string) { return BigInt('0x' + r); } },
}));

// ── Mock the chain readers the practice route uses ──
const mockReadTeam = mock<any>();
const mockReadLobster = mock<any>();
mock.module('../../lib/chain', () => ({
  readTeam: mockReadTeam,
  readLobster: mockReadLobster,
  readBattle: mock(async () => ({ phase: 4 })),
  serializeBigInts: <T,>(x: T) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
}));

// ── Mock the session manager singleton (real protocol/manager helpers stay real) ──
import { isPracticeId, CHAIN_ID_RE } from '../../lib/battle-session/protocol';
import { PracticeConflictError } from '../../lib/battle-session/manager';
const mockStartPractice = mock<any>();
const mockSubmit = mock<any>();
const mockGet = mock<any>();
const mockSnapshotFor = mock<any>();
const mockIsParticipant = mock<any>();
const mockStoreGet = mock<any>();
const mockListTurns = mock<any>();
mock.module('../../lib/battle-session', () => ({
  isPracticeId,
  CHAIN_ID_RE,
  PracticeConflictError,
  battleSessions: {
    startPractice: mockStartPractice,
    submit: mockSubmit,
    get: mockGet,
    snapshotFor: mockSnapshotFor,
    isParticipant: mockIsParticipant,
    deps: { store: { get: mockStoreGet, listTurns: mockListTurns } },
  },
}));

import { sessionRoutes } from '../../routes/game/combat/session';
import { createTestApp, authHeaders, TEST_ADDRESS, OTHER_ADDRESS } from '../helpers/route-test-utils';

const app = createTestApp(sessionRoutes, '/api/game/combat');
const P_ID = 'p_123e4567-e89b-12d3-a456-426614174000';

function fakeSession(id: string, side: 'A' | 'B' | null = 'A') {
  return {
    record: { id, kind: id.startsWith('p_') ? 'practice' : 'real', playerA: TEST_ADDRESS.toLowerCase(), playerB: 'bot:balanced' },
    snapshot: () => ({ session: { id }, current: { turn: 1 } }),
    sideOf: (addr: string) => (addr === TEST_ADDRESS.toLowerCase() ? side : null),
    current: () => ({ turn: 1, lobsterId: 'L0', side: 'A', controller: TEST_ADDRESS.toLowerCase(), deadline: 123 }),
    state: { lobsters: [{ id: 'L0', team: 'A' }] },
  };
}

beforeEach(() => {
  for (const m of [mockStartPractice, mockSubmit, mockGet, mockSnapshotFor, mockIsParticipant, mockStoreGet, mockListTurns, mockReadTeam, mockReadLobster]) m.mockReset();
  process.env.PRACTICE_PRESETS = 'true';
});

describe('POST /practice', () => {
  test('preset roster → 201 with battleId + snapshot; bot + opponent validated', async () => {
    mockStartPractice.mockImplementation(async (opts: any) => fakeSession(P_ID) && { record: { id: P_ID }, snapshot: () => ({ ok: true, bot: opts.bot, n: opts.lobsters.length }) });
    const res = await app.request('/api/game/combat/practice', { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ preset: 'elite_mix', bot: 'cautious' }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.battleId).toBe(P_ID);
    expect(body.snapshot).toEqual({ ok: true, bot: 'cautious', n: 3 });
    expect(mockStartPractice.mock.calls[0][0]).toMatchObject({ owner: TEST_ADDRESS.toLowerCase(), bot: 'cautious', opponent: 'mirror' });

    const bad = await app.request('/api/game/combat/practice', { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ preset: 'elite_mix', bot: 'gpt5' }) });
    expect(bad.status).toBe(400);
    const badOpp = await app.request('/api/game/combat/practice', { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ preset: 'elite_mix', opponent: 'clone' }) });
    expect(badOpp.status).toBe(400);
  });

  test('team roster: owner check via chain, lobsters decoded from DNA', async () => {
    mockReadTeam.mockImplementation(async () => ({ owner: TEST_ADDRESS, lobsterIds: [1n, 2n, 3n] }));
    mockReadLobster.mockImplementation(async (id: bigint) => ({ tokenId: id, owner: TEST_ADDRESS, dna: 0x3700000000000000000000000000000000000000000000000000000000000000n, evolutionTier: 1, purity: 2 }));
    mockStartPractice.mockImplementation(async () => ({ record: { id: P_ID }, snapshot: () => ({}) }));
    const res = await app.request('/api/game/combat/practice', { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ teamId: '9' }) });
    expect(res.status).toBe(201);
    const opts = (mockStartPractice.mock.calls as any)[0][0];
    expect(opts.lobsters).toHaveLength(3);
    expect(opts.lobsters[0].tokenId).toBe('1');
    // bun module mocks are process-global: routes/agent.test.ts mocks decodeDNA, so only the shape is stable here.
    expect(Array.isArray(opts.lobsters[0].partClassIds)).toBe(true);

    mockReadTeam.mockImplementation(async () => ({ owner: OTHER_ADDRESS, lobsterIds: [1n, 2n, 3n] }));
    const notMine = await app.request('/api/game/combat/practice', { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ teamId: '9' }) });
    expect(notMine.status).toBe(401);
  });

  test('one active practice per wallet → 409; no roster → 400; unauthenticated → 401', async () => {
    mockStartPractice.mockImplementation(async () => { throw new PracticeConflictError(P_ID); });
    const res = await app.request('/api/game/combat/practice', { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ preset: 'evolved_mix' }) });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toContain(P_ID);
    const empty = await app.request('/api/game/combat/practice', { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({}) });
    expect(empty.status).toBe(400);
    const anon = await app.request('/api/game/combat/practice', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(anon.status).toBe(401);
  });
});

describe('POST /:battleId/turn', () => {
  test('accepted → 200 with result; engine rejections → 409 with the TurnError code; unknown → 404; stranger → 401', async () => {
    mockSubmit.mockImplementation(async () => ({ ok: true, duplicate: false, result: { turn: 1 } }));
    // submit is sync in the real manager; the route awaits nothing, so return a plain value too.
    mockSubmit.mockImplementation(() => ({ ok: true, duplicate: false, result: { turn: 1 } }));
    let res = await app.request(`/api/game/combat/${P_ID}/turn`, { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ turn: 1, command: { lobsterId: 'L0', action: 'defend' } }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true, duplicate: false, result: { turn: 1 } });
    expect(mockSubmit.mock.calls[0]).toEqual([P_ID, TEST_ADDRESS.toLowerCase(), 1, { lobsterId: 'L0', action: 'defend' }]);

    mockSubmit.mockImplementation(() => ({ ok: false, code: 'out_of_range', message: 'B1 is out of attack range', turn: 1 }));
    res = await app.request(`/api/game/combat/42/turn`, { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ turn: 1, command: {} }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'BATTLE_PHASE_ERROR', code: 'out_of_range', turn: 1 });

    mockSubmit.mockImplementation(() => ({ ok: false, code: 'session_not_found', message: 'nope' }));
    expect((await app.request(`/api/game/combat/42/turn`, { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ turn: 1, command: {} }) })).status).toBe(404);
    mockSubmit.mockImplementation(() => ({ ok: false, code: 'not_participant', message: 'nope' }));
    expect((await app.request(`/api/game/combat/42/turn`, { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ turn: 1, command: {} }) })).status).toBe(401);
    // Bad turn field never reaches the manager.
    mockSubmit.mockClear();
    expect((await app.request(`/api/game/combat/42/turn`, { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ turn: 'one', command: {} }) })).status).toBe(400);
    expect(mockSubmit).not.toHaveBeenCalled();
    // Bad id shape.
    expect((await app.request(`/api/game/combat/0x10/turn`, { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ turn: 1, command: {} }) })).status).toBe(400);
  });
});

describe('GET /:battleId/state and /turns', () => {
  test('live snapshot for a real battle is public; practice requires the owner', async () => {
    mockSnapshotFor.mockImplementation((id: string) => (id === '42' ? { session: { id } } : null));
    expect((await app.request('/api/game/combat/42/state')).status).toBe(200);
    // practice without headers → 401; with owner headers → 200
    mockIsParticipant.mockImplementation(async () => true);
    expect((await app.request(`/api/game/combat/${P_ID}/state`)).status).toBe(401);
    mockSnapshotFor.mockImplementation(() => ({ session: { id: P_ID } }));
    expect((await app.request(`/api/game/combat/${P_ID}/state`, { headers: authHeaders() })).status).toBe(200);
    mockIsParticipant.mockImplementation(async () => false);
    expect((await app.request(`/api/game/combat/${P_ID}/state`, { headers: authHeaders() })).status).toBe(401);
  });

  test('a finished battle falls back to the persisted row; unknown → 404', async () => {
    mockSnapshotFor.mockImplementation(() => null);
    const { v3, EvolutionTier, LobsterClass } = await import('@clawbada/game-logic');
    const mk = (p: string) => [LobsterClass.Bulwark, LobsterClass.Mantis, LobsterClass.Sentinel].map((c, i) => ({ id: `${p}${i}`, class: c, tier: EvolutionTier.Evolved, purity: 0 }));
    const state = v3.createBattle({ battleId: '42', vrfSeed: 7n, tier: 'evolved', teamA: mk('A'), teamB: mk('B') });
    mockStoreGet.mockImplementation(async (id: string) => (id === '42' ? { id, kind: 'real', tier: 'evolved', playerA: 'a', playerB: 'b', bot: null, status: 'settled', winner: 'A', timeouts: { A: 0, B: 0 }, roster: [], stateJson: v3.serializeState(state), createdAt: new Date() } : null));
    const res = await app.request('/api/game/combat/42/state');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session).toMatchObject({ id: '42', status: 'settled', winner: 'A' });
    expect(body.state.vrfSeed).toBeUndefined();
    expect(body.current.turn).toBe(0);
    expect((await app.request('/api/game/combat/43/state')).status).toBe(404);
  });

  test('/turns lists persisted turns', async () => {
    mockListTurns.mockImplementation(async () => [{ turn: 1, lobsterId: 'A0', submittedBy: 'player' }]);
    const res = await app.request('/api/game/combat/42/turns');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ battleId: '42', count: 1, turns: [{ turn: 1, lobsterId: 'A0', submittedBy: 'player' }] });
  });
});

describe('GET /:battleId/legal', () => {
  /** Hand-built 6-lobster state: routes/agent.test.ts mocks game-logic's getBaseStats
   *  process-wide (plain numbers), so createBattle cannot be used from this file. */
  async function handState() {
    const { v3 } = await import('@clawbada/game-logic');
    const spawns = v3.defaultSpawns(6, 5);
    const layout = { layoutId: 'open', cols: 6, rows: 5, blockedHexes: [], tier: 'evolved' as const, ...spawns };
    const mk = (id: string, team: 'A' | 'B', slot: number, cls: number, speed: bigint) => ({
      id, team, slot, class: cls as any, tier: 1 as any, purity: 0, legend: false,
      stats: { hp: 500n, attack: 100n, armor: 100n, speed, critical: 100n }, maxHp: 500n, hp: 500n, alive: true,
      pos: { ...(team === 'A' ? spawns.teamASpawns : spawns.teamBSpawns)[slot] }, charge: 0, defending: false, statuses: [],
      lastTick: 0n, turnsTaken: 0, stunImmunity: 0, recentHits: 0, tiebreak: BigInt(slot + (team === 'B' ? 3 : 0)),
    });
    const state = {
      battleId: '42', vrfSeed: 1n, layout, rules: v3.DEFAULT_RULES,
      lobsters: [mk('A0', 'A', 0, 0, 130n), mk('A1', 'A', 1, 1, 100n), mk('A2', 'A', 2, 5, 90n), mk('B0', 'B', 0, 8, 105n), mk('B1', 'B', 1, 6, 110n), mk('B2', 'B', 2, 7, 95n)],
      damageDealt: { A: 0n, B: 0n }, turn: 0, tick: 0n, finished: false, winner: null, log: [],
    } as unknown as import('@clawbada/game-logic').v3.AtbBattleState;
    return { v3, state, actor: v3.nextActor(state)! };
  }

  test('returns legal commands on the caller\'s turn, 409 otherwise, 401 for strangers', async () => {
    const { state, actor } = await handState();
    expect(actor.id).toBe('A0'); // fastest lobster acts first
    const session = {
      record: { id: '42', kind: 'real', playerA: TEST_ADDRESS.toLowerCase(), playerB: OTHER_ADDRESS.toLowerCase() },
      state,
      sideOf: (a: string) => (a === TEST_ADDRESS.toLowerCase() ? 'A' : a === OTHER_ADDRESS.toLowerCase() ? 'B' : null),
      current: () => ({ turn: 1, lobsterId: actor.id, side: actor.team, controller: TEST_ADDRESS.toLowerCase(), deadline: 5 }),
    };
    mockGet.mockImplementation(() => session);
    const ok = await app.request('/api/game/combat/42/legal', { headers: authHeaders() });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.turn).toBe(1);
    expect(body.lobsterId).toBe('A0');
    expect(body.commands.length).toBeGreaterThan(0);
    expect(body.commands.every((c: any) => c.lobsterId === 'A0')).toBe(true);
    expect(body.summary.lobsterId).toBe('A0');
    expect(body.summary.moves.length).toBeGreaterThan(0);
    expect((await app.request('/api/game/combat/42/legal', { headers: authHeaders(OTHER_ADDRESS) })).status).toBe(409);
    expect((await app.request('/api/game/combat/42/legal', { headers: authHeaders('0x9999999999999999999999999999999999999999') })).status).toBe(401);
    mockGet.mockImplementation(() => undefined);
    expect((await app.request('/api/game/combat/42/legal', { headers: authHeaders() })).status).toBe(404);
  });
});
