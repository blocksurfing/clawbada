/**
 * Battle Friends lobby (owner 2026-10-28) — the rules, separate from storage so they can be tested in memory.
 *
 *   create  → a host opens a room; the invite secret (128 bits) goes back once and only its hash is stored.
 *             Opening a new room cancels the host's older unstarted rooms (one live invite at a time).
 *   join    → the first player who presents the secret takes the guest seat (atomic, single use). The host cannot
 *             take their own seat; a wrong, used, expired or cancelled link all answer the same "not found".
 *   team    → each player builds a team (3 classes, tier, purity); the other player only ever learns "locked in".
 *   ready   → once both have a team and both are ready, the battle starts (kind 'friend', host = A, guest = B).
 *   cancel  → either player, before the battle starts.
 *
 * Nobody needs a wallet: host and guest are addresses of wallet OR guest sessions. Nothing here is staked or rated.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const FRIEND_CLASSES = ['bulwark', 'mantis', 'leviathan', 'tempest', 'specter', 'sentinel', 'reaver', 'abyss', 'kraken', 'ember'] as const;
export const FRIEND_TIERS = ['evolved', 'elite', 'apex'] as const;
export const FRIEND_ARENAS = ['dojo', 'evolved', 'elite', 'apex'] as const;
export type FriendTier = (typeof FRIEND_TIERS)[number];
export type FriendArena = (typeof FRIEND_ARENAS)[number];
export interface FriendTeam { classes: [string, string, string]; tier: FriendTier; purity: number }
export type FriendRoomStatus = 'open' | 'seated' | 'in_battle' | 'ended' | 'expired' | 'cancelled';

export interface FriendRoomRow {
  id: string;
  host: string;
  guest: string | null;
  secretHash: string;
  status: FriendRoomStatus;
  hostTeam: FriendTeam | null;
  guestTeam: FriendTeam | null;
  hostReady: boolean;
  guestReady: boolean;
  arena: FriendArena;
  battleId: string | null;
  expiresAt: Date;
}

/** Storage. Every method that changes a room is a single atomic step in the real implementation (repo.ts). */
export interface FriendRoomRepo {
  insert(row: FriendRoomRow): Promise<void>;
  get(id: string): Promise<FriendRoomRow | null>;
  /** Cancel the host's rooms that have not started (status open | seated). */
  cancelUnstartedOf(host: string): Promise<void>;
  /** Seat `guest` if the room is open, unexpired, the hash matches and the seat is free; the updated row or null. */
  claimGuest(id: string, secretHash: string, guest: string, now: Date, lobbyExpiresAt: Date): Promise<FriendRoomRow | null>;
  /** Set one player's team (and clear their ready) while the room is seated. */
  setTeam(id: string, seat: 'host' | 'guest', team: FriendTeam): Promise<FriendRoomRow | null>;
  setReady(id: string, seat: 'host' | 'guest'): Promise<FriendRoomRow | null>;
  /** seated → in_battle only if both teams are set and both ready; the row if this call won the transition. */
  beginBattle(id: string): Promise<FriendRoomRow | null>;
  setBattle(id: string, battleId: string): Promise<void>;
  /** in_battle → seated again (the start failed), both unready. */
  revertStart(id: string): Promise<void>;
  setStatus(id: string, status: FriendRoomStatus): Promise<void>;
}

export interface FriendRoomDeps {
  repo: FriendRoomRepo;
  /** Starts the battle; returns its `f_<uuid>` id. */
  startBattle(room: FriendRoomRow & { guest: string; hostTeam: FriendTeam; guestTeam: FriendTeam }): Promise<string>;
  /** Whether a battle id is still being played (for the lazy `in_battle → ended`). */
  battleActive(battleId: string): Promise<boolean>;
  now?: () => number;
}

/** An open invite lives this long; a seated lobby gets this long again when the friend arrives. */
export const INVITE_TTL_MS = 15 * 60_000;
export const LOBBY_TTL_MS = 10 * 60_000;

export class FriendRoomError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'INVALID_INPUT' | 'CONFLICT' | 'UNAUTHORIZED', message: string) {
    super(message);
    this.name = 'FriendRoomError';
  }
}

