import { pgTable, text, jsonb, boolean, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Battle Friends lobby (owner 2026-10-28): a host opens a room and shares a link; the first player to open it takes
 * the guest seat; both pick a team (hidden from each other until both lock in) and press ready; the battle then runs
 * as a `battle_sessions` row of kind 'friend'. Just for fun — nothing here is ever staked or rated.
 *
 * The invite secret is never stored: only its SHA-256 (`secret_hash`), so a database leak yields no usable links.
 * Host and guest are lowercase addresses — a wallet, or a guest session's address (no wallet needed on either side).
 */
export const friendRooms = pgTable(
  'friend_rooms',
  {
    /** `r_<uuid>` */
    id: text('id').primaryKey(),
    host: text('host').notNull(),
    guest: text('guest'),
    secretHash: text('secret_hash').notNull(),
    /** open → seated → (both teams locked, both ready) in_battle → ended; or expired / cancelled. */
    status: text('status').notNull().default('open'),
    /** `{ classes: [3 class names], tier, purity }` once locked; never sent to the other player before both lock. */
    hostTeam: jsonb('host_team'),
    guestTeam: jsonb('guest_team'),
    hostReady: boolean('host_ready').notNull().default(false),
    guestReady: boolean('guest_ready').notNull().default(false),
    /** Board: 'dojo' by default. */
    arena: text('arena').notNull().default('dojo'),
    /** The `f_<uuid>` battle once started. */
    battleId: text('battle_id'),
    /** An open room expires (15 min); a seated lobby gets a fresh window when the guest joins. */
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    hostIdx: index('friend_rooms_host_status_idx').on(t.host, t.status),
    guestIdx: index('friend_rooms_guest_status_idx').on(t.guest, t.status),
    statusCk: check('friend_rooms_status_ck', sql`${t.status} IN ('open', 'seated', 'in_battle', 'ended', 'expired', 'cancelled')`),
  }),
);
