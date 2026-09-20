ALTER TABLE "battles" ADD COLUMN "proposed_winner" text;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "proposed_final_state_hash" text;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "proposed_turn_log_hash" text;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "proposed_at" timestamp;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "from_matchmaker" boolean DEFAULT true NOT NULL;