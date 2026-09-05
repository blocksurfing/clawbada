/**
 * BattleSessionManager with a fake store / chain / drand. Real game-logic, fake clock.
 * No mock.module here (see session.test.ts).
 */
// These suites need the REAL @clawbada/game-logic. bun module mocks are process-global
// and other files (routes/agent.test.ts) mock parts of it, so apps/api runs this
// directory in its own `bun test` process (see package.json "test:session").
import { describe, test, expect } from 'bun:test';
import { v3, EvolutionTier, LobsterClass, encodeDNA, LegendStatus } from '@clawbada/game-logic';
import { FakeClock, ShotClock } from '../../lib/battle-session/clock';
import { BattleSessionManager, PracticeConflictError, arenaTierFor } from '../../lib/battle-session/manager';
import type { NewSessionRow, PendingRealBattle, SessionRow, SessionStore, SettleJobPayload } from '../../lib/battle-session/store';

const ALICE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function alleles(cls: number): number[] {
  const out: number[] = [];
  for (let s = 0; s < 6; s++) out.push((cls << 4) | 1, (1 << 4) | 1, (2 << 4) | 2);
  return out;
}
function dnaFor(cls: LobsterClass): bigint {
  return encodeDNA(cls, LegendStatus.Normal, 0, alleles(cls) as any);
}

class FakeStore {
  rows = new Map<string, SessionRow>();
  turns: { sessionId: string; turn: number; submittedBy: string }[] = [];
  jobs: SettleJobPayload[] = [];
  pending: PendingRealBattle[] = [];
  async insertSession(row: NewSessionRow): Promise<boolean> {
    if (this.rows.has(row.id)) return false;
    this.rows.set(row.id, { ...row, winner: null, finalStateHash: null, turnLogHash: null, createdAt: new Date(), updatedAt: new Date() } as unknown as SessionRow);
    return true;
  }
  async initSession(id: string, patch: Partial<SessionRow>): Promise<void> { Object.assign(this.rows.get(id)!, patch); }
  async writeTurns(sessionId: string, turns: { turn: number; submittedBy: string }[], snap: { stateJson: string; turn: number; deadline: Date | null; timeouts: Record<'A' | 'B', number> }): Promise<void> {
    for (const t of turns) this.turns.push({ sessionId, turn: t.turn, submittedBy: t.submittedBy });
    Object.assign(this.rows.get(sessionId)!, snap);
  }
  async markFinished(id: string, patch: Partial<SessionRow>): Promise<void> { Object.assign(this.rows.get(id)!, patch, { deadline: null }); }
  async markStatus(id: string, status: SessionRow['status']): Promise<void> { this.rows.get(id)!.status = status; }
  async deleteSession(id: string): Promise<void> { this.rows.delete(id); }
  async enqueueSettle(payload: SettleJobPayload): Promise<void> { this.jobs.push(payload); }
  async loadActive(): Promise<SessionRow[]> { return [...this.rows.values()].filter((r) => r.status === 'active'); }
  async get(id: string): Promise<SessionRow | null> { return this.rows.get(id) ?? null; }
  async listTurns(): Promise<never[]> { return []; }
  async activePracticeFor(owner: string): Promise<SessionRow | null> {
    return [...this.rows.values()].find((r) => r.kind === 'practice' && r.playerA === owner && r.status === 'active') ?? null;
  }
  async pendingRealBattles(): Promise<PendingRealBattle[]> { return this.pending.filter((p) => !this.rows.has(p.battleId.toString())); }
}

function chainWith(teams: Record<string, { owner: string; lobsterIds: bigint[] }>, lobsters: Record<string, { owner: string; cls: LobsterClass; tier: number }>, phase = 4) {
  return {
    readTeam: async (teamId: bigint) => teams[teamId.toString()],
    readLobster: async (tokenId: bigint) => {
      const l = lobsters[tokenId.toString()];
      return { tokenId, owner: l.owner, dna: dnaFor(l.cls), evolutionTier: l.tier, purity: 2 };
    },
    readBattlePhase: async () => phase,
  };
}

