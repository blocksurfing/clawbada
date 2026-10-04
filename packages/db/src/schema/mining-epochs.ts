import { pgTable, integer, text, bigint, timestamp, primaryKey } from 'drizzle-orm/pg-core';

/**
 * I11 (review 2026-10-03): one row per hourly glide epoch, mirrored from MiningPool.EpochRolled —
 * the demand estimate the new epoch paces against (tier-weight units per hour, the 4-epoch window
 * average) and its spend ceiling (wei). At most 1,440 rows a season. The ledger for dashboards and
 * for any later tuning argument, without replaying the contract.
 */
export const miningEpochs = pgTable(
  'mining_epochs',
  {
    season: integer('season').notNull(),
    epoch: integer('epoch').notNull(),
    /** Average tier-weight units served per hour over the demand window (whole units). */
    trailingWeight: text('trailing_weight').notNull(),
    /** This epoch's spend ceiling in wei. */
    cap: text('cap').notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }),
    txHash: text('tx_hash'),
    /** Block time of the roll (the first touch of the epoch). */
    rolledAt: timestamp('rolled_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.season, t.epoch] })],
);