export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');
const ROOM_ID_RE = /^r_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{22,64}$/;
export const isRoomId = (id: string) => ROOM_ID_RE.test(id);

/** What a player sees: their own team, and of the other player only whether they're here, locked in, ready. */
export interface FriendRoomView {
  id: string;
  status: FriendRoomStatus;
  role: 'host' | 'guest';
  arena: FriendArena;
  expiresAt: string;
  battleId: string | null;
  you: { team: FriendTeam | null; ready: boolean };
  opponent: { joined: boolean; address: string | null; lockedIn: boolean; ready: boolean };
}

export function validateTeam(raw: unknown): FriendTeam {
  const t = raw as Partial<FriendTeam> | null;
  if (!t || typeof t !== 'object') throw new FriendRoomError('INVALID_INPUT', 'team must be { classes, tier, purity }');
  const keys = Object.keys(t).sort().join(',');
  if (keys !== 'classes,purity,tier') throw new FriendRoomError('INVALID_INPUT', 'team takes exactly classes, tier and purity');
  if (!Array.isArray(t.classes) || t.classes.length !== 3 || !t.classes.every((c) => typeof c === 'string' && (FRIEND_CLASSES as readonly string[]).includes(c))) {
    throw new FriendRoomError('INVALID_INPUT', `classes must be three of ${FRIEND_CLASSES.join(', ')}`);
  }
  if (typeof t.tier !== 'string' || !(FRIEND_TIERS as readonly string[]).includes(t.tier)) throw new FriendRoomError('INVALID_INPUT', `tier must be one of ${FRIEND_TIERS.join(', ')}`);
  if (typeof t.purity !== 'number' || !Number.isInteger(t.purity) || t.purity < 0 || t.purity > 6) throw new FriendRoomError('INVALID_INPUT', 'purity must be an integer 0-6');
  return { classes: [t.classes[0], t.classes[1], t.classes[2]], tier: t.tier as FriendTier, purity: t.purity };
}

export class FriendRoomService {
  constructor(private readonly deps: FriendRoomDeps) {}
  private now() { return this.deps.now ? this.deps.now() : Date.now(); }

  async create(host: string, opts: { arena?: unknown } = {}): Promise<{ roomId: string; secret: string; expiresAt: string }> {
    const h = host.toLowerCase();
    const arena = opts.arena === undefined ? 'dojo' : opts.arena;
    if (typeof arena !== 'string' || !(FRIEND_ARENAS as readonly string[]).includes(arena)) throw new FriendRoomError('INVALID_INPUT', `arena must be one of ${FRIEND_ARENAS.join(', ')}`);
    await this.deps.repo.cancelUnstartedOf(h);
    const id = `r_${randomUUID()}`;
    const secret = randomBytes(16).toString('base64url');   // 128 bits
    const expiresAt = new Date(this.now() + INVITE_TTL_MS);
    await this.deps.repo.insert({ id, host: h, guest: null, secretHash: hashSecret(secret), status: 'open', hostTeam: null, guestTeam: null, hostReady: false, guestReady: false, arena: arena as FriendArena, battleId: null, expiresAt });
    return { roomId: id, secret, expiresAt: expiresAt.toISOString() };
  }

  async join(roomId: string, secret: unknown, guest: string): Promise<FriendRoomView> {
    const g = guest.toLowerCase();
    const notFound = new FriendRoomError('NOT_FOUND', 'This invite link is not valid any more — ask your friend for a new one');
    if (!isRoomId(roomId) || typeof secret !== 'string' || !SECRET_RE.test(secret)) throw notFound;
    const existing = await this.deps.repo.get(roomId);
    // Re-opening your own accepted link (a refresh) just shows the lobby again.
    if (existing && existing.guest === g && timingSafeEqualHex(existing.secretHash, hashSecret(secret))) return this.viewOf(existing, g);
    if (existing && existing.host === g) throw new FriendRoomError('CONFLICT', 'That is your own invite — send the link to a friend');
    const now = new Date(this.now());
    const row = await this.deps.repo.claimGuest(roomId, hashSecret(secret), g, now, new Date(this.now() + LOBBY_TTL_MS));
    if (!row) throw notFound;
    return this.viewOf(row, g);
  }

