/**
 * The battle WATCHDOG (combat/finalize-watcher.ts): replays every settled result during its
 * review window, freezes (GUARDIAN key) what it cannot reproduce, pays out what it can, and
 * expires a frozen battle the Safe left alone for 72 h. Sessions here are REAL battles played by
 * the engine, so the replay is the real one.
 */
import { describe, test, expect, mock } from 'bun:test';
import { v3, EvolutionTier, LobsterClass } from '@clawbada/game-logic';
import {
  FinalizeWatcher,
  judgeSettlement,
  FREEZE_LONG_STOP_SEC,
  LONG_STOP_WARN_SEC,
  type FinalizeWatcherDeps,
  type OnChainResult,
  type WatchdogSession,
} from '../../combat/finalize-watcher';

const ALICE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ZERO = '0x0000000000000000000000000000000000000000';

// ── a real finished battle, as the API's session manager stores it ──
const classes = { A: [LobsterClass.Reaver, LobsterClass.Kraken, LobsterClass.Ember], B: [LobsterClass.Bulwark, LobsterClass.Abyss, LobsterClass.Tempest] };
const inputs = (side: 'A' | 'B') => classes[side].map((c, i) => ({ id: `${side}${i}`, class: c, tier: EvolutionTier.Evolved, purity: i }));

function playedSession(end: 'wipeout' | 'timeout-forfeit' | 'resign' = 'wipeout', battleId = '7'): { session: WatchdogSession; result: OnChainResult } {
  const cfg = { battleId, vrfSeed: 987654321n, tier: 'evolved' as const, teamA: inputs('A'), teamB: inputs('B') };
  const state = v3.createBattle(cfg);
  if (end === 'wipeout') {
    v3.runBattle(state, { A: v3.BOTS.balanced, B: v3.BOTS.balanced });
  } else if (end === 'resign') {
    v3.reduceSession(state, { timeouts: { A: 0, B: 0 } }, { type: 'resign', team: 'A' });
  } else {
    let clock: v3.SessionClock = { timeouts: { A: 0, B: 0 } };
    while (!state.finished) {
      const actor = v3.nextActor(state)!;
      const stunned = actor.statuses.some((st) => st.type === 'stun');
      const ev: v3.SessionEvent = stunned ? { type: 'stun_skip' } : actor.team === 'B' ? { type: 'timeout' } : { type: 'command', cmd: v3.BOTS.balanced(state, actor) };
      clock = v3.reduceSession(state, clock, ev).clock;
    }
  }
  const roster = (['A', 'B'] as const).flatMap((side) => inputs(side).map((l, slot) => ({ id: l.id, side, slot, classId: l.class, tier: l.tier, purity: l.purity, legend: false, owner: side })));
  const finalStateHash = v3.hashState(state);
  const turnLogHash = v3.turnLogHash(state, [...cfg.teamA, ...cfg.teamB]);
  const dmg = v3.repairDamage(state);
  const forfeitSide = v3.forfeitedSide(state);
  const session: WatchdogSession = {
    id: battleId, tier: 'evolved', roster, stateJson: v3.serializeState(state),
    status: 'settling', winner: state.winner, playerA: ALICE, playerB: BOB, finalStateHash, turnLogHash,
  };
  const wallet = (s: string | null) => (s === 'A' ? ALICE : s === 'B' ? BOB : ZERO);
  const result: OnChainResult = {
    phase: 5, playerA: ALICE, playerB: BOB,
    proposedWinner: state.winner === 'draw' ? ZERO : wallet(state.winner),
    proposedForfeiter: wallet(forfeitSide),
    proposedDamageA: dmg.damageA, proposedDamageB: dmg.damageB,
    finalStateHash, turnLogHash, payoutDeadline: 1_000n, frozenAt: 0,
  };
  return { session, result };
}

const WIPEOUT = playedSession('wipeout');

function makeChain(result: unknown) {
  const proxy: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, ko);
      if (typeof prop === 'symbol') return undefined;
      return () => proxy;
    },
  });
  return proxy;
}

