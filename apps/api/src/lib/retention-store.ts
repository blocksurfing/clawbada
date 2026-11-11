/**
 * The deletes behind lib/retention.ts, over drizzle. What may go, and why a real or a live battle never does, is
 * described there; this file only has to pick exactly those rows.
 */
import { and, eq, inArray, lt, ne, notExists, or } from 'drizzle-orm';
import { db, battleSessions, battleTurns, friendRooms, type Database } from '@clawbada/db';
import type { RetentionStore } from './retention';

const OFF_CHAIN_KINDS = ['practice', 'friend'];
const OVER = ['finished', 'abandoned'];

export class DbRetentionStore implements RetentionStore {
  constructor(private readonly dbx: Database = db) {}

  async purgeSessions(olderThan: Date, limit: number): Promise<{ sessions: number; turns: number }> {
    // One transaction per batch: a battle never loses its turns and keeps its row, or the reverse.
    return this.dbx.transaction(async (tx) => {
      const old = and(inArray(battleSessions.kind, OFF_CHAIN_KINDS), inArray(battleSessions.status, OVER), lt(battleSessions.updatedAt, olderThan));
      const picked = await tx.select({ id: battleSessions.id }).from(battleSessions).where(old).limit(limit);
      if (picked.length === 0) return { sessions: 0, turns: 0 };
      // The same test again on the delete: only ids that are still old, off-chain and over go, and only their turns.
      const gone = await tx.delete(battleSessions).where(and(inArray(battleSessions.id, picked.map((r) => r.id)), old)).returning({ id: battleSessions.id });
      if (gone.length === 0) return { sessions: 0, turns: 0 };
      const turns = await tx.delete(battleTurns).where(inArray(battleTurns.sessionId, gone.map((r) => r.id)));
      return { sessions: gone.length, turns: turns.count };
    });
  }

  async purgeRooms(olderThan: Date, limit: number): Promise<number> {
    // Every change to a room writes updated_at, so an old one is long expired, cancelled or played. The one
    // exception kept: a room whose battle is still live (it cannot be after this long, but never delete under one).
    const battleLive = this.dbx.select({ id: battleSessions.id }).from(battleSessions)
      .where(and(eq(battleSessions.id, friendRooms.battleId), eq(battleSessions.status, 'active')));
    const old = and(lt(friendRooms.updatedAt, olderThan), or(ne(friendRooms.status, 'in_battle'), notExists(battleLive)));
    const picked = await this.dbx.select({ id: friendRooms.id }).from(friendRooms).where(old).limit(limit);
    if (picked.length === 0) return 0;
    const gone = await this.dbx.delete(friendRooms).where(and(inArray(friendRooms.id, picked.map((r) => r.id)), old)).returning({ id: friendRooms.id });
    return gone.length;
  }
}
