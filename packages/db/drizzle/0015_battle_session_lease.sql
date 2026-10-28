ALTER TABLE "battle_sessions" ADD COLUMN "owner_instance" text;--> statement-breakpoint
ALTER TABLE "battle_sessions" ADD COLUMN "lease_until" timestamp;