CREATE TABLE "mining_epochs" (
	"season" integer NOT NULL,
	"epoch" integer NOT NULL,
	"trailing_weight" text NOT NULL,
	"cap" text NOT NULL,
	"block_number" bigint,
	"tx_hash" text,
	"rolled_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mining_epochs_season_epoch_pk" PRIMARY KEY("season","epoch")
);
