CREATE TABLE "lobsters" (
	"token_id" bigint PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"dna" text NOT NULL,
	"class" smallint NOT NULL,
	"legend" smallint DEFAULT 0 NOT NULL,
	"breed_type" smallint DEFAULT 0 NOT NULL,
	"purity" smallint DEFAULT 0 NOT NULL,
	"evolution_tier" smallint DEFAULT 0 NOT NULL,
	"damage" smallint DEFAULT 0 NOT NULL,
	"breed_count" smallint DEFAULT 0 NOT NULL,
	"generation" smallint DEFAULT 0 NOT NULL,
	"soulbound" boolean DEFAULT false NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"team_id" bigint PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"lobster_0" bigint NOT NULL,
	"lobster_1" bigint NOT NULL,
	"lobster_2" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expeditions" (
	"expedition_id" bigint PRIMARY KEY NOT NULL,
	"team_id" bigint NOT NULL,
	"owner" text NOT NULL,
	"season" integer NOT NULL,
	"mine_tier" smallint NOT NULL,
	"start_time" bigint NOT NULL,
	"reward" text NOT NULL,
	"claimed" boolean DEFAULT false NOT NULL,
	"claimed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "battle_rounds" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "battle_rounds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"battle_id" bigint NOT NULL,
	"round" smallint NOT NULL,
	"actions" jsonb NOT NULL,
	"team_a_hp" jsonb NOT NULL,
	"team_b_hp" jsonb NOT NULL,
	"vrf_seed" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "battles" (
	"battle_id" bigint PRIMARY KEY NOT NULL,
	"player_a" text NOT NULL,
	"player_b" text NOT NULL,
	"team_a" bigint NOT NULL,
	"team_b" bigint NOT NULL,
	"stake_bracket" smallint NOT NULL,
	"stake_amount" text NOT NULL,
	"phase" smallint DEFAULT 0 NOT NULL,
	"winner" text,
	"protocol_fee" text,
	"winner_payout" text,
	"total_rounds" smallint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"listing_id" bigint PRIMARY KEY NOT NULL,
	"token_id" bigint NOT NULL,
	"seller" text NOT NULL,
	"price" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"buyer" text,
	"listed_at" timestamp DEFAULT now() NOT NULL,
	"sold_at" timestamp,
	"cancelled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "price_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"token_id" bigint NOT NULL,
	"price" text NOT NULL,
	"seller" text NOT NULL,
	"buyer" text,
	"tx_hash" text,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "breeds" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "breeds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"parent_a" bigint NOT NULL,
	"parent_b" bigint NOT NULL,
	"offspring_id" bigint NOT NULL,
	"cost" text NOT NULL,
	"parent_a_breed_index" smallint NOT NULL,
	"parent_b_breed_index" smallint NOT NULL,
	"offspring_generation" smallint NOT NULL,
	"tx_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"season" integer PRIMARY KEY NOT NULL,
	"total_emission" text NOT NULL,
	"base_reward" text NOT NULL,
	"total_minted" text DEFAULT '0' NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"address" text PRIMARY KEY NOT NULL,
	"elo" integer DEFAULT 1200 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"total_battles" integer DEFAULT 0 NOT NULL,
	"total_expeditions" integer DEFAULT 0 NOT NULL,
	"total_breeds" integer DEFAULT 0 NOT NULL,
	"registered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matchmaking_queue" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "matchmaking_queue_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"address" text NOT NULL,
	"team_id" bigint NOT NULL,
	"stake_bracket" smallint NOT NULL,
	"elo" integer NOT NULL,
	"enqueued_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"contract_name" text PRIMARY KEY NOT NULL,
	"last_processed_block" bigint NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "on_chain_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "on_chain_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"contract_name" text NOT NULL,
	"event_name" text NOT NULL,
	"block_number" bigint NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"args" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
