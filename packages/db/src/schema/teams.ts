import { pgTable, text, bigint, boolean, timestamp, index } from 'drizzle-orm/pg-core';

export const teams = pgTable('teams', {
  teamId: bigint('team_id', { mode: 'bigint' }).primaryKey(),
  owner: text('owner').notNull(),
  lobster0: bigint('lobster_0', { mode: 'bigint' }).notNull(),
  lobster1: bigint('lobster_1', { mode: 'bigint' }).notNull(),
  lobster2: bigint('lobster_2', { mode: 'bigint' }).notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  /** Set by the indexer on TeamDisbanded. On chain a roster change is disband + create
   *  (new teamId), so this is what makes a disbanded team resolvable as a lineage parent
   *  for its successor's rating. NULL = live. */
  disbandedAt: timestamp('disbanded_at'),
}, (t) => ({
  ownerIdx: index('teams_owner_idx').on(t.owner),
  lobster0Idx: index('teams_lobster_0_idx').on(t.lobster0),
  lobster1Idx: index('teams_lobster_1_idx').on(t.lobster1),
  lobster2Idx: index('teams_lobster_2_idx').on(t.lobster2),
}));