  async setTeam(roomId: string, player: string, rawTeam: unknown): Promise<FriendRoomView> {
    const team = validateTeam(rawTeam);
    const { row, seat } = await this.seatOf(roomId, player);
    if (row.status !== 'seated') throw new FriendRoomError('CONFLICT', row.status === 'open' ? 'Wait for your friend to join first' : 'This lobby is closed');
    if ((seat === 'host' ? row.hostReady : row.guestReady)) throw new FriendRoomError('CONFLICT', 'You are already ready — your team is locked');
    const updated = await this.deps.repo.setTeam(roomId, seat, team);
    if (!updated) throw new FriendRoomError('CONFLICT', 'This lobby is closed');
    return this.viewOf(updated, player);
  }

  async ready(roomId: string, player: string): Promise<FriendRoomView> {
    const { row, seat } = await this.seatOf(roomId, player);
    if (row.status !== 'seated') throw new FriendRoomError('CONFLICT', row.status === 'open' ? 'Wait for your friend to join first' : 'This lobby is closed');
    if (!(seat === 'host' ? row.hostTeam : row.guestTeam)) throw new FriendRoomError('CONFLICT', 'Pick your team first');
    const updated = await this.deps.repo.setReady(roomId, seat);
    if (!updated) throw new FriendRoomError('CONFLICT', 'This lobby is closed');
    // Both ready: exactly one call wins seated → in_battle and starts the battle.
    const starting = await this.deps.repo.beginBattle(roomId);
    if (starting && starting.guest && starting.hostTeam && starting.guestTeam) {
      try {
        const battleId = await this.deps.startBattle({ ...starting, guest: starting.guest, hostTeam: starting.hostTeam, guestTeam: starting.guestTeam });
        await this.deps.repo.setBattle(roomId, battleId);
      } catch (err) {
        await this.deps.repo.revertStart(roomId);
        throw err;
      }
    }
    const latest = (await this.deps.repo.get(roomId)) ?? updated;
    return this.viewOf(latest, player);
  }

  async cancel(roomId: string, player: string): Promise<FriendRoomView> {
    const { row } = await this.seatOf(roomId, player);
    if (row.status === 'open' || row.status === 'seated') await this.deps.repo.setStatus(roomId, 'cancelled');
    return this.viewOf({ ...row, status: row.status === 'open' || row.status === 'seated' ? 'cancelled' : row.status }, player);
  }

  async view(roomId: string, player: string): Promise<FriendRoomView> {
    const { row } = await this.seatOf(roomId, player);
    return this.viewOf(row, player);
  }

  /** The room, refreshed for expiry and a finished battle, if `player` holds a seat in it. */
  private async seatOf(roomId: string, player: string): Promise<{ row: FriendRoomRow; seat: 'host' | 'guest' }> {
    const p = player.toLowerCase();
    if (!isRoomId(roomId)) throw new FriendRoomError('NOT_FOUND', 'Room not found');
    let row = await this.deps.repo.get(roomId);
    if (!row || (row.host !== p && row.guest !== p)) throw new FriendRoomError('NOT_FOUND', 'Room not found');
    if ((row.status === 'open' || row.status === 'seated') && row.expiresAt.getTime() <= this.now()) {
      await this.deps.repo.setStatus(roomId, 'expired');
      row = { ...row, status: 'expired' };
    }
    if (row.status === 'in_battle' && row.battleId && !(await this.deps.battleActive(row.battleId))) {
      await this.deps.repo.setStatus(roomId, 'ended');
      row = { ...row, status: 'ended' };
    }
    return { row, seat: row.host === p ? 'host' : 'guest' };
  }

  private viewOf(row: FriendRoomRow, player: string): FriendRoomView {
    const host = row.host === player.toLowerCase();
    return {
      id: row.id,
      status: row.status,
      role: host ? 'host' : 'guest',
      arena: row.arena,
      expiresAt: row.expiresAt.toISOString(),
      battleId: row.battleId,
      you: { team: host ? row.hostTeam : row.guestTeam, ready: host ? row.hostReady : row.guestReady },
      opponent: {
        joined: host ? row.guest !== null : true,
        address: host ? row.guest : row.host,
        lockedIn: !!(host ? row.guestTeam : row.hostTeam),
        ready: host ? row.guestReady : row.hostReady,
      },
    };
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
