CREATE TABLE "battle_participation" (
	"battle_id" bigint NOT NULL,
	"team_id" bigint NOT NULL,
	"opponent_team_id" bigint,
	"epoch_id" integer NOT NULL,
	"kind" text DEFAULT 'played' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "battle_participation_battle_id_team_id_pk" PRIMARY KEY("battle_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "boost_epochs" (
	"epoch_id" integer PRIMARY KEY NOT NULL,
	"chain_epoch" integer NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"floor_played" smallint NOT NULL,
	"status" text DEFAULT 'announced' NOT NULL,
	"rated_count" integer,
	"qualified_count" integer,
	"lapsed_count" integer,
	"avg_boost_bps" integer,
	"set_job_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"activate_job_id" bigint,
	"activate_tx_hash" text,
	"activated_at" timestamp,
	"flags" jsonb,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rating_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"battle_id" bigint DEFAULT 0 NOT NULL,
	"team_id" bigint NOT NULL,
	"opponent_team_id" bigint,
	"epoch_id" integer NOT NULL,
	"kind" text NOT NULL,
	"outcome" smallint,
	"rating_before" integer NOT NULL,
	"rating_after" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_boosts" (
	"epoch_id" integer NOT NULL,
	"team_id" bigint NOT NULL,
	"earned_epoch_id" integer NOT NULL,
	"rating" integer NOT NULL,
	"rank" integer NOT NULL,
	"percentile" numeric(8, 6) NOT NULL,
	"boost_bps" smallint NOT NULL,
	"power" smallint NOT NULL,
	"games_played" integer NOT NULL,
	"batch_index" smallint NOT NULL,
	"tx_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "team_boosts_epoch_id_team_id_pk" PRIMARY KEY("epoch_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "team_ratings" (
	"team_id" bigint PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"rating" integer DEFAULT 1200 NOT NULL,
	"power" smallint NOT NULL,
	"epoch_id" integer NOT NULL,
	"games_played_epoch" integer DEFAULT 0 NOT NULL,
	"games_played_total" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"lineage_parent_id" bigint,
	"lineage_shared" smallint,
	"lineage_reason" text DEFAULT 'fresh' NOT NULL,
	"lineage_consumed_by" bigint,
	"last_battle_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "disbanded_at" timestamp;--> statement-breakpoint
ALTER TABLE "expeditions" ADD COLUMN "boost_bps" smallint;--> statement-breakpoint
CREATE INDEX "battle_participation_team_epoch_idx" ON "battle_participation" USING btree ("team_id","epoch_id");--> statement-breakpoint
CREATE INDEX "battle_participation_epoch_idx" ON "battle_participation" USING btree ("epoch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rating_events_battle_team_uq" ON "rating_events" USING btree ("battle_id","team_id") WHERE "rating_events"."kind" IN ('battle', 'forfeit_loss');--> statement-breakpoint
CREATE UNIQUE INDEX "rating_events_decay_uq" ON "rating_events" USING btree ("team_id","epoch_id") WHERE "rating_events"."kind" = 'idle_decay';--> statement-breakpoint
CREATE INDEX "rating_events_team_epoch_idx" ON "rating_events" USING btree ("team_id","epoch_id");--> statement-breakpoint
CREATE INDEX "rating_events_epoch_idx" ON "rating_events" USING btree ("epoch_id");--> statement-breakpoint
CREATE INDEX "team_boosts_team_idx" ON "team_boosts" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_ratings_rating_idx" ON "team_ratings" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "team_ratings_owner_idx" ON "team_ratings" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "teams_owner_idx" ON "teams" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "teams_lobster_0_idx" ON "teams" USING btree ("lobster_0");--> statement-breakpoint
CREATE INDEX "teams_lobster_1_idx" ON "teams" USING btree ("lobster_1");--> statement-breakpoint
CREATE INDEX "teams_lobster_2_idx" ON "teams" USING btree ("lobster_2");--> statement-breakpoint
CREATE INDEX "battles_settled_at_idx" ON "battles" USING btree ("settled_at");--> statement-breakpoint
CREATE INDEX "battles_team_a_idx" ON "battles" USING btree ("team_a");--> statement-breakpoint
CREATE INDEX "battles_team_b_idx" ON "battles" USING btree ("team_b");