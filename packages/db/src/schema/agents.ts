import { pgTable, text, integer, bigint, smallint, timestamp } from 'drizzle-orm/pg-core';

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

export const matchmakingQueue = pgTable('matchmaking_queue', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  address: text('address').notNull(),
  teamId: bigint('team_id', { mode: 'bigint' }).notNull(),
  stakeBracket: smallint('stake_bracket').notNull(), // 0=Low, 1=Mid, 2=High
  elo: integer('elo').notNull(),
  enqueuedAt: timestamp('enqueued_at').defaultNow().notNull(),
});