function makeDeps(opts: { onChain: Partial<OnChainResult>; session?: WatchdogSession | null; now: bigint; rows?: Array<{ battleId: bigint }> }) {
  const errors: Array<{ msg: string; fields: any }> = [];
  const warns: Array<{ msg: string; fields: any }> = [];
  const log = { child: () => ({ info: () => {}, debug: () => {}, warn: (fields: any, msg: string) => warns.push({ msg, fields }), error: (fields: any, msg: string) => errors.push({ msg, fields }), fatal: (fields: any, msg: string) => errors.push({ msg, fields }) }) } as any;
  const opWrite = mock(async (req: any) => `0xop_${req.fn}` as `0x${string}`);
  const guardWrite = mock(async (req: any) => `0xguard_${req.fn}` as `0x${string}`);
  const sim = (fn: string) => mock(async (_args: [bigint], _o: { account: unknown }) => ({ request: { fn } }));
  const simulate = { finalizeBattle: sim('finalizeBattle'), freeze: sim('freeze'), expireFrozen: sim('expireFrozen') };
  const onChain = { ...WIPEOUT.result, ...opts.onChain } as OnChainResult;
  const getBattle = mock(async () => onChain);
  const operator = { account: { address: '0x00000000000000000000000000000000000000ee' as `0x${string}` }, writeContract: opWrite };
  const guardian = { account: { address: '0x00000000000000000000000000000000000000ab' as `0x${string}` }, writeContract: guardWrite };
  let clock = 0;
  const deps: FinalizeWatcherDeps = {
    db: { select: () => makeChain(opts.rows ?? [{ battleId: 7n }]) },
    battles: { battleId: 'battle_id', phase: 'phase', settledAt: 'settled_at' },
    readSession: async () => (opts.session === undefined ? WIPEOUT.session : opts.session),
    publicClient: { getBlock: async () => ({ timestamp: opts.now }), waitForTransactionReceipt: mock(async () => ({ status: 'success' })) },
    arena: { read: { getBattle }, simulate },
    walletClient: operator,
    guardianClient: () => guardian,
    log,
    pollMs: 1,
    now: () => clock,
  };
  return { deps, errors, warns, opWrite, guardWrite, simulate, getBattle, guardian, operator, advance: (ms: number) => { clock += ms; } };
}

describe('judgeSettlement (pure)', () => {
  test('the result on-chain IS the battle we ran: clean', () => {
    expect(judgeSettlement(WIPEOUT.session, WIPEOUT.result)).toEqual({ clean: true });
  });

  test('a draw on-chain for a battle that had a winner: not clean', () => {
    const r = judgeSettlement(WIPEOUT.session, { ...WIPEOUT.result, proposedWinner: ZERO });
    expect(r.clean).toBe(false);
  });

  test.each([
    ['winner', { proposedWinner: BOB === WIPEOUT.result.proposedWinner ? ALICE : BOB }],
    ['damageA', { proposedDamageA: [0, 0, 0] }],
    ['damageB', { proposedDamageB: [99, 99, 99] }],
    ['forfeiter', { proposedForfeiter: ALICE }],
  ])('a different %s than the replay: not clean', (_field, patch) => {
    const r = judgeSettlement(WIPEOUT.session, { ...WIPEOUT.result, ...patch } as OnChainResult);
    expect(r.clean).toBe(false);
  });

  test('hashes that are not ours: not clean', () => {
    expect(judgeSettlement(WIPEOUT.session, { ...WIPEOUT.result, turnLogHash: '0x' + 'ee'.repeat(32) }).clean).toBe(false);
  });

  test('no session row / a session still being played: not clean', () => {
    expect(judgeSettlement(null, WIPEOUT.result)).toEqual({ clean: false, reason: 'no_session' });
    expect(judgeSettlement({ ...WIPEOUT.session, status: 'active' }, WIPEOUT.result)).toEqual({ clean: false, reason: 'session_still_active' });
  });

  test('a session whose stored log was doctored (hashes left as recorded): replay fails, not clean', () => {
    const wire = JSON.parse(WIPEOUT.session.stateJson);
    wire.log[0] = { ...wire.log[0], action: 'defend', targetId: undefined, moveTo: undefined };
    const r = judgeSettlement({ ...WIPEOUT.session, stateJson: JSON.stringify(wire) }, WIPEOUT.result);
    expect(r.clean).toBe(false);
    if (!r.clean) expect(r.reason).toStartWith('replay_failed');
  });

  test('timeout forfeit: clean only when the on-chain forfeiter is the player who timed out', () => {
    const f = playedSession('timeout-forfeit');
    expect(f.result.proposedForfeiter).toBe(BOB);
    expect(judgeSettlement(f.session, f.result)).toEqual({ clean: true });
    expect(judgeSettlement(f.session, { ...f.result, proposedForfeiter: ZERO }).clean).toBe(false);
  });

  test('resignation: the resigning player is the forfeiter', () => {
    const r = playedSession('resign');
    expect(r.result.proposedWinner).toBe(BOB);
    expect(r.result.proposedForfeiter).toBe(ALICE);
    expect(judgeSettlement(r.session, r.result)).toEqual({ clean: true });
  });
});

