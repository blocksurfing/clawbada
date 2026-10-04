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
  GUARDIAN_ROLE,
  MIN_GUARDIAN_BALANCE_WEI,
  LOG_LOOKBACK_BLOCKS,
  OVERDUE_TICKS,
  JUDGE_GRACE_SEC,
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
    finalStateHash, turnLogHash, phaseDeadline: 0n, payoutDeadline: 1_000n, frozenAt: 0,
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

const HEAD_BLOCK = 10_000n;

function makeDeps(opts: {
  onChain: Partial<OnChainResult>;
  /** Per-battle overrides on top of `onChain` (for multi-battle ticks). */
  onChainById?: Record<string, Partial<OnChainResult>>;
  session?: WatchdogSession | null;
  now: bigint;
  rows?: Array<{ battleId: bigint }>;
  /** Battle ids the RPC's BattleProposed / BattleFrozen logs name (M4 second source). */
  logIds?: bigint[];
}) {
  const errors: Array<{ msg: string; fields: any }> = [];
  const warns: Array<{ msg: string; fields: any }> = [];
  const infos: Array<{ msg: string; fields: any }> = [];
  const log = {
    child: () => ({
      info: (fields: any, msg: string) => infos.push({ msg, fields }),
      debug: () => {},
      warn: (fields: any, msg: string) => warns.push({ msg, fields }),
      error: (fields: any, msg: string) => errors.push({ msg, fields }),
      fatal: (fields: any, msg: string) => errors.push({ msg, fields }),
    }),
  } as any;
  /** Every writeContract, in order, across both signers. */
  const writes: Array<{ signer: 'op' | 'guard'; fn: string; battleId: bigint }> = [];
  const opWrite = mock(async (req: any) => { writes.push({ signer: 'op', fn: req.fn, battleId: req.battleId }); return `0xop_${req.fn}` as `0x${string}`; });
  const guardWrite = mock(async (req: any) => { writes.push({ signer: 'guard', fn: req.fn, battleId: req.battleId }); return `0xguard_${req.fn}` as `0x${string}`; });
  const sim = (fn: string) => mock(async (args: [bigint], _o: { account: unknown }) => ({ request: { fn, battleId: args[0] } }));
  const simulate = { finalizeBattle: sim('finalizeBattle'), freeze: sim('freeze'), expireFrozen: sim('expireFrozen'), handleTimeout: sim('handleTimeout') };
  const onChain = { ...WIPEOUT.result, ...opts.onChain } as OnChainResult;
  const getBattle = mock(async ([id]: [bigint]) => ({ ...onChain, ...(opts.onChainById?.[id.toString()] ?? {}) }) as OnChainResult);
  const readRecentReviewLogs = mock(async (_from: bigint, _to: bigint) => opts.logIds ?? []);
  const hasRole = mock(async (_args: [`0x${string}`, `0x${string}`]) => true);
  const getBalance = mock(async (_args: { address: `0x${string}` }) => MIN_GUARDIAN_BALANCE_WEI * 10n);
  const operator = { account: { address: '0x00000000000000000000000000000000000000ee' as `0x${string}` }, writeContract: opWrite };
  const guardian = { account: { address: '0x00000000000000000000000000000000000000ab' as `0x${string}` }, writeContract: guardWrite };
  let clock = 0;
  const deps: FinalizeWatcherDeps = {
    db: { select: () => makeChain(opts.rows ?? [{ battleId: 7n }]) },
    battles: { battleId: 'battle_id', phase: 'phase', settledAt: 'settled_at' },
    readSession: mock(async () => (opts.session === undefined ? WIPEOUT.session : opts.session)),
    readRecentReviewLogs,
    publicClient: {
      getBlock: async () => ({ timestamp: opts.now, number: HEAD_BLOCK }),
      getBalance,
      waitForTransactionReceipt: mock(async () => ({ status: 'success' })),
    },
    arena: { read: { getBattle, hasRole }, simulate },
    walletClient: operator,
    guardianClient: () => guardian,
    log,
    pollMs: 1,
    now: () => clock,
  };
  return { deps, errors, warns, infos, writes, opWrite, guardWrite, simulate, getBattle, hasRole, getBalance, readRecentReviewLogs, guardian, operator, advance: (ms: number) => { clock += ms; } };
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
    const w = new FinalizeWatcher(d.deps);
    await w.tick();
    await w.drain();
    expect(d.simulate.finalizeBattle).toHaveBeenCalledTimes(1);
    expect((d.simulate.finalizeBattle.mock.calls as any)[0]).toEqual([[7n], { account: d.operator.account }]);
    expect(d.opWrite).toHaveBeenCalledWith({ fn: 'finalizeBattle', battleId: 7n });
    expect(d.guardWrite).not.toHaveBeenCalled();
    expect(d.errors).toHaveLength(0);
  });

  test('mismatch inside the window: FREEZES with the guardian key and logs battle_frozen', async () => {
    const d = makeDeps({ onChain: { proposedDamageA: [1, 1, 1] }, now: 900n });
    await new FinalizeWatcher(d.deps).tick();
    expect(d.simulate.freeze).toHaveBeenCalledTimes(1);
    expect((d.simulate.freeze.mock.calls as any)[0]).toEqual([[7n], { account: d.guardian.account }]);
    expect(d.guardWrite).toHaveBeenCalledWith({ fn: 'freeze', battleId: 7n });
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

  test('M3: a freeze the guardian cannot send (role revert, gas, RPC) is a fatal battle_freeze_failed on EVERY attempt, and the tick goes on', async () => {
    const d = makeDeps({
      onChain: { proposedDamageB: [1, 2, 3] },
      onChainById: { 8: { ...WIPEOUT.result, payoutDeadline: 500n } }, // a second, clean battle past its deadline
      rows: [{ battleId: 7n }, { battleId: 8n }],
      now: 900n,
    });
    const w = new FinalizeWatcher(d.deps);
    d.simulate.freeze.mockRejectedValueOnce(new Error('AccessControlUnauthorizedAccount(0x..ab, 0x55..)'));
    await w.tick();
    d.simulate.freeze.mockRejectedValueOnce(new Error('insufficient funds for gas * price + value'));
    await w.tick();
    d.guardWrite.mockRejectedValueOnce(new Error('connection refused'));
    await w.tick();
    const failed = d.errors.filter((e) => e.msg.startsWith('battle_freeze_failed'));
    expect(failed).toHaveLength(3);
    expect(failed.map((e) => String(e.fields.err))).toEqual([
      expect.stringContaining('AccessControlUnauthorizedAccount'),
      expect.stringContaining('insufficient funds'),
      expect.stringContaining('connection refused'),
    ]);
    expect(failed[0]!.fields).toMatchObject({ battleId: '7', reason: 'replay_mismatch: damageB', guardian: d.guardian.account.address });
    // Never surfaced as the generic step failure, and the other battle was still paid out.
    expect(d.errors.filter((e) => e.msg.startsWith('watchdog step failed'))).toHaveLength(0);
    expect(d.writes[0]).toEqual({ signer: 'op', fn: 'finalizeBattle', battleId: 8n }); // (the stub keeps 8 in phase 5, so it is re-sent each tick)
    // Fourth attempt succeeds: frozen.
    await w.tick();
    expect(d.errors.map((e) => e.msg).at(-1)).toBe('battle_frozen');
  });

  test('M3: a freeze transaction that lands but REVERTS is also battle_freeze_failed', async () => {
    const d = makeDeps({ onChain: { proposedDamageB: [1, 2, 3] }, now: 900n });
    (d.deps.publicClient.waitForTransactionReceipt as any).mockResolvedValueOnce({ status: 'reverted' });
    const w = new FinalizeWatcher(d.deps);
    await w.tick();
    await w.drain();
    expect(d.errors.map((e) => e.msg).sort()).toEqual([expect.stringContaining('battle_freeze_failed'), 'battle_frozen']);
    expect(d.errors.find((e) => e.msg.startsWith('battle_freeze_failed'))!.fields).toMatchObject({ battleId: '7', tx: '0xguard_freeze', status: 'reverted' });
  });

  test('M2b: a judge that THROWS is not clean — frozen with judge_threw, not retried', async () => {
    // v3.reproduceSession reports what it can (`replay_failed: …`); a crash anywhere else in the judge
    // (here: the session row blows up when the replay reads it) must land in the same place.
    const session = { ...WIPEOUT.session };
    Object.defineProperty(session, 'stateJson', { get() { throw new Error('column vanished'); } });
    const d = makeDeps({ onChain: {}, session, now: 900n });
    await new FinalizeWatcher(d.deps).tick();
    expect(d.guardWrite).toHaveBeenCalledTimes(1);
    expect(d.opWrite).not.toHaveBeenCalled();
    expect(d.errors.map((e) => e.msg)).toEqual(['battle_frozen']);
    expect(d.errors[0]!.fields.reason).toStartWith('judge_threw: ');
  });

  test('a session read that fails (the DB, not the replay) is retried while the window has time, and fails CLOSED at its edge', async () => {
    const d = makeDeps({ onChain: {}, now: 1_000n - JUDGE_GRACE_SEC - 1n });
    (d.deps.readSession as any).mockRejectedValue(new Error('ECONNRESET'));
    const w = new FinalizeWatcher(d.deps);
    await w.tick();
    expect(d.guardWrite).not.toHaveBeenCalled();
    expect(d.errors.map((e) => e.msg)).toEqual([expect.stringContaining('watchdog step failed')]);

    const e = makeDeps({ onChain: {}, now: 1_000n - JUDGE_GRACE_SEC });
    (e.deps.readSession as any).mockRejectedValue(new Error('ECONNRESET'));
    await new FinalizeWatcher(e.deps).tick();
    expect(e.guardWrite).toHaveBeenCalledTimes(1);
    expect(e.errors[0]!.fields.reason).toStartWith('judge_threw: session read failed');
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

  test('C-L1: a battle whose transaction is still unconfirmed is left alone until the receipt arrives', async () => {
    const d = makeDeps({ onChain: {}, now: 5_000n });
    let settle!: () => void;
    (d.deps.publicClient.waitForTransactionReceipt as any).mockImplementationOnce(() => new Promise<{ status: string }>((res) => { settle = () => res({ status: 'success' }); }));
    const w = new FinalizeWatcher(d.deps);
    await w.tick(); // sends; the receipt is NOT awaited inline
    await w.tick(); // skipped: receipt pending
    expect(d.opWrite).toHaveBeenCalledTimes(1);
    settle();
    await w.drain();
    await w.tick(); // phase 5 still (stub): sends again
    expect(d.opWrite).toHaveBeenCalledTimes(2);
  });

  test('already settled on-chain (indexer lagging): skipped', async () => {
    const d = makeDeps({ onChain: { phase: 6 }, now: 5_000n });
    await new FinalizeWatcher(d.deps).tick();
    expect(d.opWrite).not.toHaveBeenCalled();
    expect(d.guardWrite).not.toHaveBeenCalled();
  });
});

describe('FinalizeWatcher — sources, ordering and heartbeat', () => {
  test('M4: a battle the indexer never mirrored but the chain logged (BattleProposed) is judged — and frozen', async () => {
    const d = makeDeps({ onChain: {}, session: null, rows: [], logIds: [7n], now: 900n });
    await new FinalizeWatcher(d.deps).tick();
    expect(d.readRecentReviewLogs).toHaveBeenCalledWith(HEAD_BLOCK - LOG_LOOKBACK_BLOCKS, HEAD_BLOCK);
    expect(d.guardWrite).toHaveBeenCalledTimes(1);
    expect(d.errors[0]!).toMatchObject({ msg: 'battle_frozen', fields: { battleId: '7', reason: 'no_session' } });
  });

  test('the two sources are merged by battle id (no double processing), and the heartbeat counts them', async () => {
    const d = makeDeps({ onChain: {}, rows: [{ battleId: 7n }], logIds: [7n, 9n], onChainById: { 9: { phase: 6 } }, now: 900n });
    await new FinalizeWatcher(d.deps).tick();
    expect(d.getBattle).toHaveBeenCalledTimes(2);
    const hb = d.infos.find((i) => i.msg === 'watchdog_heartbeat')!;
    expect(hb.fields).toMatchObject({ tick: 1, rows: 2, dbRows: 1, fromLogsOnly: 1 });
  });

  test('the heartbeat is logged every tick, even with nothing to do, and the DB being down does not stop the chain source', async () => {
    const d = makeDeps({ onChain: {}, rows: [], now: 900n });
    const w = new FinalizeWatcher(d.deps);
    await w.tick();
    await w.tick();
    expect(d.infos.filter((i) => i.msg === 'watchdog_heartbeat').map((i) => i.fields.tick)).toEqual([1, 2]);

    const e = makeDeps({ onChain: {}, session: null, logIds: [7n], now: 900n });
    e.deps.db = { select: () => { throw new Error('db down'); } };
    await new FinalizeWatcher(e.deps).tick();
    expect(e.errors.map((x) => x.msg)).toEqual([expect.stringContaining('watchdog_db_source_failed'), 'battle_frozen']);
  });

  test('C-L1: results are judged earliest payoutDeadline first, and every freeze goes out before any payout', async () => {
    // 7: clean, deadline 1_000 (closed) → payout. 8 and 9: unclean, deadlines 3_000 and 2_000 (open) → freeze 9 then 8.
    const d = makeDeps({
      onChain: {},
      rows: [{ battleId: 7n }, { battleId: 8n }, { battleId: 9n }],
      onChainById: { 8: { payoutDeadline: 3_000n, proposedDamageA: [1, 1, 1] }, 9: { payoutDeadline: 2_000n, proposedDamageA: [2, 2, 2] } },
      now: 1_500n,
    });
    await new FinalizeWatcher(d.deps).tick();
    expect(d.writes.map((x) => `${x.fn}:${x.battleId}`)).toEqual(['freeze:9', 'freeze:8', 'finalizeBattle:7']);
  });

  test('C-L2: a clean battle still unfinalized OVERDUE_TICKS ticks after its deadline pages finalize_overdue (hourly)', async () => {
    const d = makeDeps({ onChain: {}, now: 5_000n });
    const w = new FinalizeWatcher(d.deps);
    for (let i = 0; i < OVERDUE_TICKS; i++) {
      d.simulate.finalizeBattle.mockRejectedValueOnce(new Error('connection refused'));
      await w.tick();
    }
    expect(d.errors.filter((e) => e.msg === 'finalize_overdue')).toHaveLength(0);
    d.simulate.finalizeBattle.mockRejectedValueOnce(new Error('connection refused'));
    await w.tick();
    await w.tick();
    const overdue = d.errors.filter((e) => e.msg === 'finalize_overdue');
    expect(overdue).toHaveLength(1);
    expect(overdue[0]!.fields).toMatchObject({ battleId: '7', ticksPastDeadline: OVERDUE_TICKS + 1 });
  });
});

describe('FinalizeWatcher — lapsed battles (L3 sweep)', () => {
  test.each([
    [1, 'battle_timed_out_by_watchdog'],
    [3, 'battle_timed_out_by_watchdog'],
    [4, 'battle_timed_out_by_watchdog'],
  ])('phase %i past its phaseDeadline: handleTimeout with the operator key', async (phase, msg) => {
    const d = makeDeps({ onChain: { phase, phaseDeadline: 800n }, now: 801n });
    await new FinalizeWatcher(d.deps).tick();
    expect(d.simulate.handleTimeout).toHaveBeenCalledTimes(1);
    expect((d.simulate.handleTimeout.mock.calls as any)[0]).toEqual([[7n], { account: d.operator.account }]);
    expect(d.opWrite).toHaveBeenCalledWith({ fn: 'handleTimeout', battleId: 7n });
    const logged = [...d.infos, ...d.warns].find((l) => l.msg === msg)!;
    expect(logged.fields).toMatchObject({ battleId: '7', phase, tx: '0xop_handleTimeout' });
  });

  test('deadline not yet passed (chain time), or exactly at it: nothing sent', async () => {
    const d = makeDeps({ onChain: { phase: 1, phaseDeadline: 800n }, now: 800n });
    await new FinalizeWatcher(d.deps).tick();
    expect(d.simulate.handleTimeout).not.toHaveBeenCalled();
  });

  test('PhaseNotTimedOut / BattleDoesNotExist from the simulation are benign (nothing sent, nothing paged)', async () => {
    const d = makeDeps({ onChain: { phase: 4, phaseDeadline: 800n }, now: 801n });
    d.simulate.handleTimeout.mockRejectedValueOnce(new Error('execution reverted: PhaseNotTimedOut(7)'));
    const w = new FinalizeWatcher(d.deps);
    await w.tick();
    d.simulate.handleTimeout.mockRejectedValueOnce(new Error('execution reverted: BattleDoesNotExist(7)'));
    await w.tick();
    expect(d.opWrite).not.toHaveBeenCalled();
    expect(d.errors).toHaveLength(0);
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
    expect(d.opWrite).toHaveBeenCalledWith({ fn: 'expireFrozen', battleId: 7n });
    expect(d.guardWrite).not.toHaveBeenCalled();
    expect(d.warns.map((w) => w.msg)[0]).toStartWith('frozen_battle_expired');
  });

  test('somebody else expired it first (benign revert, no longer frozen on re-read): nothing sent, nothing paged', async () => {
    const d = makeDeps({ onChain: { phase: 8, frozenAt: FROZEN_AT }, now: FROZEN_AT + FREEZE_LONG_STOP_SEC + 1n });
    d.simulate.expireFrozen.mockRejectedValueOnce(new Error('execution reverted: InvalidBattlePhase(7, 8, 6)'));
    d.getBattle
      .mockResolvedValueOnce({ ...WIPEOUT.result, phase: 8, frozenAt: FROZEN_AT })
      .mockResolvedValueOnce({ ...WIPEOUT.result, phase: 7, frozenAt: FROZEN_AT }); // re-read: cancelled
    await new FinalizeWatcher(d.deps).tick();
    expect(d.opWrite).not.toHaveBeenCalled();
    expect(d.errors).toHaveLength(0);
  });

  test('C-L2: still frozen past the long-stop — keeps paging hourly, and expire_failed after OVERDUE_TICKS failed attempts', async () => {
    const d = makeDeps({ onChain: { phase: 8, frozenAt: FROZEN_AT }, now: FROZEN_AT + FREEZE_LONG_STOP_SEC + 1n });
    const w = new FinalizeWatcher(d.deps);
    for (let i = 0; i <= OVERDUE_TICKS; i++) {
      d.simulate.expireFrozen.mockRejectedValueOnce(new Error('execution reverted: LongStopNotReached(7, 1)'));
      await w.tick();
    }
    const msgs = d.errors.map((e) => e.msg);
    expect(msgs.filter((m) => m === 'battle_freeze_long_stop_due')).toHaveLength(1); // hourly
    expect(msgs.filter((m) => m === 'expire_failed')).toHaveLength(1);
    expect(d.errors.find((e) => e.msg === 'expire_failed')!.fields).toMatchObject({ battleId: '7', ticksPastLongStop: OVERDUE_TICKS + 1 });
    d.advance(60 * 60_000);
    d.simulate.expireFrozen.mockRejectedValueOnce(new Error('connection refused'));
    await w.tick();
    expect(d.errors.map((e) => e.msg).filter((m) => m === 'battle_freeze_long_stop_due')).toHaveLength(2);
  });
});

describe('FinalizeWatcher — guardian preflight (M3)', () => {
  test('role held and funded: guardian_preflight_ok', async () => {
    const d = makeDeps({ onChain: {}, now: 0n });
    expect(await new FinalizeWatcher(d.deps).preflight()).toBe(true);
    expect(d.hasRole).toHaveBeenCalledWith([GUARDIAN_ROLE, d.guardian.account.address]);
    expect(d.getBalance).toHaveBeenCalledWith({ address: d.guardian.account.address });
    expect(d.infos.map((i) => i.msg)).toContain('guardian_preflight_ok');
    expect(d.errors).toHaveLength(0);
  });

  test('GUARDIAN_ROLE not granted to the key: fatal guardian_preflight_failed', async () => {
    const d = makeDeps({ onChain: {}, now: 0n });
    d.hasRole.mockResolvedValueOnce(false);
    expect(await new FinalizeWatcher(d.deps).preflight()).toBe(false);
    expect(d.errors[0]!.msg).toStartWith('guardian_preflight_failed');
    expect(d.errors[0]!.fields.problems).toEqual([expect.stringContaining('GUARDIAN_ROLE')]);
  });

  test('balance below the minimum: fatal guardian_preflight_failed', async () => {
    const d = makeDeps({ onChain: {}, now: 0n });
    d.getBalance.mockResolvedValueOnce(MIN_GUARDIAN_BALANCE_WEI - 1n);
    expect(await new FinalizeWatcher(d.deps).preflight()).toBe(false);
    expect(d.errors[0]!.fields.problems).toEqual([expect.stringContaining('below')]);
  });

  test('no guardian key / RPC down: fatal, never throws', async () => {
    const a = makeDeps({ onChain: {}, now: 0n });
    a.deps.guardianClient = () => { throw new Error('GUARDIAN_PRIVATE_KEY not set'); };
    expect(await new FinalizeWatcher(a.deps).preflight()).toBe(false);
    expect(a.errors[0]!.msg).toStartWith('guardian_preflight_failed');

    const b = makeDeps({ onChain: {}, now: 0n });
    b.hasRole.mockRejectedValueOnce(new Error('connection refused'));
    expect(await new FinalizeWatcher(b.deps).preflight()).toBe(false);
    expect(b.errors[0]!.msg).toStartWith('guardian_preflight_failed');
  });

  test('start() runs the preflight at once (and the tick loop); stop() clears both timers', async () => {
    const d = makeDeps({ onChain: {}, now: 0n, rows: [] });
    const w = new FinalizeWatcher(d.deps);
    w.start();
    await new Promise((r) => setTimeout(r, 10));
    w.stop();
    expect(d.hasRole).toHaveBeenCalledTimes(1);
    expect(d.infos.map((i) => i.msg)).toContain('guardian_preflight_ok');
  });
});
