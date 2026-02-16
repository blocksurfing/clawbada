import { pgTable, text, integer, boolean, bigint, smallint, timestamp } from 'drizzle-orm/pg-core';

export const lobsters = pgTable('lobsters', {
  tokenId: bigint('token_id', { mode: 'bigint' }).primaryKey(),
  owner: text('owner').notNull(),
  // uint256 DNA stored as text (exceeds JS bigint safe range for certain ops)
  dna: text('dna').notNull(),
  class: smallint('class').notNull(), // 0-9 LobsterClass
  legend: smallint('legend').notNull().default(0), // 0=normal, 1=legend
  breedType: smallint('breed_type').notNull().default(0),
  purity: smallint('purity').notNull().default(0), // 0-6
  evolutionTier: smallint('evolution_tier').notNull().default(0), // 0-3
  damage: smallint('damage').notNull().default(0), // 0-100
  breedCount: smallint('breed_count').notNull().default(0), // 0-5
  generation: smallint('generation').notNull().default(0),
  soulbound: boolean('soulbound').notNull().default(false),
  locked: boolean('locked').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
