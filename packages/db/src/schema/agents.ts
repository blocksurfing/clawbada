import { pgTable, text, integer, bigint, smallint, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const agents = pgTable('agents', {
  address: text('address').primaryKey(),
  elo: integer('elo').notNull().default(1200),
  wins: integer('wins').notNull().default(0),
  losses: integer('losses').notNull().default(0),
  totalBattles: integer('total_battles').notNull().default(0),
  totalExpeditions: integer('total_expeditions').notNull().default(0),
  totalBreeds: integer('total_breeds').notNull().default(0),
  registeredAt: timestamp('registered_at').defaultNow().notNull(),
});

/** V3 S1 Power Matchmaking queue. Keyed by (stakeBracket, powerScore) sub-pools.
 *  ELO column kept for telemetry but NOT used for matching at launch (deferred to S1.5). */
export const matchmakingQueue = pgTable(
  'matchmaking_queue',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    address: text('address').notNull(),
    teamId: bigint('team_id', { mode: 'bigint' }).notNull(),
    stakeBracket: smallint('stake_bracket').notNull(), // 0=Low, 1=Mid, 2=High
    /** Team Power score 3..9 (Evolved=1 + Elite=2 + Apex=3 across 3 lobsters). */
    powerScore: smallint('power_score').notNull(),
    elo: integer('elo').notNull(),
    enqueuedAt: timestamp('enqueued_at').defaultNow().notNull(),
  },
  (t) => ({
    /** One queue entry per address. Enforces the "already in queue" check at the DB layer. */
    addressUnique: uniqueIndex('matchmaking_queue_address_uniq').on(t.address),
    /** Bucket lookup index — the matchmaker scans by (stake, power) for tryMatch. */
    bucketIdx: index('matchmaking_queue_bucket_idx').on(t.stakeBracket, t.powerScore, t.enqueuedAt),
  }),
);

/** V3 S1 telemetry — cancel decisions, expansion expirations, etc. Used post-launch to
 *  decide whether to ship cancel-rate throttling / unbounded queue timeout. Append-only. */
export const matchmakingDecisions = pgTable(
  'matchmaking_decisions',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    address: text('address').notNull(),
    /** join | cancel | matched | expanded | matched-after-expansion */
    decision: text('decision').notNull(),
    stakeBracket: smallint('stake_bracket').notNull(),
    powerScore: smallint('power_score').notNull(),
    /** seconds since enqueuedAt at the time of this decision; null for join */
    elapsedSec: integer('elapsed_sec'),
    /** Optional opaque metadata (e.g. opponentAddress, opponentPower, current radius) */
    meta: text('meta'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    addrIdx: index('matchmaking_decisions_addr_idx').on(t.address, t.createdAt),
  }),
);
