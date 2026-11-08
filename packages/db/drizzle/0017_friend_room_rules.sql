ALTER TABLE "friend_rooms" ADD COLUMN "tier" text DEFAULT 'elite' NOT NULL;--> statement-breakpoint
ALTER TABLE "friend_rooms" ADD COLUMN "purity" smallint DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "friend_rooms" ADD CONSTRAINT "friend_rooms_tier_ck" CHECK ("friend_rooms"."tier" IN ('evolved', 'elite', 'apex'));--> statement-breakpoint
ALTER TABLE "friend_rooms" ADD CONSTRAINT "friend_rooms_purity_ck" CHECK ("friend_rooms"."purity" BETWEEN 0 AND 6);