describe('FinalizeWatcher — in review (phase 5)', () => {
  test('clean, review window still open (chain time): no transaction', async () => {
    const d = makeDeps({ onChain: {}, now: 900n });
    await new FinalizeWatcher(d.deps).tick();
    expect(d.opWrite).not.toHaveBeenCalled();
    expect(d.guardWrite).not.toHaveBeenCalled();
  });

  test('clean, window closed: simulates as the operator, submits finalizeBattle once', async () => {
    const d = makeDeps({ onChain: {}, now: 1_001n });
    await new FinalizeWatcher(d.deps).tick();
    expect(d.simulate.finalizeBattle).toHaveBeenCalledTimes(1);
    expect((d.simulate.finalizeBattle.mock.calls as any)[0]).toEqual([[7n], { account: d.operator.account }]);
    expect(d.opWrite).toHaveBeenCalledWith({ fn: 'finalizeBattle' });
    expect(d.guardWrite).not.toHaveBeenCalled();
    expect(d.errors).toHaveLength(0);
  });

  test('mismatch inside the window: FREEZES with the guardian key and logs battle_frozen', async () => {
    const d = makeDeps({ onChain: { proposedDamageA: [1, 1, 1] }, now: 900n });
    await new FinalizeWatcher(d.deps).tick();
    expect(d.simulate.freeze).toHaveBeenCalledTimes(1);
    expect((d.simulate.freeze.mock.calls as any)[0]).toEqual([[7n], { account: d.guardian.account }]);
    expect(d.guardWrite).toHaveBeenCalledWith({ fn: 'freeze' });
    expect(d.opWrite).not.toHaveBeenCalled();
    expect(d.errors.map((e) => e.msg)).toEqual(['battle_frozen']);
    expect(d.errors[0]!.fields).toMatchObject({ battleId: '7', reason: 'replay_mismatch: damageA' });
  });

  test("no session ('no_session', a thief who settled before the server claimed the battle): freezes", async () => {
    const d = makeDeps({ onChain: {}, session: null, now: 900n });
    await new FinalizeWatcher(d.deps).tick();
    expect(d.guardWrite).toHaveBeenCalledTimes(1);
    expect(d.errors[0]!.fields.reason).toBe('no_session');
  });

  test('a result arriving while the server is STILL PLAYING the battle: freezes', async () => {
    const d = makeDeps({ onChain: {}, session: { ...WIPEOUT.session, status: 'active', winner: null, finalStateHash: null, turnLogHash: null }, now: 900n });
    await new FinalizeWatcher(d.deps).tick();
    expect(d.guardWrite).toHaveBeenCalledTimes(1);
    expect(d.errors[0]!.fields.reason).toBe('session_still_active');
  });

  test('mismatch found only after the window closed: never finalizes, pages battle_freeze_missed once', async () => {
    const d = makeDeps({ onChain: { proposedWinner: WIPEOUT.result.proposedWinner === ALICE ? BOB : ALICE }, now: 5_000n });
    const w = new FinalizeWatcher(d.deps);
    await w.tick();
    await w.tick();
    expect(d.opWrite).not.toHaveBeenCalled();
    expect(d.guardWrite).not.toHaveBeenCalled();
    expect(d.errors.filter((e) => e.msg.startsWith('battle_freeze_missed'))).toHaveLength(1);
  });

  test('no guardian key: the freeze fails loudly (fatal), the payout is still never completed', async () => {
    const d = makeDeps({ onChain: { proposedDamageB: [1, 2, 3] }, now: 900n });
    d.deps.guardianClient = () => { throw new Error('GUARDIAN_PRIVATE_KEY not set'); };
    await new FinalizeWatcher(d.deps).tick();
    expect(d.opWrite).not.toHaveBeenCalled();
    expect(d.errors[0]!.msg).toStartWith('battle_freeze_failed');
  });

  test('a benign revert in simulation (someone else finalized) is swallowed; other errors are retried next tick', async () => {
    const a = makeDeps({ onChain: {}, now: 5_000n });
    a.simulate.finalizeBattle.mockRejectedValueOnce(new Error('execution reverted: InvalidBattlePhase(7, 5, 6)'));
    await new FinalizeWatcher(a.deps).tick();
    expect(a.opWrite).not.toHaveBeenCalled();

    const b = makeDeps({ onChain: {}, now: 5_000n });
    b.simulate.finalizeBattle.mockRejectedValueOnce(new Error('connection refused'));
    const w = new FinalizeWatcher(b.deps);
    await w.tick(); // must not throw
    expect(b.opWrite).not.toHaveBeenCalled();
    await w.tick();
    expect(b.opWrite).toHaveBeenCalledTimes(1);
  });

  test('overlapping ticks do not double-send for the same battle', async () => {
    const d = makeDeps({ onChain: {}, now: 5_000n });
    let release!: () => void;
    d.getBattle.mockImplementationOnce(() => new Promise((res) => { release = () => res({ ...WIPEOUT.result }); }));
    const w = new FinalizeWatcher(d.deps);
    const first = w.tick();
    await new Promise((r) => setTimeout(r, 5));
    await w.tick();
    release();
    await first;
    expect(d.opWrite).toHaveBeenCalledTimes(1);
  });

  test('already settled on-chain (indexer lagging): skipped', async () => {
    const d = makeDeps({ onChain: { phase: 6 }, now: 5_000n });
    await new FinalizeWatcher(d.deps).tick();
    expect(d.opWrite).not.toHaveBeenCalled();
    expect(d.guardWrite).not.toHaveBeenCalled();
  });
});

