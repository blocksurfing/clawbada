import { pgTable, text, bigint, boolean, timestamp } from 'drizzle-orm/pg-core';

export const teams = pgTable('teams', {
  teamId: bigint('team_id', { mode: 'bigint' }).primaryKey(),
  owner: text('owner').notNull(),
  lobster0: bigint('lobster_0', { mode: 'bigint' }).notNull(),
  lobster1: bigint('lobster_1', { mode: 'bigint' }).notNull(),
  lobster2: bigint('lobster_2', { mode: 'bigint' }).notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
