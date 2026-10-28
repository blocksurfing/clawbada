CREATE TABLE "friend_rooms" (
	"id" text PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"guest" text,
	"secret_hash" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"host_team" jsonb,
	"guest_team" jsonb,
	"host_ready" boolean DEFAULT false NOT NULL,
	"guest_ready" boolean DEFAULT false NOT NULL,
	"arena" text DEFAULT 'dojo' NOT NULL,
	"battle_id" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "friend_rooms_status_ck" CHECK ("friend_rooms"."status" IN ('open', 'seated', 'in_battle', 'ended', 'expired', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "battle_sessions" DROP CONSTRAINT "battle_sessions_kind_ck";--> statement-breakpoint
CREATE INDEX "friend_rooms_host_status_idx" ON "friend_rooms" USING btree ("host","status");--> statement-breakpoint
CREATE INDEX "friend_rooms_guest_status_idx" ON "friend_rooms" USING btree ("guest","status");--> statement-breakpoint
CREATE INDEX "battle_sessions_kind_player_b_idx" ON "battle_sessions" USING btree ("kind","player_b");--> statement-breakpoint
ALTER TABLE "battle_sessions" ADD CONSTRAINT "battle_sessions_kind_ck" CHECK ("battle_sessions"."kind" IN ('real', 'practice', 'friend'));