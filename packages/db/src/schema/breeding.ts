import { pgTable, text, bigint, smallint, timestamp } from 'drizzle-orm/pg-core';

export const breeds = pgTable('breeds', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  parentA: bigint('parent_a', { mode: 'bigint' }).notNull(),
  parentB: bigint('parent_b', { mode: 'bigint' }).notNull(),
  offspringId: bigint('offspring_id', { mode: 'bigint' }).notNull(),
  cost: text('cost').notNull(), // Total $CLAW cost as string
  parentABreedIndex: smallint('parent_a_breed_index').notNull(),
  parentBBreedIndex: smallint('parent_b_breed_index').notNull(),
  offspringGeneration: smallint('offspring_generation').notNull(),
  txHash: text('tx_hash'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
