import type { FriendRoomRepo, FriendRoomRow, FriendRoomStatus, FriendTeam } from './service';

/** In-memory twin of DbFriendRoomRepo (same conditions), for tests. */
export class MemoryFriendRoomRepo implements FriendRoomRepo {
  rows = new Map<string, FriendRoomRow>();
  async insert(row: FriendRoomRow) { this.rows.set(row.id, { ...row }); }
  async get(id: string) { const r = this.rows.get(id); return r ? { ...r } : null; }
  async cancelUnstartedOf(host: string) { for (const r of this.rows.values()) if (r.host === host && (r.status === 'open' || r.status === 'seated')) r.status = 'cancelled'; }
  async claimGuest(id: string, secretHash: string, guest: string, now: Date, lobbyExpiresAt: Date) {
    const r = this.rows.get(id);
    if (!r || r.secretHash !== secretHash || r.status !== 'open' || r.guest !== null || r.expiresAt <= now || r.host === guest) return null;
    Object.assign(r, { guest, status: 'seated' as FriendRoomStatus, expiresAt: lobbyExpiresAt });
    return { ...r };
  }
  async setTeam(id: string, seat: 'host' | 'guest', team: FriendTeam) {
    const r = this.rows.get(id);
    if (!r || r.status !== 'seated') return null;
    if (seat === 'host') Object.assign(r, { hostTeam: team, hostReady: false }); else Object.assign(r, { guestTeam: team, guestReady: false });
    return { ...r };
  }
  async setReady(id: string, seat: 'host' | 'guest') {
    const r = this.rows.get(id);
    if (!r || r.status !== 'seated') return null;
    if (seat === 'host') r.hostReady = true; else r.guestReady = true;
    return { ...r };
  }
  async beginBattle(id: string) {
    const r = this.rows.get(id);
    if (!r || r.status !== 'seated' || !r.hostReady || !r.guestReady || !r.hostTeam || !r.guestTeam) return null;
    r.status = 'in_battle';
    return { ...r };
  }
  async setBattle(id: string, battleId: string) { this.rows.get(id)!.battleId = battleId; }
  async revertStart(id: string) { const r = this.rows.get(id); if (r && r.status === 'in_battle' && !r.battleId) Object.assign(r, { status: 'seated' as FriendRoomStatus, hostReady: false, guestReady: false }); }
  async setStatus(id: string, status: FriendRoomStatus) { this.rows.get(id)!.status = status; }
  async insertRematch(row: FriendRoomRow) {
    if ([...this.rows.values()].some((r) => r.rematchOf === row.rematchOf)) return null;
    this.rows.set(row.id, { ...row });
    return { ...row };
  }
  async findRematchOf(roomId: string) { const r = [...this.rows.values()].find((x) => x.rematchOf === roomId); return r ? { ...r } : null; }
}
