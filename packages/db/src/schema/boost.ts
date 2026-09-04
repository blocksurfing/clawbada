import {
  pgTable,
  text,
  integer,
  bigint,
  smallint,
  numeric,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Battle-rank mining boost (S1, locked 2026-09-02) — server-side state.
 *
 * Rating is TEAM-keyed. Battles count as "played" the moment the match ends on chain
 * (`BattleProposed`), rating moves when the result is final (`BattleSettled`), and the
 * weekly epoch job turns one global ladder into the `teamId → boostBps` table that
 * MiningPool.setTeamBoosts / activateBoostEpoch post on chain.
 */

/** One row per team that has ever been rated. Retained after disband: it is the lineage
 *  parent for the roster's successor (see `lineageConsumedBy`). */
export const teamRatings = pgTable(
  'team_ratings',
  {
    teamId: bigint('team_id', { mode: 'bigint' }).primaryKey(),
    owner: text('owner').notNull(),
    rating: integer('rating').notNull().default(1200),
    /** Team Power (3..9) the rating was earned at. A change triggers a full re-qualification. */
    power: smallint('power').notNull(),
    /** Window index the played counter below refers to. */
    epochId: integer('epoch_id').notNull(),
    /** Cache of battles played this window; `battle_participation` is authoritative. */
    gamesPlayedEpoch: integer('games_played_epoch').notNull().default(0),
    gamesPlayedTotal: integer('games_played_total').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    losses: integer('losses').notNull().default(0),
    /** Disbanded team this rating descends from (largest lobster overlap), if any. */
    lineageParentId: bigint('lineage_parent_id', { mode: 'bigint' }),
    lineageShared: smallint('lineage_shared'),
    /** fresh | inherited | power_changed */
    lineageReason: text('lineage_reason').notNull().default('fresh'),
    /** Set on a disbanded team once a successor inherited from it — a rating can seed exactly one successor. */
    lineageConsumedBy: bigint('lineage_consumed_by', { mode: 'bigint' }),
    lastBattleAt: timestamp('last_battle_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    ratingIdx: index('team_ratings_rating_idx').on(t.rating),
    ownerIdx: index('team_ratings_owner_idx').on(t.owner),
  }),
);

/** The "played" ledger: one row per (battle, team). Written at BattleProposed (match ended,
 *  result not yet final) and upserted at BattleSettled (covers Active-phase forfeits, which
 *  settle without a proposal). Cancelled battles never appear. */
export const battleParticipation = pgTable(
  'battle_participation',
  {
    battleId: bigint('battle_id', { mode: 'bigint' }).notNull(),
    teamId: bigint('team_id', { mode: 'bigint' }).notNull(),
    opponentTeamId: bigint('opponent_team_id', { mode: 'bigint' }),
    /** Window index the battle counts toward. */
    epochId: integer('epoch_id').notNull(),
    /** played | forfeit_loss */
    kind: text('kind').notNull().default('played'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.battleId, t.teamId] }),
    teamEpochIdx: index('battle_participation_team_epoch_idx').on(t.teamId, t.epochId),
    epochIdx: index('battle_participation_epoch_idx').on(t.epochId),
  }),
);

/** Immutable rating ledger + idempotency guard. */
export const ratingEvents = pgTable(
  'rating_events',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    /** 0 for non-battle kinds. */
    battleId: bigint('battle_id', { mode: 'bigint' }).notNull().default(sql`0`),
    teamId: bigint('team_id', { mode: 'bigint' }).notNull(),
    opponentTeamId: bigint('opponent_team_id', { mode: 'bigint' }),
    epochId: integer('epoch_id').notNull(),
    /** battle | forfeit_loss | idle_decay | lineage | power_reset | dispute_reversal */
    kind: text('kind').notNull(),
    /** 1 win, 0 loss, null n/a */
    outcome: smallint('outcome'),
    ratingBefore: integer('rating_before').notNull(),
    ratingAfter: integer('rating_after').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    /** A battle moves a team's rating at most once, however many writers replay it. */
    battleUq: uniqueIndex('rating_events_battle_team_uq')
      .on(t.battleId, t.teamId)
      .where(sql`${t.kind} IN ('battle', 'forfeit_loss')`),
    /** Idle decay is applied at most once per (team, epoch) — re-running the job is a no-op. */
    decayUq: uniqueIndex('rating_events_decay_uq')
      .on(t.teamId, t.epochId)
      .where(sql`${t.kind} = 'idle_decay'`),
    teamEpochIdx: index('rating_events_team_epoch_idx').on(t.teamId, t.epochId),
    epochIdx: index('rating_events_epoch_idx').on(t.epochId),
  }),
);

/** One row per weekly window. Boosts EARNED in window `epochId` are posted on chain as
 *  `chainEpoch = epochId + 1` and are live during the next window. */
export const boostEpochs = pgTable('boost_epochs', {
  epochId: integer('epoch_id').primaryKey(),
  chainEpoch: integer('chain_epoch').notNull(),
  startsAt: timestamp('starts_at').notNull(),
  endsAt: timestamp('ends_at').notNull(),
  /** Battles-played floor for this window. Written once; never overwritten by the job. */
  floorPlayed: smallint('floor_played').notNull(),
  /** announced | active | closing | computed | staged | activated | failed */
  status: text('status').notNull().default('announced'),
  ratedCount: integer('rated_count'),
  qualifiedCount: integer('qualified_count'),
  lapsedCount: integer('lapsed_count'),
  avgBoostBps: integer('avg_boost_bps'),
  /** operator_jobs ids for the set_team_boosts batches, in batch order. */
  setJobIds: jsonb('set_job_ids').notNull().default([]),
  activateJobId: bigint('activate_job_id', { mode: 'bigint' }),
  activateTxHash: text('activate_tx_hash'),
  activatedAt: timestamp('activated_at'),
  /** Telemetry flags: repeated-opponent pairs, same-owner pairs, cache mismatches. */
  flags: jsonb('flags'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** The posted ladder: one row per (chain epoch, team). */
export const teamBoosts = pgTable(
  'team_boosts',
  {
    /** CHAIN epoch the boost is live in (matches MiningPool.TeamBoostSet.epoch). */
    epochId: integer('epoch_id').notNull(),
    teamId: bigint('team_id', { mode: 'bigint' }).notNull(),
    earnedEpochId: integer('earned_epoch_id').notNull(),
    rating: integer('rating').notNull(),
    rank: integer('rank').notNull(),
    percentile: numeric('percentile', { precision: 8, scale: 6 }).notNull(),
    boostBps: smallint('boost_bps').notNull(),
    power: smallint('power').notNull(),
    gamesPlayed: integer('games_played').notNull(),
    batchIndex: smallint('batch_index').notNull(),
    txHash: text('tx_hash'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.epochId, t.teamId] }),
    teamIdx: index('team_boosts_team_idx').on(t.teamId),
  }),
);
