import { pgTable, text, jsonb, smallint, bigint, timestamp, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Durable outbox for operator-signed on-chain work. PR-A foundation (X1+X2).
 *
 *  The matchmaker (create_battle) and the indexer (resolve_round / settle_battle)
 *  enqueue rows here in the same DB transaction as the decision that produced
 *  the work. A single operator worker process polls, claims with FOR UPDATE
 *  SKIP LOCKED, submits the operator-signed tx, verifies the receipt, and
 *  marks the row terminal. The unique idempotency_key prevents double-submission
 *  across worker restarts, multi-instance racing, and producer retries.
 *
 *  PR-A intentionally adds no job_type handlers — the table + worker are inert
 *  scaffolding until PR-B/C register handlers. */
export const operatorJobs = pgTable(
  'operator_jobs',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    /** Discriminator: 'create_battle' | 'resolve_round' | 'settle_battle' | future types. */
    jobType: text('job_type').notNull(),
    /** Typed per jobType. Validated at the handler boundary. */
    payload: jsonb('payload').notNull(),
    /** Dedupe key. e.g. `create_battle:<predicted_battle_id>` or
     *  `resolve_round:<battle_id>:<round>`. UNIQUE — producer-side collisions
     *  fail the producer's INSERT cleanly rather than silently double-running. */
    idempotencyKey: text('idempotency_key').notNull(),
    /** 0=pending, 1=running, 2=succeeded, 3=dead. */
    status: smallint('status').notNull().default(0),
    /** Incremented on each attempt; backoff schedule indexes this. */
    attempts: smallint('attempts').notNull().default(0),
    /** Last error message captured for ops debugging. */
    lastError: text('last_error'),
    /** Earliest time the worker may pick this row up again. */
    nextAttemptAt: timestamp('next_attempt_at').notNull().defaultNow(),
    /** Set once the worker submits a tx; used by crash-recovery to reconcile
     *  receipts after a worker restart mid-flight (F2/F3 in the design doc). */
    txHash: text('tx_hash'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (t) => ({
    /** Idempotency guarantee at the DB layer. */
    idempotencyUniq: uniqueIndex('operator_jobs_idempotency_uniq').on(t.idempotencyKey),
    /** Worker poll path: cheap lookup of ready-to-run jobs by next_attempt_at. */
    readyIdx: index('operator_jobs_ready_idx').on(t.nextAttemptAt, t.status),
    /** Codex PR-A LOW-FU4: declared in the schema DSL so drizzle's snapshot
     *  tracks the constraint. Future column-type changes / table rebuilds
     *  preserve the invariant; manual SQL-only CHECKs would be silently
     *  dropped by drizzle-generate. */
    statusCk: check('operator_jobs_status_ck', sql`${t.status} IN (0, 1, 2, 3)`),
  }),
);
