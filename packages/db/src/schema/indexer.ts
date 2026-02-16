import { pgTable, text, bigint, timestamp } from 'drizzle-orm/pg-core';

export const indexerState = pgTable('indexer_state', {
  contractName: text('contract_name').primaryKey(),
  lastProcessedBlock: bigint('last_processed_block', { mode: 'bigint' }).notNull().default(0n),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
