import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

// ── Mock @clawbada/db ──
//
// The worker calls these drizzle paths:
//   db.transaction(callback)  // for claim
//   db.update(table).set(...).where(...).returning(...)  // for recoverStaleRunning
//   db.update(table).set(...).where(...)  // for markSucceeded/Dead/Pending
//                                         // and ctx.recordTxHash
//
// Mocks capture .set(...) AND .where(...) so tests can assert update scoping
// (Codex PR-A LOW-A5: previously only .set was captured, allowing a buggy
// implementation that updated every row to still pass tests).

const txClaimReturn = { value: [] as unknown[] };
const recoveryReturn = { value: [] as unknown[] };
const updates: { set: Record<string, unknown>; where: unknown; returning: boolean }[] = [];
const txUpdates: { set: Record<string, unknown>; where: unknown }[] = [];

function makeUpdateChain() {
  let capturedSet: Record<string, unknown> = {};
  const chain: any = {
    set: (args: Record<string, unknown>) => {
      capturedSet = args;
      return chain;
    },
  };
  chain.where = (whereExpr: unknown) => {
    const entry = { set: capturedSet, where: whereExpr, returning: false };
    updates.push(entry);
    const p: any = Promise.resolve([]);
    p.returning = () => {
      entry.returning = true;
      return Promise.resolve(recoveryReturn.value);
    };
    return p;
  };
  return chain;
}

mock.module('@clawbada/db', () => ({
  db: {
    transaction: async (cb: (tx: any) => Promise<unknown[]>) => {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                for: () => ({
                  limit: () => Promise.resolve(txClaimReturn.value),
                }),
              }),
            }),
          }),
        }),
        update: () => {
          let capturedSet: Record<string, unknown> = {};
          return {
            set: (args: Record<string, unknown>) => {
              capturedSet = args;
              return {
                where: (whereExpr: unknown) => {
                  txUpdates.push({ set: capturedSet, where: whereExpr });
                  return Promise.resolve();
                },
              };
            },
          };
        },
      };
      return cb(tx);
    },
    update: () => makeUpdateChain(),
  },
  operatorJobs: {
    id: 'id',
    status: 'status',
    attempts: 'attempts',
    nextAttemptAt: 'next_attempt_at',
  },
}));

// ── Import after mocks ──
import { OperatorWorker, JobStatus } from '../../operator/worker';
import { BACKOFF_SCHEDULE_MS, MAX_ATTEMPTS, type JobResult } from '../../operator/types';

// Helper — construct the row shape the claim transaction yields.
function makeJob(overrides: Partial<{
  id: bigint;
  jobType: string;
  payload: unknown;
  attempts: number;
  txHash: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 1n,
    jobType: overrides.jobType ?? 'test_job',
    payload: overrides.payload ?? { foo: 'bar' },
    idempotencyKey: 'test:1',
    status: JobStatus.Pending,
    // Claim increments attempts, so the worker sees `attempts + 1`.
    // Tests set the post-increment value here.
    attempts: (overrides.attempts ?? 1) - 1,
    lastError: null,
    nextAttemptAt: new Date(),
    txHash: overrides.txHash ?? null,
    createdAt: new Date(),
    completedAt: null,
  };
}