describe('FinalizeWatcher — frozen (phase 8)', () => {
  const FROZEN_AT = 10_000n;

  test('frozen, long-stop far off: pages battle_frozen_awaiting_safe, at most once an hour', async () => {
    const d = makeDeps({ onChain: { phase: 8, frozenAt: FROZEN_AT }, now: FROZEN_AT + 60n });
    const w = new FinalizeWatcher(d.deps);
    await w.tick();
    await w.tick();
    expect(d.errors.map((e) => e.msg)).toEqual(['battle_frozen_awaiting_safe']);
    d.advance(60 * 60_000);
    await w.tick();
    expect(d.errors).toHaveLength(2);
    expect(d.opWrite).not.toHaveBeenCalled();
  });

  test('long-stop within the warning lead: pages battle_freeze_long_stop_due', async () => {
    const d = makeDeps({ onChain: { phase: 8, frozenAt: FROZEN_AT }, now: FROZEN_AT + FREEZE_LONG_STOP_SEC - LONG_STOP_WARN_SEC + 1n });
    await new FinalizeWatcher(d.deps).tick();
    expect(d.errors.map((e) => e.msg)).toEqual(['battle_freeze_long_stop_due']);
    expect(d.opWrite).not.toHaveBeenCalled();
  });

  test('exactly at the long-stop: not yet (the contract needs now > frozenAt + 72 h)', async () => {
    const d = makeDeps({ onChain: { phase: 8, frozenAt: FROZEN_AT }, now: FROZEN_AT + FREEZE_LONG_STOP_SEC });
    await new FinalizeWatcher(d.deps).tick();
    expect(d.simulate.expireFrozen).not.toHaveBeenCalled();
  });

  test('past 72 h and the Safe never acted: expires it (permissionless, operator key)', async () => {
    const d = makeDeps({ onChain: { phase: 8, frozenAt: FROZEN_AT }, now: FROZEN_AT + FREEZE_LONG_STOP_SEC + 1n });
    await new FinalizeWatcher(d.deps).tick();
    expect(d.simulate.expireFrozen).toHaveBeenCalledTimes(1);
    expect((d.simulate.expireFrozen.mock.calls as any)[0]).toEqual([[7n], { account: d.operator.account }]);
    expect(d.opWrite).toHaveBeenCalledWith({ fn: 'expireFrozen' });
    expect(d.guardWrite).not.toHaveBeenCalled();
    expect(d.warns.map((w) => w.msg)[0]).toStartWith('frozen_battle_expired');
  });

  test('somebody else expired it first (benign revert): nothing sent, nothing paged', async () => {
    const d = makeDeps({ onChain: { phase: 8, frozenAt: FROZEN_AT }, now: FROZEN_AT + FREEZE_LONG_STOP_SEC + 1n });
    d.simulate.expireFrozen.mockRejectedValueOnce(new Error('execution reverted: InvalidBattlePhase(7, 8, 6)'));
    await new FinalizeWatcher(d.deps).tick();
    expect(d.opWrite).not.toHaveBeenCalled();
    expect(d.errors).toHaveLength(0);
  });
});
