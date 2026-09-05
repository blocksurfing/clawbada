/**
 * BattleSession runtime: shot clock, bot think, stun skips, forfeit, submit
 * semantics, persistence ordering. Real game-logic; fake clock; captured hooks.
 * Kept in its own file with NO mock.module so the real `@clawbada/game-logic`
 * is used (bun module mocks are process-global).
 */
import { describe, test, expect, mock } from 'bun:test';
// bun module mocks are process-global and test files run in an order we do not
// control: routes/agent.test.ts mocks parts of @clawbada/game-logic (getBaseStats
// as plain numbers, decodeDNA without body parts) and that leaks into later files.
// These tests need the REAL engine, so pin the real module first.
import * as realGameLogic from '../../../../../packages/game-logic/src/index';
mock.module('@clawbada/game-logic', () => ({ ...realGameLogic }));
import { v3, EvolutionTier, LobsterClass } from '@clawbada/game-logic';
import { FakeClock, ShotClock } from '../../lib/battle-session/clock';
import { BattleSession, type PersistedTurn, type SessionRecord, type SnapshotWrite } from '../../lib/battle-session/session';
import type { RosterEntry } from '../../lib/battle-session/protocol';

const ALICE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function inputs(prefix: string, classes: LobsterClass[]): v3.LobsterInput[] {
  return classes.map((c, i) => ({ id: `${prefix}${i}`, class: c, tier: EvolutionTier.Evolved, purity: 1, legend: false }));
}
function roster(a: v3.LobsterInput[], b: v3.LobsterInput[], ownerA: string, ownerB: string): RosterEntry[] {
  return [
    ...a.map((l, i) => ({ id: l.id, side: 'A' as const, slot: i, classId: l.class, tier: l.tier, purity: l.purity, legend: false, owner: ownerA })),
    ...b.map((l, i) => ({ id: l.id, side: 'B' as const, slot: i, classId: l.class, tier: l.tier, purity: l.purity, legend: false, owner: ownerB })),
  ];
}

interface Harness {
  session: BattleSession;
  fake: FakeClock;
  events: { event: string; data: any }[];
  persisted: { turns: PersistedTurn[]; snap: SnapshotWrite }[];
  finished: BattleSession[];
  errors: unknown[];
  ev: (name: string) => any[];
}

function harness(opts: { bot?: v3.BotName; seed?: bigint; shotClockMs?: number; botThinkMs?: number; resume?: { timeouts: Record<'A' | 'B', number>; firstTurnClockMs?: number } } = {}): Harness {
  const fake = new FakeClock();
  const clock = new ShotClock(fake);
  const a = inputs('A', [LobsterClass.Bulwark, LobsterClass.Sentinel, LobsterClass.Reaver]);
  const b = inputs('B', [LobsterClass.Kraken, LobsterClass.Mantis, LobsterClass.Abyss]);
  const bot = opts.bot ?? null;
  const playerB = bot ? `bot:${bot}` : BOB;
  const record: SessionRecord = { id: bot ? 'p_test' : '77', kind: bot ? 'practice' : 'real', tier: 'evolved', playerA: ALICE, playerB, bot, vrfRound: null, roster: roster(a, b, ALICE, playerB), createdAt: new Date(fake.now()) };
  const state = v3.createBattle({ battleId: record.id, vrfSeed: opts.seed ?? 11n, tier: 'evolved', teamA: a, teamB: b });
  const h: Partial<Harness> = { fake, events: [], persisted: [], finished: [], errors: [] };
  const session = new BattleSession(record, state, {
    shotClockMs: opts.shotClockMs ?? 60_000,
    botThinkMs: opts.botThinkMs ?? 800,
    clock,
    botSide: bot ? 'B' : null,
    botPolicy: bot ? v3.botPolicy(bot) : null,
    firstTurnClockMs: opts.resume?.firstTurnClockMs,
    hooks: {
      emit: (_id, event, data) => h.events!.push({ event, data }),
      persist: async (_s, turns, snap) => { h.persisted!.push({ turns, snap }); },
      onFinished: async (s) => { h.finished!.push(s); },
      onError: (err) => h.errors!.push(err),
    },
  }, opts.resume ? { timeouts: opts.resume.timeouts } : undefined);
  h.session = session;
  h.ev = (name) => h.events!.filter((e) => e.event === name).map((e) => e.data);
  return h as Harness;
}

