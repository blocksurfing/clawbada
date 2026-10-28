/**
 * friend_rooms over drizzle. Each state change is ONE conditional UPDATE … RETURNING, so two requests racing for the
 * same seat or the same start can never both win (no transaction or lock needed).
 */
import { and, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db, friendRooms, type Database } from '@clawbada/db';
import type { FriendRoomRepo, FriendRoomRow, FriendTeam, FriendRoomStatus } from './service';

type Row = typeof friendRooms.$inferSelect;
const toRow = (r: Row): FriendRoomRow => ({
  id: r.id,
  host: r.host,
  guest: r.guest,
  secretHash: r.secretHash,
  status: r.status as FriendRoomStatus,
  hostTeam: (r.hostTeam as FriendTeam | null) ?? null,
  guestTeam: (r.guestTeam as FriendTeam | null) ?? null,
  hostReady: r.hostReady,
  guestReady: r.guestReady,
  arena: r.arena as FriendRoomRow['arena'],
  battleId: r.battleId,
  expiresAt: r.expiresAt,
});

export class DbFriendRoomRepo implements FriendRoomRepo {
  constructor(private readonly dbx: Database = db) {}

  async insert(row: FriendRoomRow): Promise<void> {
    await this.dbx.insert(friendRooms).values({ ...row, hostTeam: row.hostTeam, guestTeam: row.guestTeam });
  }

  async get(id: string): Promise<FriendRoomRow | null> {
    const [r] = await this.dbx.select().from(friendRooms).where(eq(friendRooms.id, id)).limit(1);
    return r ? toRow(r) : null;
  }

  async cancelUnstartedOf(host: string): Promise<void> {
    await this.dbx.update(friendRooms).set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(friendRooms.host, host), inArray(friendRooms.status, ['open', 'seated'])));
  }

  async claimGuest(id: string, secretHash: string, guest: string, now: Date, lobbyExpiresAt: Date): Promise<FriendRoomRow | null> {
    const [r] = await this.dbx.update(friendRooms)
      .set({ guest, status: 'seated', expiresAt: lobbyExpiresAt, updatedAt: new Date() })
      .where(and(
        eq(friendRooms.id, id), eq(friendRooms.secretHash, secretHash), eq(friendRooms.status, 'open'),
        isNull(friendRooms.guest), gt(friendRooms.expiresAt, now), ne(friendRooms.host, guest),
      ))
      .returning();
    return r ? toRow(r) : null;
  }

  async setTeam(id: string, seat: 'host' | 'guest', team: FriendTeam): Promise<FriendRoomRow | null> {
    const patch = seat === 'host' ? { hostTeam: team, hostReady: false } : { guestTeam: team, guestReady: false };
    const [r] = await this.dbx.update(friendRooms).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(friendRooms.id, id), eq(friendRooms.status, 'seated'))).returning();
    return r ? toRow(r) : null;
  }

  async setReady(id: string, seat: 'host' | 'guest'): Promise<FriendRoomRow | null> {
    const patch = seat === 'host' ? { hostReady: true } : { guestReady: true };
    const [r] = await this.dbx.update(friendRooms).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(friendRooms.id, id), eq(friendRooms.status, 'seated'))).returning();
    return r ? toRow(r) : null;
  }

  async beginBattle(id: string): Promise<FriendRoomRow | null> {
    const [r] = await this.dbx.update(friendRooms).set({ status: 'in_battle', updatedAt: new Date() })
      .where(and(
        eq(friendRooms.id, id), eq(friendRooms.status, 'seated'), eq(friendRooms.hostReady, true), eq(friendRooms.guestReady, true),
        sql`${friendRooms.hostTeam} IS NOT NULL`, sql`${friendRooms.guestTeam} IS NOT NULL`,
      ))
      .returning();
    return r ? toRow(r) : null;
  }

  async setBattle(id: string, battleId: string): Promise<void> {
    await this.dbx.update(friendRooms).set({ battleId, updatedAt: new Date() }).where(eq(friendRooms.id, id));
  }

  async revertStart(id: string): Promise<void> {
    await this.dbx.update(friendRooms).set({ status: 'seated', hostReady: false, guestReady: false, updatedAt: new Date() })
      .where(and(eq(friendRooms.id, id), eq(friendRooms.status, 'in_battle'), isNull(friendRooms.battleId)));
  }

  async setStatus(id: string, status: FriendRoomStatus): Promise<void> {
    await this.dbx.update(friendRooms).set({ status, updatedAt: new Date() }).where(eq(friendRooms.id, id));
  }
}
