-- A2 (May 2026 audit) + reconciliation of out-of-band V3 S1 schema work.
--
-- Three prior hand-written migrations (0001_v3s1_power_matchmaking.sql,
-- 0002_v3s1_battle_power_binding.sql) were never registered in the drizzle
-- journal — so any env that ran drizzle-kit migrate from genesis only
-- applied 0000_steep_shadowcat. Other envs applied the v3s1 files manually
-- via psql. drizzle-generate then re-emitted those changes alongside the
-- A2 queued_team_a/b additions, which is what this file represents.
--
-- All statements are idempotent (IF NOT EXISTS) so this migration is
-- safe to run against:
--   • a fresh DB (applies everything)
--   • a DB that already had the v3s1 changes applied manually (only A2 lands)
--   • a DB partway through (only missing pieces land)
--
-- A2 columns at top so they always make it through even if a later
-- statement somehow fails partway. They are nullable on existing rows.

ALTER TABLE "battles" ADD COLUMN IF NOT EXISTS "queued_team_a" bigint;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN IF NOT EXISTS "queued_team_b" bigint;--> statement-breakpoint

-- V3 S1 power binding (originally in 0002_v3s1_battle_power_binding.sql).
ALTER TABLE "battles" ADD COLUMN IF NOT EXISTS "power_a" smallint;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN IF NOT EXISTS "power_b" smallint;--> statement-breakpoint

-- V3 S1 power matchmaking (originally in 0001_v3s1_power_matchmaking.sql).
-- power_score uses the add-with-default-then-drop-default pattern so it
-- survives the case where rows already exist in matchmaking_queue.
ALTER TABLE "matchmaking_queue" ADD COLUMN IF NOT EXISTS "power_score" smallint NOT NULL DEFAULT 3;--> statement-breakpoint
ALTER TABLE "matchmaking_queue" ALTER COLUMN "power_score" DROP DEFAULT;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "matchmaking_decisions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "matchmaking_decisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"address" text NOT NULL,
	"decision" text NOT NULL,
	"stake_bracket" smallint NOT NULL,
	"power_score" smallint NOT NULL,
	"elapsed_sec" integer,
	"meta" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "matchmaking_decisions_addr_idx" ON "matchmaking_decisions" USING btree ("address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "matchmaking_queue_address_uniq" ON "matchmaking_queue" USING btree ("address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matchmaking_queue_bucket_idx" ON "matchmaking_queue" USING btree ("stake_bracket","power_score","enqueued_at");
