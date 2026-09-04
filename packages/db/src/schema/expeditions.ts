import { pgTable, text, bigint, integer, smallint, boolean, timestamp } from 'drizzle-orm/pg-core';

export const expeditions = pgTable('expeditions', {
  expeditionId: bigint('expedition_id', { mode: 'bigint' }).primaryKey(),
  teamId: bigint('team_id', { mode: 'bigint' }).notNull(),
  owner: text('owner').notNull(),
  season: integer('season').notNull(),
  mineTier: smallint('mine_tier').notNull(), // 0-3
  startTime: bigint('start_time', { mode: 'bigint' }).notNull(), // unix timestamp
  reward: text('reward').notNull(), // $CLAW amount as string
  /** Battle-rank boost applied at start (bps, 0..5000), from ExpeditionStarted.boostBps.
   *  NULL for rows indexed before the boost shipped. Source for "boost uptake by tier". */
  boostBps: smallint('boost_bps'),
  claimed: boolean('claimed').notNull().default(false),
  claimedAt: timestamp('claimed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