/** Play bot-vs-nothing: advance the human side with legal commands until it is `side`'s turn. */
function playUntil(h: Harness, side: 'A' | 'B'): v3.AtbLobster {
  for (let i = 0; i < 40; i++) {
    const cur = h.session.current();
    if (cur.side === side) return h.session.state.lobsters.find((l) => l.id === cur.lobsterId)!;
    if (cur.controller === 'bot') { h.fake.advance(1000); continue; }
    const actor = h.session.state.lobsters.find((l) => l.id === cur.lobsterId)!;
    const res = h.session.submit(cur.side!, cur.turn, v3.BOTS.balanced(h.session.state, actor));
    if (!res.ok) throw new Error(`playUntil: ${res.code} ${res.message}`);
  }
  throw new Error('playUntil: exhausted');
}

describe('BattleSession — human vs human (real)', () => {
  test('start arms the first human turn, emits turn_started with the deadline, and persists the deadline for resume', async () => {
    const h = harness();
    h.session.start();
    const started = h.ev('turn_started');
    expect(started).toHaveLength(1);
    expect(started[0].turn).toBe(1);
    expect(started[0].deadline).toBe(h.fake.now() + 60_000);
    expect(started[0].controller).toBe(started[0].side === 'A' ? ALICE : BOB);
    expect(h.session.current().turn).toBe(1);
    await h.session.flushed();
    expect(h.persisted).toHaveLength(1); // no turn yet — just the armed deadline, so a restart can resume it
    expect(h.persisted[0].turns).toEqual([]);
    expect(h.persisted[0].snap.deadline?.getTime()).toBe(started[0].deadline);
  });

  test('a legal submit resolves the turn synchronously, emits committed/resolved/bar_updated, persists in order, arms the next turn', async () => {
    const h = harness();
    h.session.start();
    const cur = h.session.current();
    const actor = h.session.state.lobsters.find((l) => l.id === cur.lobsterId)!;
    const res = h.session.submit(cur.side!, 1, { lobsterId: actor.id, action: 'defend' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.duplicate).toBe(false);
    expect(res.result.turn).toBe(1);
    expect(res.result.action).toBe('defend');
    expect(h.ev('turn_committed')[0]).toMatchObject({ turn: 1, lobsterId: actor.id, by: 'player' });
    const resolved = h.ev('turn_resolved')[0];
    expect(resolved.turn).toBe(1);
    expect(resolved.submittedBy).toBe('player');
    expect(resolved.postStateHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(Object.keys(resolved.hp)).toHaveLength(6);
    expect(resolved.nextActorId).toBe(h.session.current().lobsterId);
    expect(h.ev('bar_updated')).toHaveLength(1);
    expect(h.ev('turn_started')).toHaveLength(2);
    await h.session.flushed(); // persistence is queued, never blocks play
    expect(h.persisted).toHaveLength(2); // [start deadline, turn 1]
    const last = h.persisted.at(-1)!;
    expect(last.turns.map((t) => t.turn)).toEqual([1]);
    expect(last.snap.turn).toBe(1);
    expect(last.snap.deadline).toBeInstanceOf(Date);
    expect(JSON.parse(last.snap.stateJson).turn).toBe(1);
  });

  test('illegal commands are rejected without mutating state or touching the clock', () => {
    const h = harness();
    h.session.start();
    const cur = h.session.current();
    const before = v3.hashState(h.session.state);
    const bad = h.session.submit(cur.side!, 1, { lobsterId: cur.lobsterId!, action: 'attack', targetId: 'nobody' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('bad_target');
    expect(v3.hashState(h.session.state)).toBe(before);
    expect(h.ev('turn_resolved')).toHaveLength(0);
    // Wrong side, wrong turn numbers.
    const other = cur.side === 'A' ? 'B' : 'A';
    expect((h.session.submit(other, 1, { lobsterId: cur.lobsterId!, action: 'defend' }) as any).code).toBe('not_your_turn');
    expect((h.session.submit(cur.side!, 2, { lobsterId: cur.lobsterId!, action: 'defend' }) as any).code).toBe('turn_mismatch');
    expect((h.session.submit(cur.side!, 0, { lobsterId: cur.lobsterId!, action: 'defend' }) as any).code).toBe('turn_mismatch');
  });

  test('re-submitting an applied turn is acknowledged as a duplicate, not replayed', () => {
    const h = harness();
    h.session.start();
    const cur = h.session.current();
    const cmd = { lobsterId: cur.lobsterId!, action: 'defend' as const };
    const first = h.session.submit(cur.side!, 1, cmd);
    const again = h.session.submit(cur.side!, 1, cmd);
    expect(first.ok && again.ok).toBe(true);
    if (again.ok) { expect(again.duplicate).toBe(true); expect(again.result).toEqual((first as any).result); }
    expect(h.ev('turn_resolved')).toHaveLength(1);
    expect(h.session.state.turn).toBe(1);
  });

  test('shot-clock expiry auto-Defends and counts against that player; the next turn is armed', async () => {
    const h = harness({ shotClockMs: 30_000 });
    h.session.start();
    const cur = h.session.current();
    h.fake.advance(29_999);
    expect(h.ev('turn_resolved')).toHaveLength(0);
    h.fake.advance(1);
    const resolved = h.ev('turn_resolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0].submittedBy).toBe('timeout');
    expect(resolved[0].result.action).toBe('defend');
    expect(h.session.timeouts.timeouts[cur.side!]).toBe(1);
    expect(h.ev('turn_started')).toHaveLength(2);
    await h.session.flushed();
    expect(h.persisted.at(-1)!.snap.timeouts[cur.side!]).toBe(1);
  });

  test('three consecutive timeouts by the same player forfeit; battle_ended is left to the finish hook; persistence includes the forfeit row', async () => {
    const h = harness({ shotClockMs: 10_000 });
    h.session.start();
    let forfeited: 'A' | 'B' | null = null;
    // Alternate: let the other side play, time the target side out three times.
    const target = h.session.current().side!;
    for (let guard = 0; guard < 60 && !h.session.state.finished; guard++) {
      const cur = h.session.current();
      if (cur.side === target) { h.fake.advance(10_000); }
      else {
        const actor = h.session.state.lobsters.find((l) => l.id === cur.lobsterId)!;
        const r = h.session.submit(cur.side!, cur.turn, v3.BOTS.balanced(h.session.state, actor));
        if (!r.ok) throw new Error(r.message);
      }
      if (h.session.state.finished) forfeited = target;
    }
    expect(forfeited).toBe(target);
    expect(h.session.status).toBe('finished');
    expect(h.session.state.winner).toBe(target === 'A' ? 'B' : 'A');
    expect(h.session.state.log.at(-1)).toMatchObject({ action: 'forfeit', loser: target });
    const lastResolved = h.ev('turn_resolved').at(-1);
    expect(lastResolved.submittedBy).toBe('forfeit');
    expect(lastResolved.result.finished).toBe(true);
    await h.session.flushed();
    expect(h.finished).toHaveLength(1);
    const allTurns = h.persisted.flatMap((p) => p.turns);
    expect(allTurns.at(-1)!.submittedBy).toBe('forfeit');
    // Forfeit row gets its own turn slot (no PK collision with the last real turn).
    const turns = allTurns.map((t) => t.turn);
    expect(new Set(turns).size).toBe(turns.length);
    expect(h.fake.pendingCount()).toBe(0); // clock cancelled
  });

  test('an accepted command resets that player\'s timeout counter', () => {
    const h = harness({ shotClockMs: 10_000 });
    h.session.start();
    const side = h.session.current().side!;
    h.fake.advance(10_000);
    expect(h.session.timeouts.timeouts[side]).toBe(1);
    const actor = playUntil(h, side);
    const r = h.session.submit(side, h.session.current().turn, { lobsterId: actor.id, action: 'defend' });
    expect(r.ok).toBe(true);
    expect(h.session.timeouts.timeouts[side]).toBe(0);
  });

  test('snapshot strips the seed and reports the current turn, controller and deadline', () => {
    const h = harness();
    h.session.start();
    const snap = h.session.snapshot();
    expect((snap.state as any).vrfSeed).toBeUndefined();
    expect(snap.session).toMatchObject({ id: '77', kind: 'real', playerA: ALICE, playerB: BOB, status: 'active' });
    expect(snap.current.turn).toBe(1);
    expect(snap.current.deadline).toBe(h.fake.now() + 60_000);
    expect(snap.roster).toHaveLength(6);
    expect(snap.timeouts).toEqual({ A: 0, B: 0 });
  });
});

describe('BattleSession — practice vs bot', () => {
  test('the bot acts after the think delay, never gets a shot clock, and play alternates', () => {
    const h = harness({ bot: 'balanced', botThinkMs: 800 });
    h.session.start();
    // Whoever is first: if it is the bot, its turn_started has no deadline.
    const first = h.ev('turn_started')[0];
    if (first.controller === 'bot') {
      expect(first.deadline).toBeNull();
      expect(h.ev('turn_resolved')).toHaveLength(0);
      h.fake.advance(799);
      expect(h.ev('turn_resolved')).toHaveLength(0);
      h.fake.advance(1);
      expect(h.ev('turn_resolved')).toHaveLength(1);
      expect(h.ev('turn_resolved')[0].submittedBy).toBe('bot');
    }
    // A human cannot submit for the bot's side.
    const r = h.session.submit('B', h.session.current().turn, { lobsterId: 'B0', action: 'defend' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['bot_controlled', 'not_your_turn']).toContain(r.code);
    // Play a few of the human's turns; the bot keeps responding.
    for (let i = 0; i < 6; i++) {
      const actor = playUntil(h, 'A');
      const res = h.session.submit('A', h.session.current().turn, v3.BOTS.balanced(h.session.state, actor));
      expect(res.ok).toBe(true);
    }
    expect(h.session.state.turn).toBeGreaterThanOrEqual(6);
    expect(h.errors).toHaveLength(0);
  });

  test('a full practice battle vs the bot finishes and fires the finish hook once', async () => {
    const h = harness({ bot: 'aggressive', botThinkMs: 100, shotClockMs: 5_000 });
    h.session.start();
    for (let guard = 0; guard < 400 && !h.session.state.finished; guard++) {
      const cur = h.session.current();
      if (cur.controller === 'bot') { h.fake.advance(100); continue; }
      const actor = h.session.state.lobsters.find((l) => l.id === cur.lobsterId)!;
      const r = h.session.submit('A', cur.turn, v3.BOTS.aggressive(h.session.state, actor));
      if (!r.ok) throw new Error(r.message);
    }
    expect(h.session.state.finished).toBe(true);
    await h.session.flushed();
    expect(h.finished).toHaveLength(1);
    expect(h.session.current().turn).toBe(0);
    // Every applied turn was persisted exactly once, in order.
    const turns = h.persisted.flatMap((p) => p.turns.map((t) => t.turn));
    expect(turns).toEqual([...turns].sort((a, b) => a - b));
    expect(new Set(turns).size).toBe(turns.length);
    expect(turns.length).toBe(h.session.state.log.length);
  });
});

describe('BattleSession — resume', () => {
  test('a resumed session honours the first-turn clock override and the saved timeout counters', () => {
    const h = harness({ resume: { timeouts: { A: 2, B: 0 }, firstTurnClockMs: 7_000 } });
    h.session.start();
    expect(h.session.timeouts.timeouts).toEqual({ A: 2, B: 0 });
    expect(h.ev('turn_started')[0].deadline).toBe(h.fake.now() + 7_000);
    h.fake.advance(7_000);
    expect(h.ev('turn_resolved')).toHaveLength(1);
    // The override applies once: the next human turn gets the full clock.
    const next = h.ev('turn_started').at(-1);
    expect(next.deadline).toBe(h.fake.now() + 60_000);
  });
});
