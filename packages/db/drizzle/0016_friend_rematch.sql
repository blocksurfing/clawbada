ALTER TABLE "friend_rooms" ADD COLUMN "rematch_of" text;--> statement-breakpoint
ALTER TABLE "friend_rooms" ADD COLUMN "rematch_by" text;--> statement-breakpoint
CREATE UNIQUE INDEX "friend_rooms_rematch_of_uq" ON "friend_rooms" USING btree ("rematch_of");