function make(store: FakeStore, extra: Partial<ConstructorParameters<typeof BattleSessionManager>[0]> = {}) {
  const fake = new FakeClock();
  const events: { id: string; event: string; data: any }[] = [];
  const logs: string[] = [];
  const mgr = new BattleSessionManager({
    store: store as unknown as SessionStore,
    emit: (id, event, data) => events.push({ id, event, data }),
    chain: chainWith({}, {}),
    drand: { fetchLatest: async () => ({ round: 4242, randomness: 'ab'.repeat(32) }), toBigInt: (r) => BigInt('0x' + r) },
    log: { info: (_o, m) => logs.push(m), warn: (_o, m) => logs.push(m), error: (o, m) => logs.push(`${m}:${String((o as any).err)}`) },
    clock: new ShotClock(fake),
    shotClockMs: 60_000,
    botThinkMs: 500,
    randomSeed: () => 12345n,
    ...extra,
  });
  return { mgr, fake, events, logs };
}

const practiceLobsters = [LobsterClass.Bulwark, LobsterClass.Mantis, LobsterClass.Sentinel].map((c, i) => ({ input: { id: `L${i}`, class: c, tier: EvolutionTier.Elite, purity: 2, legend: false } }));

describe('practice', () => {
  test('startPractice builds a mirror opponent, persists the row, starts the loop, and enforces one-per-owner', async () => {
    const store = new FakeStore();
    const { mgr, events } = make(store);
    const s = await mgr.startPractice({ owner: ALICE, lobsters: practiceLobsters, bot: 'balanced', opponent: 'mirror' });
    expect(s.record.id).toMatch(/^p_/);
    expect(s.record.kind).toBe('practice');
    expect(s.record.tier).toBe('elite');
    expect(s.record.roster.filter((r) => r.side === 'B').map((r) => r.classId)).toEqual([LobsterClass.Bulwark, LobsterClass.Mantis, LobsterClass.Sentinel]);
    expect(store.rows.get(s.record.id)).toMatchObject({ kind: 'practice', playerA: ALICE, playerB: 'bot:balanced', status: 'active' });
    expect(events.some((e) => e.event === 'turn_started')).toBe(true);
    await expect(mgr.startPractice({ owner: ALICE, lobsters: practiceLobsters, bot: 'greedy', opponent: 'mirror' })).rejects.toBeInstanceOf(PracticeConflictError);
    expect(mgr.liveCount()).toBe(1);
  });

  test("'random' opponents are seeded from the practice seed", async () => {
    const store = new FakeStore();
    const { mgr } = make(store);
    const s = await mgr.startPractice({ owner: ALICE, lobsters: practiceLobsters, bot: 'cautious', opponent: 'random' });
    const botClasses = s.record.roster.filter((r) => r.side === 'B').map((r) => r.classId);
    expect(botClasses.every((c) => c >= 0 && c <= 9)).toBe(true);
    // deterministic for the fixed test seed
    const store2 = new FakeStore();
    const { mgr: mgr2 } = make(store2);
    const s2 = await mgr2.startPractice({ owner: BOB, lobsters: practiceLobsters, bot: 'cautious', opponent: 'random' });
    expect(s2.record.roster.filter((r) => r.side === 'B').map((r) => r.classId)).toEqual(botClasses);
  });

  test('submit routes by address, rejects strangers and bad commands, and a finished practice writes finished + no settle job', async () => {
    const store = new FakeStore();
    const { mgr, fake, events } = make(store, { botThinkMs: 100 });
    const s = await mgr.startPractice({ owner: ALICE, lobsters: practiceLobsters, bot: 'aggressive', opponent: 'mirror' });
    expect(mgr.submit(s.record.id, BOB, 1, { lobsterId: 'L0', action: 'defend' })).toMatchObject({ ok: false, code: 'not_participant' });
    expect(mgr.submit(s.record.id, ALICE, 1, { nope: true })).toMatchObject({ ok: false, code: 'bad_command' });
    expect(mgr.submit('p_missing', ALICE, 1, {})).toMatchObject({ ok: false, code: 'session_not_found' });
    for (let guard = 0; guard < 400 && !s.state.finished; guard++) {
      const cur = s.current();
      if (cur.controller === 'bot') { fake.advance(100); continue; }
      const actor = s.state.lobsters.find((l) => l.id === cur.lobsterId)!;
      const r = mgr.submit(s.record.id, ALICE, cur.turn, v3.BOTS.aggressive(s.state, actor));
      if (!r.ok) throw new Error(r.message);
    }
    expect(s.state.finished).toBe(true);
    await s.flushed();
    await new Promise((r) => setTimeout(r, 0));
    const row = store.rows.get(s.record.id)!;
    expect(row.status).toBe('finished');
    expect(row.finalStateHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(row.turnLogHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(store.jobs).toHaveLength(0);
    const ended = events.find((e) => e.event === 'battle_ended')!;
    expect(ended.data).toMatchObject({ settle: 'n/a', turnLogHash: row.turnLogHash, finalStateHash: row.finalStateHash });
    expect(['wipeout', 'turn_cap']).toContain(ended.data.reason);
    expect(mgr.liveCount()).toBe(0);
    expect(store.turns.length).toBe(s.state.log.length);
  });
});

describe('real battles', () => {
  const teams = { '11': { owner: ALICE, lobsterIds: [1n, 2n, 3n] }, '22': { owner: BOB, lobsterIds: [4n, 5n, 6n] } };
  const lobsters = {
    '1': { owner: ALICE, cls: LobsterClass.Kraken, tier: 2 }, '2': { owner: ALICE, cls: LobsterClass.Reaver, tier: 2 }, '3': { owner: ALICE, cls: LobsterClass.Ember, tier: 3 },
    '4': { owner: BOB, cls: LobsterClass.Bulwark, tier: 2 }, '5': { owner: BOB, cls: LobsterClass.Abyss, tier: 2 }, '6': { owner: BOB, cls: LobsterClass.Tempest, tier: 2 },
  };

  test('the poller claims an Active battle once, loads teams from chain, rolls a beacon, and starts the loop', async () => {
    const store = new FakeStore();
    store.pending.push({ battleId: 501n, playerA: ALICE, playerB: BOB, teamA: 11n, teamB: 22n });
    const { mgr, events } = make(store, { chain: chainWith(teams, lobsters) });
    expect(await mgr.pollOnce()).toBe(1);
    expect(await mgr.pollOnce()).toBe(0); // claimed → no longer pending
    const s = mgr.get('501')!;
    expect(s.record.kind).toBe('real');
    expect(s.record.tier).toBe('elite'); // min tier across both teams
    expect(s.record.vrfRound).toBe(4242);
    expect(s.state.vrfSeed).toBe(BigInt('0x' + 'ab'.repeat(32)));
    expect(s.record.roster.map((r) => r.tokenId)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(s.record.roster[0].partClassIds).toHaveLength(6);
    expect(store.rows.get('501')).toMatchObject({ kind: 'real', tier: 'elite', vrfRound: 4242, status: 'active' });
    expect(events.filter((e) => e.id === '501' && e.event === 'turn_started')).toHaveLength(1);
  });

  test('a chain read failure releases the claim so the next poll retries', async () => {
    const store = new FakeStore();
    store.pending.push({ battleId: 502n, playerA: ALICE, playerB: BOB, teamA: 11n, teamB: 22n });
    let fail = true;
    const chain = chainWith(teams, lobsters);
    const flaky = { ...chain, readTeam: async (id: bigint) => { if (fail) throw new Error('rpc down'); return chain.readTeam(id); } };
    const { mgr, logs } = make(store, { chain: flaky });
    expect(await mgr.pollOnce()).toBe(0);
    expect(store.rows.has('502')).toBe(false);
    expect(logs.some((m) => m.startsWith('battle_session_start_failed'))).toBe(true);
    fail = false;
    expect(await mgr.pollOnce()).toBe(1);
  });

  test('a finished real battle enqueues settle_battle with hashes, per-slot damage and the winner wallet (or draw)', async () => {
    const store = new FakeStore();
    store.pending.push({ battleId: 503n, playerA: ALICE, playerB: BOB, teamA: 11n, teamB: 22n });
    const { mgr, fake, events } = make(store, { chain: chainWith(teams, lobsters), shotClockMs: 1_000 });
    await mgr.pollOnce();
    const s = mgr.get('503')!;
    // Let A play well and B time out until B forfeits (3 timeouts) or the battle otherwise ends.
    for (let guard = 0; guard < 200 && !s.state.finished; guard++) {
      const cur = s.current();
      if (cur.side === 'B') { fake.advance(1_000); continue; }
      const actor = s.state.lobsters.find((l) => l.id === cur.lobsterId)!;
      const r = mgr.submit('503', ALICE, cur.turn, v3.BOTS.aggressive(s.state, actor));
      if (!r.ok) throw new Error(r.message);
    }
    expect(s.state.finished).toBe(true);
    await s.flushed();
    await new Promise((r) => setTimeout(r, 0));
    expect(store.jobs).toHaveLength(1);
    const job = store.jobs[0];
    expect(job.battleId).toBe('503');
    expect(job.winner).toBe(s.state.winner === 'A' ? ALICE : s.state.winner === 'B' ? BOB : 'draw');
    expect(job.finalStateHash).toBe(v3.hashState(s.state));
    expect(job.damageA.every((d) => d >= 5 && d <= 40)).toBe(true);
    expect(store.rows.get('503')!.status).toBe('settling');
    const ended = events.find((e) => e.id === '503' && e.event === 'battle_ended')!;
    expect(ended.data).toMatchObject({ settle: 'queued', reason: 'forfeit' });
    expect(ended.data.damage).toEqual({ damageA: job.damageA, damageB: job.damageB });
  });

  test('resume rebuilds active rows, re-arms the pending clock, drops claims without state, and abandons non-Active real battles', async () => {
    const store = new FakeStore();
    const seedState = v3.createBattle({ battleId: '601', vrfSeed: 5n, tier: 'evolved',
      teamA: [LobsterClass.Kraken, LobsterClass.Reaver, LobsterClass.Ember].map((c, i) => ({ id: `${i + 1}`, class: c, tier: EvolutionTier.Evolved, purity: 0 })),
      teamB: [LobsterClass.Bulwark, LobsterClass.Abyss, LobsterClass.Tempest].map((c, i) => ({ id: `${i + 4}`, class: c, tier: EvolutionTier.Evolved, purity: 0 })) });
    v3.runBattle(seedState, { A: v3.BOTS.balanced, B: v3.BOTS.balanced }, 4);
    const roster = seedState.lobsters.map((l) => ({ id: l.id, side: l.team, slot: l.slot, classId: l.class, tier: l.tier, purity: l.purity, legend: false, owner: l.team === 'A' ? ALICE : BOB }));
    const base = { kind: 'real' as const, playerA: ALICE, playerB: BOB, bot: null, tier: 'evolved', vrfRound: 1, roster, turn: 4, timeouts: { A: 1, B: 0 }, status: 'active' as const };
    await store.insertSession({ ...base, id: '601', stateJson: v3.serializeState(seedState), deadline: new Date(Date.now() + 20_000) });
    await store.insertSession({ ...base, id: '602', stateJson: '', deadline: null }); // dangling claim
    await store.insertSession({ ...base, id: '603', stateJson: v3.serializeState(seedState), deadline: null });
    const phases: Record<string, number> = { '601': 4, '603': 7 };
    const { mgr, events } = make(store, { chain: { ...chainWith({}, {}), readBattlePhase: async (id: bigint) => phases[id.toString()] } });
    const n = await mgr.resume();
    expect(n).toBe(1);
    expect(mgr.get('601')).toBeDefined();
    expect(mgr.get('601')!.timeouts.timeouts).toEqual({ A: 1, B: 0 });
    expect(store.rows.has('602')).toBe(false);
    expect(store.rows.get('603')!.status).toBe('abandoned');
    const started = events.find((e) => e.id === '601' && e.event === 'turn_started')!;
    expect(started.data.turn).toBe(5);
  });
});

describe('arenaTierFor', () => {
  test('uses the lowest tier in the battle; Base plays in the Evolved arena', () => {
    const mk = (tiers: number[]) => tiers.map((t, i) => ({ id: `${i}`, class: LobsterClass.Bulwark, tier: t as EvolutionTier, purity: 0 }));
    expect(arenaTierFor(mk([3, 3, 3, 3, 3, 3]))).toBe('apex');
    expect(arenaTierFor(mk([3, 2, 3, 3, 3, 3]))).toBe('elite');
    expect(arenaTierFor(mk([1, 2, 3, 3, 3, 3]))).toBe('evolved');
    expect(arenaTierFor(mk([0, 0, 0]))).toBe('evolved');
  });
});
