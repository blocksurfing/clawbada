import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const seasons = pgTable('seasons', {
  season: integer('season').primaryKey(),
  totalEmission: text('total_emission').notNull(), // $CLAW budget
  baseReward: text('base_reward').notNull(), // Current base reward per expedition
  totalMinted: text('total_minted').notNull().default('0'),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time'),
});
