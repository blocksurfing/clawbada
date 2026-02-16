import { pgTable, text, bigint, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const onChainEvents = pgTable('on_chain_events', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  contractName: text('contract_name').notNull(),
  eventName: text('event_name').notNull(),
  blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
  txHash: text('tx_hash').notNull(),
  logIndex: integer('log_index').notNull(),
  args: jsonb('args').notNull(), // Decoded event arguments
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
