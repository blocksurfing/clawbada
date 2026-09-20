import { describe, test, expect } from 'bun:test';
import { v3 } from '@clawbada/game-logic';
import { SettleReconciler, isRevivable, payloadFromSession, type SettleReconcilerDeps } from '../../operator/settle-reconciler';
import { JobStatus } from '../../operator/types';

const SESSIONS = { __t: 'sessions', id: 'id', playerA: 'a', playerB: 'b', winner: 'w', finalStateHash: 'f', turnLogHash: 't', stateJson: 's', updatedAt: 'u', status: 'st', kind: 'k' };
const JOBS = { __t: 'jobs', id: 'id', status: 'status', lastError: 'le', idempotencyKey: 'ik' };

const PLAYER_A = '0x00000000000000000000000000000000000000aa';
const PLAYER_B = '0x00000000000000000000000000000000000000bb';
const HASH_1 = '0x' + '11'.repeat(32);
const HASH_2 = '0x' + '22'.repeat(32);
const NOW = 10_000_000;
const CHAIN_NOW = 5_000n;

/** A real engine state, so the rebuilt damage is the engine's own number, not a stub's. */
function stateJson(): string {
  const team = (side: string) => [0, 1, 2].map((i) => ({ id: `${side}${i}`, class: i, tier: 1, purity: 0 })) as any;
  const state = v3.createBattle({ battleId: '42', vrfSeed: 7n, tier: 'evolved', teamA: team('A'), teamB: team('B') } as any);
  v3.runBattle(state, { A: v3.BOTS.aggressive, B: v3.BOTS.aggressive }); // played to the end, like a real settling session
  return v3.serializeState(state);
}
const STATE_JSON = stateJson();

function session(over: Partial<Record<string, unknown>> = {}) {
  return { id: '42', playerA: PLAYER_A, playerB: PLAYER_B, winner: 'A', finalStateHash: HASH_1, turnLogHash: HASH_2, stateJson: STATE_JSON, updatedAt: new Date(NOW - 5 * 60_000), ...over };
}

function makeDeps(opts: { sessions: any[]; job?: { id: bigint; status: number; lastError: string | null }; chain?: { phase: number; phaseDeadline: bigint }; alarmAfterMs?: number }) {
  const inserted: any[] = [];
  const updated: any[] = [];
  const logs: Array<{ level: string; msg: string; fields: any }> = [];
  const mk = (level: string) => (fields: any, msg: string) => logs.push({ level, msg, fields });
  const logger = { child: () => ({ info: mk('info'), warn: mk('warn'), error: mk('error'), debug: mk('debug') }) } as any;

  const thenable = (rows: any[]) => {
    const p: any = { where: () => p, limit: () => p, then: (ok: any, ko: any) => Promise.resolve(rows).then(ok, ko) };
    return p;
  };
  const db = {
    select: () => ({ from: (t: any) => thenable(t.__t === 'sessions' ? opts.sessions : opts.job ? [opts.job] : []) }),
    insert: () => ({ values: (v: any) => ({ onConflictDoNothing: async () => void inserted.push(v) }) }),
    update: () => ({ set: (v: any) => ({ where: async () => void updated.push(v) }) }),
  };
  const deps: SettleReconcilerDeps = {
    db,
    battleSessions: SESSIONS,
    operatorJobs: JOBS,
    publicClient: { getBlock: async () => ({ timestamp: CHAIN_NOW }) },
    arena: { read: { getBattle: async () => opts.chain ?? { phase: 4, phaseDeadline: CHAIN_NOW + 7_200n } } },
    log: logger,
    now: () => NOW,
    alarmAfterMs: opts.alarmAfterMs,
  };
  return { deps, inserted, updated, logs };
}

describe('isRevivable', () => {
  test('exhausted transient retries and a lost tx hash are revivable', () => {
    expect(isRevivable('max_attempts_exceeded: fetch failed')).toBe(true);
    expect(isRevivable('tx_hash_persist_failed: hash=0xabc cause=db down')).toBe(true);
    expect(isRevivable('revived: max_attempts_exceeded: fetch failed')).toBe(true);
  });
  test('a permanent verdict is never revivable', () => {
    expect(isRevivable('revert:InvalidSettlementHash')).toBe(false);
    expect(isRevivable('battle_not_active:phase=7')).toBe(false);
    expect(isRevivable('settle_battle: bad winner')).toBe(false);
    expect(isRevivable('settle_reverted')).toBe(false);
    expect(isRevivable(null)).toBe(false);
  });
});

describe('payloadFromSession', () => {
  test('state fixture built', () => expect(STATE_JSON.length).toBeGreaterThan(0));

  test('maps the side to the wallet, exactly as the API manager does', () => {
    expect(payloadFromSession(session({ winner: 'A' }) as any).winner).toBe(PLAYER_A);
    expect(payloadFromSession(session({ winner: 'B' }) as any).winner).toBe(PLAYER_B);
    expect(payloadFromSession(session({ winner: 'draw' }) as any).winner).toBe('draw');
  });

  test('damage comes from the persisted final state', () => {
    const p = payloadFromSession(session() as any);
    const expected = v3.repairDamage(v3.deserializeState(STATE_JSON));
    expect(p.damageA).toEqual(expected.damageA);
    expect(p.damageB).toEqual(expected.damageB);
    expect(p).toMatchObject({ battleId: '42', finalStateHash: HASH_1, turnLogHash: HASH_2 });
  });

  test('refuses a row with no result hashes', () => {
    expect(() => payloadFromSession(session({ finalStateHash: null }) as any)).toThrow('no result hashes');
  });
});

