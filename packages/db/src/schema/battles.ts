import { pgTable, text, bigint, integer, smallint, jsonb, timestamp, check, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const battles = pgTable('battles', {
  battleId: bigint('battle_id', { mode: 'bigint' }).primaryKey(),
  playerA: text('player_a').notNull(),
  playerB: text('player_b').notNull(),
  teamA: bigint('team_a', { mode: 'bigint' }).notNull(),
  teamB: bigint('team_b', { mode: 'bigint' }).notNull(),
  /** A2 (May 2026 audit): team IDs each player queued with, persisted at
   *  match creation. `chain.teamIdA/teamIdB` are 0 until `revealTeam` lands,
   *  so the frontend's commit-hash preimage previously bound `teamId = 0`
   *  → reveal reverts. The API exposes only the caller's own queued team
   *  ID; the opponent's stays redacted to preserve commit-reveal secrecy. */
  queuedTeamA: bigint('queued_team_a', { mode: 'bigint' }),
  queuedTeamB: bigint('queued_team_b', { mode: 'bigint' }),
  stakeBracket: smallint('stake_bracket').notNull(), // 0=Low, 1=Mid, 2=High
  stakeAmount: text('stake_amount').notNull(), // $CLAW
  phase: smallint('phase').notNull().default(0), // BattlePhase enum
  // F5-01: server-custodied team-reveal salts. In the atomic-reveal flow players send their
  // salt to the server (they do NOT reveal on-chain); the engine submits revealTeams for both
  // at once via the operator key. Transient — set NULL again once revealTeams confirms, so a
  // revealed team's salt is not retained. teamId is already captured in teamA/teamB.
  revealSaltA: text('reveal_salt_a'),
  revealSaltB: text('reveal_salt_b'),
  /** PR-A (X1+X2 foundation): orthogonal to `phase` (which mirrors the
   *  contract enum). Tracks the operator-worker lifecycle so the frontend
   *  can distinguish "matchmaker decided, awaiting on-chain createBattle"
   *  from "battle is live on chain." Nullable in PR-A (purely additive);
   *  PR-B writes `0=pending_create` at matchmaker time, transitions to
   *  `1=created` on tx confirm, and the indexer fallback insert writes
   *  `1=created` directly. Values: 0=pending_create, 1=created, 2=settled,
   *  3=cancelled, 4=create_failed. */
  status: smallint('status'),
  /** F-04: power snapshot recorded at createBattle time and bound on-chain.
   *  revealTeam reverts if the team's current power doesn't match. Mirrors
   *  the BattleArena.Battle.powerA/powerB fields. Range 3..9. */
  powerA: smallint('power_a'),
  powerB: smallint('power_b'),
  winner: text('winner'),
  protocolFee: text('protocol_fee'),
  winnerPayout: text('winner_payout'),
  totalRounds: smallint('total_rounds'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  settledAt: timestamp('settled_at'),
}, (t) => ({
  /** Codex PR-A LOW-FU4: enforce documented status range at the DB layer
   *  via drizzle's check() DSL so the constraint survives future
   *  schema-generation passes (manual-SQL-only CHECKs would drift). */
  statusCk: check('battles_status_ck', sql`${t.status} IS NULL OR ${t.status} IN (0, 1, 2, 3, 4)`),
  /** Boost telemetry: battle duration (created_at → settled_at) and per-team history. */
  settledAtIdx: index('battles_settled_at_idx').on(t.settledAt),
  teamAIdx: index('battles_team_a_idx').on(t.teamA),
  teamBIdx: index('battles_team_b_idx').on(t.teamB),
}));

export const battleRounds = pgTable('battle_rounds', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  battleId: bigint('battle_id', { mode: 'bigint' }).notNull(),
  round: smallint('round').notNull(),
  // JSON array of round actions (moves, damage, crits, etc.)
  // PR-C P0: damage field is bigint at the type level; serialized to
  // string before insert by the resolve_round handler (drizzle's JSONB
  // uses JSON.stringify which throws on bigint).
  actions: jsonb('actions').notNull(),
  teamAHp: jsonb('team_a_hp').notNull(), // [bigint, bigint, bigint] as strings
  teamBHp: jsonb('team_b_hp').notNull(),
  vrfSeed: text('vrf_seed'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  /** Codex PR-C P1: makes the resolve_round handler's
   *  `onConflictDoNothing({ target: [battleId, round] })` effective. Pre-PR-C
   *  the table had only an identity PK, so retry-after-partial-success
   *  silently inserted duplicate rows for the same (battle, round). */
  battleRoundUniq: uniqueIndex('battle_rounds_battle_round_uniq').on(t.battleId, t.round),
}));
