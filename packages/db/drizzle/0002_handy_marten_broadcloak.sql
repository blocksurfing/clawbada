-- PR-A foundation (X1+X2 operator-worker scaffold).
--
-- Adds:
--   • operator_jobs — durable outbox for operator-signed on-chain work.
--     Matchmaker (PR-B: create_battle) and indexer (PR-C: resolve_round /
--     settle_battle) enqueue rows in the same DB tx as the decision; a single
--     operator worker process polls, claims, submits, verifies, marks terminal.
--   • battles.status — orthogonal to battles.phase (which mirrors contract enum).
--     Tracks operator-worker lifecycle: pending_create → created → settled/etc.
--
-- Idempotent — safe to run against fresh, partially-applied, or already-applied
-- DBs. Pattern matches 0001_past_zaladane.sql.

CREATE TABLE IF NOT EXISTS "operator_jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "operator_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" smallint DEFAULT 0 NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"tx_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);--> statement-breakpoint

ALTER TABLE "battles" ADD COLUMN IF NOT EXISTS "status" smallint;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "operator_jobs_idempotency_uniq" ON "operator_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_jobs_ready_idx" ON "operator_jobs" USING btree ("next_attempt_at","status");

-- Status range CHECK constraints are added in 0003 via drizzle's check() DSL
-- so the schema snapshot tracks them — see packages/db/src/schema/{operator-jobs,battles}.ts.
