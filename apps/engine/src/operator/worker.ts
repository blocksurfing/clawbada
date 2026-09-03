/** Operator worker — durable outbox processor. PR-A scaffold (X1+X2).
 *
 *  Polls `operator_jobs` for ready rows, claims them with FOR UPDATE SKIP
 *  LOCKED, dispatches to a registered handler keyed by `job_type`, and
 *  writes the terminal state back. PR-A registers zero handlers — the
 *  scaffold exists so PR-B/C can plug in `create_battle` and
 *  `resolve_round` / `settle_battle` without touching the loop.
 *
 *  Concurrency: single-instance for S1; the `FOR UPDATE SKIP LOCKED`
 *  semantics preserve the option to scale horizontally later.
 *
 *  Crash recovery: any rows left in `status=running` from a prior crash
 *  are reset to `pending` on `start()`. The `attempts` counter was
 *  incremented at claim time, so a crashed-mid-flight job has one
 *  attempt "burned" — conservative but matches the design doc's
 *  "any contract revert = dead" stance: better to err toward burning an
 *  attempt than risk double-submission. PR-B's create_battle handler
 *  uses `priorTxHash` to reconcile receipts on retry (F2/F3 paths). */
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { db, operatorJobs } from '@clawbada/db';
import { log as baseLog } from '../logger';
import {
  JobStatus,
  type JobStatusValue,
  type JobHandler,
  type JobContext,
  type JobResult,
  BACKOFF_SCHEDULE_MS,
  MAX_ATTEMPTS,
  RECORD_TX_HASH_RETRY_MS,
  TxHashPersistError,
} from './types';

const log = baseLog.child({ module: 'operator-worker' });

/** How many ready jobs to claim per tick. Bounded so a single tick can't
 *  monopolize the worker — gives other tick-driven services a chance to
 *  interleave if they share the process (currently they don't, but the
 *  cap is cheap insurance). */
const CLAIM_BATCH_SIZE = 10;

/** Poll cadence chosen in design D3. Low enough that p95 pickup latency
 *  is under the receipt-wait time on Base Flashblocks (200ms blocks, ~2s
 *  receipts), low DB load (one cheap index lookup per second). Revisit
 *  toward LISTEN/NOTIFY in S1.5 if observed end-to-end latency demands. */
const POLL_INTERVAL_MS = 1_000;

/** Codex PR-A HIGH-A2: maximum time stop() will wait for an in-flight tick
 *  to drain before letting the process proceed to exit. Set generously to
 *  cover receipt-wait latency on Base (~2s typical, multi-second worst
 *  case under network congestion). Beyond this, the in-flight handler is
 *  cut off and the row stays in `running` — recovered on next start(). */
const STOP_DRAIN_TIMEOUT_MS = 30_000;

export class OperatorWorker {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private handlers = new Map<string, JobHandler>();
  /** Guards against tick overlap — if a previous tick is still draining
   *  its claim batch when the next interval fires, skip the new tick. */
  private tickInFlight = false;
  /** Codex PR-A HIGH-A2: set by stop() to prevent new ticks from claiming
   *  more rows while an in-flight tick is draining. stop() then awaits
   *  tickInFlight = false (bounded by STOP_DRAIN_TIMEOUT_MS). */
  private stopping = false;

  /** Register a handler for a job_type. Idempotent — re-registering
   *  overrides the previous handler (useful in tests). */
  registerHandler(jobType: string, handler: JobHandler): void {
    if (this.handlers.has(jobType)) {
      log.warn({ jobType }, 'Overriding existing handler for job type');
    }
    this.handlers.set(jobType, handler);
  }

  async start(): Promise<void> {
    if (this.pollTimer !== null) {
      log.warn('Worker already started; ignoring duplicate start()');
      return;
    }

    // Codex PR-A MEDIUM-FU2: reset `stopping` so same-instance restart
    // (start → stop → start) doesn't leave every tick early-returning
    // from the stopping gate. The `pollTimer !== null` guard above
    // covers the "double start without intervening stop" case.
    this.stopping = false;

    await this.recoverStaleRunning();

    this.pollTimer = setInterval(() => {
      void this.tick().catch((err) => {
        // Defensive — tick() catches its own errors, but if something at
        // the outermost layer throws (e.g., db handle gone), we don't want
        // the interval to crash silently.
        log.error({ err }, 'Operator worker tick threw unhandled error');
      });
    }, POLL_INTERVAL_MS);

    log.info({ handlers: Array.from(this.handlers.keys()) }, 'Operator worker started');
  }

