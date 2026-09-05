/** Operator-worker shared types. PR-A scaffold (X1+X2).
 *
 *  Registered job types: 'create_battle' (matchmaker), 'settle_battle' (V3
 *  battle-session manager), 'set_team_boosts' / 'activate_boost_epoch' (weekly
 *  boost job). Unknown job types are logged-and-skipped, not killed. */

/** Numeric status values mirror packages/db/src/schema/operator-jobs.ts.
 *  Frozen as `as const` so TypeScript narrows correctly at compare sites. */
export const JobStatus = {
  Pending: 0,
  Running: 1,
  Succeeded: 2,
  Dead: 3,
} as const;
export type JobStatusValue = (typeof JobStatus)[keyof typeof JobStatus];

/** Backoff schedule indexed by `attempts AFTER the failure that triggered
 *  the backoff`. Attempts beyond MAX_ATTEMPTS go to Dead status.
 *  Schedule: 5s → 30s → 5min → 1h → (dead).
 *  Total wall-clock window before dead ≈ 65 minutes. */
export const BACKOFF_SCHEDULE_MS = [5_000, 30_000, 300_000, 3_600_000] as const;
export const MAX_ATTEMPTS = BACKOFF_SCHEDULE_MS.length + 1; // 5 total tries

/** Internal retry schedule for `ctx.recordTxHash`. Distinct from the job
 *  backoff because this fires DURING a handler call — must be short so the
 *  handler doesn't block the dispatch loop for minutes. Total ~6s.
 *  Codex PR-A MEDIUM-FU1: makes the contract fail-closed. */
export const RECORD_TX_HASH_RETRY_MS = [200, 1_000, 5_000] as const;

/** Sentinel error thrown by `ctx.recordTxHash` if every internal retry
 *  fails. Dispatch catches this specifically and marks the job dead —
 *  retrying would re-submit the chain tx (since the hash isn't persisted,
 *  priorTxHash stays null on the retry). The chain tx may have actually
 *  landed; this becomes an ops repair situation, but at least the player
 *  isn't double-charged. */
export class TxHashPersistError extends Error {
  constructor(public readonly txHash: string, cause: unknown) {
    super(`tx_hash_persist_failed: hash=${txHash} cause=${String(cause)}`);
    this.name = 'TxHashPersistError';
  }
}

/** Handler return contract. Handlers MUST return a Result rather than throw —
 *  the worker treats thrown exceptions as `{ ok: false, retry: 'transient' }`
 *  but the explicit shape makes intent clear and forces handlers to classify. */
export type JobResult =
  | { ok: true; txHash?: string }
  | { ok: false; retry: 'transient' | 'dead'; error: string };

/** A handler operates on a job's payload. PR-B/C register concrete handlers
 *  keyed by job_type via `OperatorWorker.registerHandler(...)`. */
export type JobHandler = (payload: unknown, ctx: JobContext) => Promise<JobResult>;

/** Per-job context passed to handlers. Holds the job's id + attempt count so
 *  handlers can log structured context, and txHash if a previous attempt
 *  submitted but didn't complete (F2/F3 crash-recovery in the design doc). */
export interface JobContext {
  jobId: bigint;
  jobType: string;
  attempts: number;
  /** Set on retries where a previous attempt persisted a txHash. Handler is
   *  expected to reconcile (fetch receipt) before re-submitting. PR-A
   *  scaffold doesn't drive this path; PR-B handler implements it. */
  priorTxHash: string | null;
  /** Persist a submitted tx hash IMMEDIATELY — before any await on receipt
   *  confirmation. Handlers MUST call this right after submit so the hash
   *  survives a worker crash and surfaces as `priorTxHash` on retry. Without
   *  this, a crash between submit and terminal write would lose the hash
   *  and the retry would double-submit. Codex PR-A HIGH-A1. */
  recordTxHash(hash: string): Promise<void>;
}