describe('SettleReconciler', () => {
  test('D-28: a settling session with NO job gets its settle job recreated', async () => {
    const { deps, inserted, logs } = makeDeps({ sessions: [session()] });
    await new SettleReconciler(deps).tick();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ jobType: 'settle_battle', idempotencyKey: 'settle_battle:42' });
    expect(inserted[0].payload).toMatchObject({ battleId: '42', winner: PLAYER_A, finalStateHash: HASH_1, turnLogHash: HASH_2 });
    expect(logs.some((l) => l.level === 'warn' && l.msg.startsWith('settle_job_recreated'))).toBe(true);
  });

  test('D-28: a job that died from exhausted retries is revived with a fresh ladder', async () => {
    const { deps, inserted, updated, logs } = makeDeps({ sessions: [session()], job: { id: 9n, status: JobStatus.Dead, lastError: 'max_attempts_exceeded: fetch failed' } });
    await new SettleReconciler(deps).tick();
    expect(inserted).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ status: JobStatus.Pending, attempts: 0, completedAt: null, lastError: 'revived: max_attempts_exceeded: fetch failed' });
    expect(logs.some((l) => l.msg.startsWith('settle_job_revived'))).toBe(true);
  });

  test('a job that died for a PERMANENT reason is never revived — it alarms instead', async () => {
    const { deps, inserted, updated, logs } = makeDeps({ sessions: [session()], job: { id: 9n, status: JobStatus.Dead, lastError: 'revert:InvalidSettlementHash' } });
    await new SettleReconciler(deps).tick();
    expect(inserted).toHaveLength(0);
    expect(updated).toHaveLength(0);
    expect(logs.filter((l) => l.level === 'error').map((l) => l.msg)).toEqual(['settle_job_dead_permanent']);
  });

  test('a pending or running job is left alone', async () => {
    for (const status of [JobStatus.Pending, JobStatus.Running]) {
      const { deps, inserted, updated, logs } = makeDeps({ sessions: [session()], job: { id: 9n, status, lastError: null } });
      await new SettleReconciler(deps).tick();
      expect(inserted).toHaveLength(0);
      expect(updated).toHaveLength(0);
      expect(logs.filter((l) => l.level === 'error')).toHaveLength(0);
    }
  });

  test('the battle already left Active on-chain: nothing to do (the indexer will mirror it)', async () => {
    for (const phase of [5, 6, 7]) {
      const { deps, inserted, updated } = makeDeps({ sessions: [session()], chain: { phase, phaseDeadline: CHAIN_NOW + 7_200n } });
      await new SettleReconciler(deps).tick();
      expect(inserted).toHaveLength(0);
      expect(updated).toHaveLength(0);
    }
  });

  test('the settle window has closed (CHAIN time): no job is started, and it alarms', async () => {
    const { deps, inserted, updated, logs } = makeDeps({ sessions: [session()], chain: { phase: 4, phaseDeadline: CHAIN_NOW + 30n } });
    await new SettleReconciler(deps).tick();
    expect(inserted).toHaveLength(0);
    expect(updated).toHaveLength(0);
    expect(logs.filter((l) => l.level === 'error').map((l) => l.msg)).toEqual(['settle_window_missed']);
  });

  test('alarms settle_overdue well inside the window, once per repeat interval', async () => {
    const stuck = session({ updatedAt: new Date(NOW - 25 * 60_000) });
    const { deps, logs } = makeDeps({ sessions: [stuck], job: { id: 9n, status: JobStatus.Pending, lastError: null } });
    const r = new SettleReconciler(deps);
    await r.tick();
    await r.tick();
    const alarms = logs.filter((l) => l.level === 'error');
    expect(alarms.map((l) => l.msg)).toEqual(['settle_overdue']);
    expect(alarms[0]!.fields).toMatchObject({ battleId: '42', secondsLeft: '7200' });
  });

  test('not overdue yet: no alarm', async () => {
    const { deps, logs } = makeDeps({ sessions: [session()], job: { id: 9n, status: JobStatus.Pending, lastError: null } });
    await new SettleReconciler(deps).tick();
    expect(logs.filter((l) => l.level === 'error')).toHaveLength(0);
  });

  test('one bad row does not stop the others', async () => {
    const { deps, inserted, logs } = makeDeps({ sessions: [session({ id: '41', finalStateHash: null }), session({ id: '42' })] });
    await new SettleReconciler(deps).tick();
    expect(inserted.map((i) => i.idempotencyKey)).toEqual(['settle_battle:42']);
    expect(logs.some((l) => l.level === 'error' && l.msg.includes('will retry next tick'))).toBe(true);
  });
});