  async stop(): Promise<void> {
    if (this.pollTimer === null) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    // Codex PR-A HIGH-A2: drain in-flight work before resolving so the
    // engine's `process.exit(0)` doesn't cut off a handler mid-tx. New
    // claims are gated on `!this.stopping` (set above + checked in tick()).
    this.stopping = true;
    const deadline = Date.now() + STOP_DRAIN_TIMEOUT_MS;
    while (this.tickInFlight && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (this.tickInFlight) {
      log.warn('Operator worker stop: in-flight tick did not drain within timeout');
    }
    log.info('Operator worker stopped');
  }

  /** Reset any rows the prior process left in `status=running`. They were
   *  almost certainly mid-flight when we crashed. The attempts counter was
   *  already incremented when they were claimed, so this is just status +
   *  next_attempt_at — no double-counted retries. */
  private async recoverStaleRunning(): Promise<void> {
    const result = await db
      .update(operatorJobs)
      .set({ status: JobStatus.Pending, nextAttemptAt: new Date() })
      .where(eq(operatorJobs.status, JobStatus.Running))
      .returning({ id: operatorJobs.id });

    if (result.length > 0) {
      log.warn({ count: result.length }, 'Recovered stale running jobs from prior crash');
    }
  }

  /** Poll → claim → dispatch → write terminal state. */
  private async tick(): Promise<void> {
    if (this.tickInFlight) return;
    // Codex PR-A HIGH-A2: gate new claims on `!stopping` so stop()'s drain
    // window doesn't race against a freshly-started tick claiming more work.
    if (this.stopping) return;
    this.tickInFlight = true;
    try {
      const claimed = await this.claim();
      if (claimed.length === 0) return;
      // Sequential dispatch — keeps operator-wallet nonce ordering simple
      // and avoids head-of-line concerns in PR-A. PR-B can parallelize if
      // benchmarks demand it.
      for (const job of claimed) {
        await this.dispatch(job);
      }
    } finally {
      this.tickInFlight = false;
    }
  }

  /** Atomic claim. Selects up to CLAIM_BATCH_SIZE ready jobs with
   *  FOR UPDATE SKIP LOCKED, increments `attempts`, marks them `running`.
   *  Returns the claimed rows with `attempts` already reflecting the
   *  new count so handlers see the correct attempt number. */
  private async claim(): Promise<ClaimedJob[]> {
    return db.transaction(async (tx) => {
      const candidates = await tx
        .select()
        .from(operatorJobs)
        .where(
          and(
            eq(operatorJobs.status, JobStatus.Pending),
            lte(operatorJobs.nextAttemptAt, sql`now()`),
          ),
        )
        .orderBy(operatorJobs.createdAt)
        .for('update', { skipLocked: true })
        .limit(CLAIM_BATCH_SIZE);

      if (candidates.length === 0) return [];

      const ids = candidates.map((c) => c.id);
      await tx
        .update(operatorJobs)
        .set({
          status: JobStatus.Running,
          attempts: sql`${operatorJobs.attempts} + 1`,
        })
        .where(inArray(operatorJobs.id, ids));

      // Reflect the increment locally so the handler context shows the
      // attempt number that will be persisted on completion.
      return candidates.map((c) => ({
        id: c.id,
        jobType: c.jobType,
        payload: c.payload,
        idempotencyKey: c.idempotencyKey,
        attempts: c.attempts + 1,
        priorTxHash: c.txHash,
      }));
    });
  }

  /** Run the handler for one claimed job and persist its terminal state. */
  private async dispatch(job: ClaimedJob): Promise<void> {
    const handler = this.handlers.get(job.jobType);
    if (!handler) {
      // No registered handler — push next_attempt_at out far enough that
      // we don't busy-loop on this row. Doesn't go Dead so a deploy that
      // forgets a handler can recover by re-registering and resuming.
      log.warn(
        { jobId: job.id.toString(), jobType: job.jobType },
        'No registered handler for job type; deferring',
      );
      await this.markPending(job, BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1], null);
      return;
    }

    // Codex PR-A LOW-FU3: track the latest hash recorded by the handler so
    // markSucceeded can fall back to it when the handler returns ok without
    // an explicit txHash. Without this, a successful return would overwrite
    // the just-persisted hash with null.
    let lastRecordedHash: string | null = null;

    const ctx: JobContext = {
      jobId: job.id,
      jobType: job.jobType,
      attempts: job.attempts,
      priorTxHash: job.priorTxHash,
      // Codex PR-A HIGH-A1 + MEDIUM-FU1: persist the tx hash IMMEDIATELY
      // with bounded internal retry. If every retry fails, throw the
      // sentinel error so dispatch can mark the job dead (re-submitting
      // would lose the hash and double-charge the player). Survives worker
      // crash so the next attempt's priorTxHash reconciles.
      recordTxHash: async (hash: string) => {
        let lastErr: unknown = null;
        for (let i = 0; i <= RECORD_TX_HASH_RETRY_MS.length; i++) {
          try {
            await db
              .update(operatorJobs)
              .set({ txHash: hash })
              .where(eq(operatorJobs.id, job.id));
            lastRecordedHash = hash;
            return;
          } catch (err) {
            lastErr = err;
            if (i < RECORD_TX_HASH_RETRY_MS.length) {
              await new Promise((r) => setTimeout(r, RECORD_TX_HASH_RETRY_MS[i]));
            }
          }
        }
        throw new TxHashPersistError(hash, lastErr);
      },
    };

    let result: JobResult;
    try {
      result = await handler(job.payload, ctx);
    } catch (err) {
      if (err instanceof TxHashPersistError) {
        // Hash couldn't be durably persisted after submitting the chain tx.
        // Mark dead — retrying would double-submit. Log fatal so an oncall
        // can reconcile the (possibly-landed) chain tx manually.
        log.fatal(
          { jobId: job.id.toString(), jobType: job.jobType, txHash: err.txHash, err },
          'tx_hash_persist_failed — chain tx may need manual reconciliation',
        );
        result = { ok: false, retry: 'dead', error: err.message };
      } else {
        // Thrown exceptions classify as transient — the handler should
        // return `{ ok: false, retry: 'dead' }` for permanent failures.
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err, jobId: job.id.toString(), jobType: job.jobType }, 'Handler threw');
        result = { ok: false, retry: 'transient', error: msg };
      }
    }

    if (result.ok) {
      await this.markSucceeded(job, result.txHash ?? lastRecordedHash ?? null);
      return;
    }

    if (result.retry === 'dead') {
      await this.markDead(job, result.error);
      return;
    }

    // Transient failure. If we've hit max attempts, escalate to dead.
    if (job.attempts >= MAX_ATTEMPTS) {
      await this.markDead(job, `max_attempts_exceeded: ${result.error}`);
      return;
    }

    // Backoff schedule indexes from the failure count. attempts is 1-based
    // (first failure has attempts=1), schedule is 0-based: idx = attempts-1.
    const backoffMs = BACKOFF_SCHEDULE_MS[job.attempts - 1] ?? BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1];
    await this.markPending(job, backoffMs, result.error);
  }

  private async markSucceeded(job: ClaimedJob, txHash: string | null): Promise<void> {
    await db
      .update(operatorJobs)
      .set({
        status: JobStatus.Succeeded,
        completedAt: new Date(),
        txHash: txHash ?? job.priorTxHash,
        lastError: null,
      })
      .where(eq(operatorJobs.id, job.id));
  }

  private async markDead(job: ClaimedJob, error: string): Promise<void> {
    log.error(
      { jobId: job.id.toString(), jobType: job.jobType, attempts: job.attempts, error },
      'Operator job marked dead',
    );
    await db
      .update(operatorJobs)
      .set({
        status: JobStatus.Dead,
        completedAt: new Date(),
        lastError: error,
      })
      .where(eq(operatorJobs.id, job.id));
  }

  private async markPending(job: ClaimedJob, backoffMs: number, error: string | null): Promise<void> {
    await db
      .update(operatorJobs)
      .set({
        status: JobStatus.Pending,
        nextAttemptAt: new Date(Date.now() + backoffMs),
        lastError: error,
      })
      .where(eq(operatorJobs.id, job.id));
  }
}

interface ClaimedJob {
  id: bigint;
  jobType: string;
  payload: unknown;
  idempotencyKey: string;
  /** Already incremented to reflect THIS attempt. */
  attempts: number;
  priorTxHash: string | null;
}

// Re-exports so callers can `import { OperatorWorker, JobStatus } from './operator/worker'`
// without reaching into ./types directly.
export { JobStatus } from './types';
export type { JobHandler, JobContext, JobResult, JobStatusValue } from './types';
