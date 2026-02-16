import { pgTable, text, bigint, boolean, timestamp } from 'drizzle-orm/pg-core';

export const listings = pgTable('listings', {
  listingId: bigint('listing_id', { mode: 'bigint' }).primaryKey(),
  tokenId: bigint('token_id', { mode: 'bigint' }).notNull(),
  seller: text('seller').notNull(),
  price: text('price').notNull(), // $CLAW amount as string
  active: boolean('active').notNull().default(true),
  buyer: text('buyer'),
  listedAt: timestamp('listed_at').defaultNow().notNull(),
  soldAt: timestamp('sold_at'),
  cancelledAt: timestamp('cancelled_at'),
});

export const priceHistory = pgTable('price_history', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  tokenId: bigint('token_id', { mode: 'bigint' }).notNull(),
  price: text('price').notNull(),
  seller: text('seller').notNull(),
  buyer: text('buyer'),
  txHash: text('tx_hash'),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
});
