-- Codex PR-C P1: enforce (battle_id, round) uniqueness on battle_rounds so
-- the resolve_round handler's `ON CONFLICT DO NOTHING` is effective. Pre-PR-C
-- the table had only an identity PK; a retry after a successful round insert
-- but before chain currentRound advance would silently insert duplicate
-- rows for the same (battle, round). Idempotent — re-running this migration
-- skips if the index already exists.

CREATE UNIQUE INDEX IF NOT EXISTS "battle_rounds_battle_round_uniq" ON "battle_rounds" USING btree ("battle_id","round");
