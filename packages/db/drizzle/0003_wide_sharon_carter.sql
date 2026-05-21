-- Codex PR-A LOW-FU4: status range CHECK constraints declared via drizzle's
-- check() DSL in the schema (packages/db/src/schema/{operator-jobs,battles}.ts).
-- Drizzle generated this migration from those declarations, then we wrapped
-- each ADD CONSTRAINT in a pg_constraint lookup so re-runs are safe (CREATE
-- CONSTRAINT has no native IF NOT EXISTS).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'battles_status_ck') THEN
    ALTER TABLE "battles" ADD CONSTRAINT "battles_status_ck" CHECK ("battles"."status" IS NULL OR "battles"."status" IN (0, 1, 2, 3, 4));
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'operator_jobs_status_ck') THEN
    ALTER TABLE "operator_jobs" ADD CONSTRAINT "operator_jobs_status_ck" CHECK ("operator_jobs"."status" IN (0, 1, 2, 3));
  END IF;
END $$;