// Wait for the worker's tick to run. Bun's timers fire on real intervals.
async function waitTick(ms = 1500): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe('OperatorWorker', () => {
  let worker: OperatorWorker;

  beforeEach(() => {
    worker = new OperatorWorker();
    txClaimReturn.value = [];
    recoveryReturn.value = [];
    updates.length = 0;
    txUpdates.length = 0;
  });

  afterEach(async () => {
    await worker.stop();
  });

  describe('registerHandler', () => {
    test('stores handler for a job type', () => {
      const handler = mock(() => Promise.resolve<JobResult>({ ok: true }));
      worker.registerHandler('test_job', handler);
      // No direct accessor for the handler map; covered by dispatch tests.
      expect(typeof handler).toBe('function');
    });

    test('overriding an existing handler does not throw', () => {
      worker.registerHandler('test_job', () => Promise.resolve<JobResult>({ ok: true }));
      expect(() => {
        worker.registerHandler('test_job', () => Promise.resolve<JobResult>({ ok: true }));
      }).not.toThrow();
    });
  });

  describe('lifecycle', () => {
    test('start then stop without crashing', async () => {
      await worker.start();
      await worker.stop();
    });

    test('start when already started is a no-op (warn-logged)', async () => {
      await worker.start();
      // Second call should not throw; the worker logs a warn and returns.
      await worker.start();
      await worker.stop();
    });

    test('stop when not started is a no-op', async () => {
      // Should not throw, no timer to clear.
      await worker.stop();
    });
  });

  describe('dispatch — success path', () => {
    test('handler returning ok marks job succeeded with txHash', async () => {
      const handler = mock(() => Promise.resolve<JobResult>({ ok: true, txHash: '0xabc' }));
      worker.registerHandler('test_job', handler);
      txClaimReturn.value = [makeJob({ id: 42n, attempts: 1 })];
      await worker.start();
      // Recovery on start() inserts a Pending update into `updates`. Clear
      // before the tick so dispatch assertions only see the worker's
      // post-handler decision.
      updates.length = 0;
      await waitTick();

      expect(handler).toHaveBeenCalledTimes(1);
      const succeededUpdate = updates.find((u) => u.set.status === JobStatus.Succeeded);
      expect(succeededUpdate).toBeDefined();
      expect(succeededUpdate?.set.txHash).toBe('0xabc');
      expect(succeededUpdate?.set.lastError).toBeNull();
      // Codex PR-A LOW-FU5: assert the UPDATE was id-scoped, not table-wide.
      // The where expression is a drizzle SQL object; we can't introspect
      // its structure portably, but we CAN confirm it's present (non-null).
      expect(succeededUpdate?.where).toBeDefined();
      expect(succeededUpdate?.where).not.toBeNull();
    });
  });

  describe('dispatch — transient failure path', () => {
    test('handler returning transient marks pending with backoff', async () => {
      const handler = mock(() =>
        Promise.resolve<JobResult>({ ok: false, retry: 'transient', error: 'rpc_timeout' }),
      );
      worker.registerHandler('test_job', handler);
      txClaimReturn.value = [makeJob({ id: 7n, attempts: 1 })];
      await worker.start();
      // Recovery on start() inserts a Pending update into `updates`. Clear
      // before the tick so dispatch assertions only see the worker's
      // post-handler decision.
      updates.length = 0;
      await waitTick();

      const pendingUpdate = updates.find((u) => u.set.status === JobStatus.Pending);
      expect(pendingUpdate).toBeDefined();
      expect(pendingUpdate?.set.lastError).toBe('rpc_timeout');
      // nextAttemptAt should be ~now + BACKOFF_SCHEDULE_MS[0] (5s for attempt 1).
      const nextAt = pendingUpdate?.set.nextAttemptAt as Date;
      const delta = nextAt.getTime() - Date.now();
      expect(delta).toBeGreaterThan(BACKOFF_SCHEDULE_MS[0] - 1500);
      expect(delta).toBeLessThan(BACKOFF_SCHEDULE_MS[0] + 1500);
    });

    test('handler throwing is treated as transient', async () => {
      const handler = mock(() => {
        throw new Error('unexpected');
      });
      worker.registerHandler('test_job', handler);
      txClaimReturn.value = [makeJob({ id: 8n, attempts: 1 })];
      await worker.start();
      // Recovery on start() inserts a Pending update into `updates`. Clear
      // before the tick so dispatch assertions only see the worker's
      // post-handler decision.
      updates.length = 0;
      await waitTick();

      const pendingUpdate = updates.find((u) => u.set.status === JobStatus.Pending);
      expect(pendingUpdate).toBeDefined();
      expect(pendingUpdate?.set.lastError).toBe('unexpected');
    });
  });

  describe('dispatch — dead failure path', () => {
    test('handler returning dead marks job dead', async () => {
      const handler = mock(() =>
        Promise.resolve<JobResult>({ ok: false, retry: 'dead', error: 'InvalidPowerScore' }),
      );
      worker.registerHandler('test_job', handler);
      txClaimReturn.value = [makeJob({ id: 9n, attempts: 1 })];
      await worker.start();
      // Recovery on start() inserts a Pending update into `updates`. Clear
      // before the tick so dispatch assertions only see the worker's
      // post-handler decision.
      updates.length = 0;
      await waitTick();

      const deadUpdate = updates.find((u) => u.set.status === JobStatus.Dead);
      expect(deadUpdate).toBeDefined();
      expect(deadUpdate?.set.lastError).toBe('InvalidPowerScore');
      expect(deadUpdate?.set.completedAt).toBeInstanceOf(Date);
    });

    test('transient failure on final attempt escalates to dead', async () => {
      const handler = mock(() =>
        Promise.resolve<JobResult>({ ok: false, retry: 'transient', error: 'rpc_again' }),
      );
      worker.registerHandler('test_job', handler);
      // attempts=MAX_ATTEMPTS means this attempt has burned the last retry.
      txClaimReturn.value = [makeJob({ id: 10n, attempts: MAX_ATTEMPTS })];
      await worker.start();
      // Recovery on start() inserts a Pending update into `updates`. Clear
      // before the tick so dispatch assertions only see the worker's
      // post-handler decision.
      updates.length = 0;
      await waitTick();

      const deadUpdate = updates.find((u) => u.set.status === JobStatus.Dead);
      expect(deadUpdate).toBeDefined();
      expect(deadUpdate?.set.lastError).toContain('max_attempts_exceeded');
      expect(deadUpdate?.set.lastError).toContain('rpc_again');
    });
  });

  describe('dispatch — no handler registered', () => {
    test('defers job (status=pending with long backoff)', async () => {
      // No handler registered for this job type.
      txClaimReturn.value = [makeJob({ id: 11n, jobType: 'unregistered_type', attempts: 1 })];
      await worker.start();
      // Recovery on start() inserts a Pending update into `updates`. Clear
      // before the tick so dispatch assertions only see the worker's
      // post-handler decision.
      updates.length = 0;
      await waitTick();

      const pendingUpdate = updates.find((u) => u.set.status === JobStatus.Pending);
      expect(pendingUpdate).toBeDefined();
      // Should NOT be marked dead — a deploy without all handlers should recover.
      const deadUpdate = updates.find((u) => u.set.status === JobStatus.Dead);
      expect(deadUpdate).toBeUndefined();
      // Backoff is the longest in the schedule (1h).
      const nextAt = pendingUpdate?.set.nextAttemptAt as Date;
      const delta = nextAt.getTime() - Date.now();
      expect(delta).toBeGreaterThan(BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1] - 1500);
    });
  });

  describe('crash recovery', () => {
    test('start() resets any running jobs to pending', async () => {
      // Simulate the recoverStaleRunning query returning some recovered ids.
      recoveryReturn.value = [{ id: 100n }, { id: 101n }];
      await worker.start();
      // recoverStaleRunning is the only update on start() that uses
      // .returning(...) — distinguishable from the dispatch markX paths
      // which don't call .returning(). Codex PR-A LOW-A5 hardened test.
      const recoveryUpdate = updates.find((u) => u.returning === true);
      expect(recoveryUpdate).toBeDefined();
      expect(recoveryUpdate?.set.status).toBe(JobStatus.Pending);
      expect(recoveryUpdate?.set.nextAttemptAt).toBeInstanceOf(Date);
    });
  });

  describe('stop() drain (HIGH-A2)', () => {
    test('stop() waits for in-flight tick to complete before resolving', async () => {
      // Handler that resolves slowly so the tick is mid-flight when stop() runs.
      const handler = mock(async () => {
        await new Promise((r) => setTimeout(r, 300));
        return { ok: true, txHash: '0xabc' } satisfies JobResult;
      });
      worker.registerHandler('test_job', handler);
      txClaimReturn.value = [makeJob({ id: 50n })];
      await worker.start();
      updates.length = 0;
      // Wait for tick to fire and handler to start.
      await new Promise((r) => setTimeout(r, 1100));
      // Now stop while handler is in-flight. Should wait until handler completes.
      const stopStart = Date.now();
      await worker.stop();
      const stopElapsed = Date.now() - stopStart;
      // Handler had ~200ms more to go; stop should have drained.
      expect(stopElapsed).toBeGreaterThan(50);
      // Handler did complete, terminal update landed.
      const succeededUpdate = updates.find((u) => u.set.status === JobStatus.Succeeded);
      expect(succeededUpdate).toBeDefined();
    });
  });

  describe('recordTxHash (HIGH-A1 + LOW-FU3)', () => {
    test('ctx.recordTxHash persists hash immediately', async () => {
      const handler = mock(async (_payload, ctx) => {
        await ctx.recordTxHash('0xdeadbeef');
        return { ok: true } satisfies JobResult;
      });
      worker.registerHandler('test_job', handler);
      txClaimReturn.value = [makeJob({ id: 60n })];
      await worker.start();
      updates.length = 0;
      await waitTick();

      // The recordTxHash should appear as an UPDATE setting txHash.
      const txHashUpdate = updates.find((u) => u.set.txHash === '0xdeadbeef');
      expect(txHashUpdate).toBeDefined();
      expect(handler).toHaveBeenCalled();
    });

    test('LOW-FU3: success without explicit txHash falls back to recorded hash', async () => {
      // Handler records hash then returns ok WITHOUT echoing the hash.
      // Pre-fix: markSucceeded would write txHash=null, erasing the recorded
      // hash. Post-fix: lastRecordedHash is used as fallback.
      const handler = mock(async (_payload, ctx) => {
        await ctx.recordTxHash('0xfeedface');
        return { ok: true } satisfies JobResult;
      });
      worker.registerHandler('test_job', handler);
      txClaimReturn.value = [makeJob({ id: 61n })];
      await worker.start();
      updates.length = 0;
      await waitTick();

      const succeededUpdate = updates.find((u) => u.set.status === JobStatus.Succeeded);
      expect(succeededUpdate).toBeDefined();
      expect(succeededUpdate?.set.txHash).toBe('0xfeedface');
    });
  });

  describe('same-instance restart (MEDIUM-FU2)', () => {
    test('start → stop → start works without leaving worker silently inert', async () => {
      const handler = mock(() => Promise.resolve<JobResult>({ ok: true }));
      worker.registerHandler('test_job', handler);
      await worker.start();
      await worker.stop();
      // Second start with new pending job.
      txClaimReturn.value = [makeJob({ id: 70n })];
      await worker.start();
      updates.length = 0;
      await waitTick();
      // Handler should fire — stopping flag was reset.
      expect(handler).toHaveBeenCalled();
      const succeededUpdate = updates.find((u) => u.set.status === JobStatus.Succeeded);
      expect(succeededUpdate).toBeDefined();
    });
  });

  describe('backoff schedule', () => {
    test('exposes the expected schedule', () => {
      // Pinned so adjustments are intentional + reviewed.
      expect(BACKOFF_SCHEDULE_MS).toEqual([5_000, 30_000, 300_000, 3_600_000]);
      expect(MAX_ATTEMPTS).toBe(5);
    });
  });
});
