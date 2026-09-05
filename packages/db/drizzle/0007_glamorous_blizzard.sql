CREATE TABLE "battle_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"player_a" text NOT NULL,
	"player_b" text NOT NULL,
	"bot" text,
	"tier" text NOT NULL,
	"vrf_round" integer,
	"roster" jsonb NOT NULL,
	"state_json" text NOT NULL,
	"turn" integer DEFAULT 0 NOT NULL,
	"deadline" timestamp,
	"timeouts" jsonb DEFAULT '{"A":0,"B":0}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"winner" text,
	"final_state_hash" text,
	"turn_log_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "battle_sessions_kind_ck" CHECK ("battle_sessions"."kind" IN ('real', 'practice')),
	CONSTRAINT "battle_sessions_status_ck" CHECK ("battle_sessions"."status" IN ('active', 'finished', 'settling', 'settled', 'abandoned'))
);
--> statement-breakpoint
CREATE TABLE "battle_turns" (
	"session_id" text NOT NULL,
	"turn" integer NOT NULL,
	"lobster_id" text NOT NULL,
	"command" jsonb,
	"result" jsonb NOT NULL,
	"post_state_hash" text NOT NULL,
	"submitted_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "battle_turns_session_id_turn_pk" PRIMARY KEY("session_id","turn"),
	CONSTRAINT "battle_turns_submitted_by_ck" CHECK ("battle_turns"."submitted_by" IN ('player', 'bot', 'timeout', 'stun', 'forfeit'))
);
--> statement-breakpoint
CREATE INDEX "battle_sessions_status_idx" ON "battle_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "battle_sessions_kind_player_a_idx" ON "battle_sessions" USING btree ("kind","player_a");