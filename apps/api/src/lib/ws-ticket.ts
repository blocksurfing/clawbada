/**
 * WebSocket tickets: how a client opens `/ws` without putting its session token in a URL.
 *
 * A browser cannot set headers on a WebSocket upgrade, so the 2-hour session token used to ride in the query
 * string — where proxies and request logs can keep it. Instead the client trades the token (in a normal
 * Authorization header) for a ticket via `POST /api/auth/ws-ticket`, then connects with `/ws?ticket=…`.
 * A ticket is random (192 bits), good for 30 seconds, good for ONE upgrade, and bound to the battle it was
 * asked for — so a ticket that does land in a log is worthless by the time anyone reads it.
 *
 * In memory: the API is one instance (Cloud Run min = max = 1). A ticket issued by an instance that then stops
 * is simply refused by the next one, and the client asks for a new one on its reconnect.
 */
import { randomBytes } from 'node:crypto';
import { ApiError } from './errors';

export const WS_TICKET_TTL_MS = 30_000;
/** Outstanding tickets across the process; past this new ones are refused rather than grow the map. */
const MAX_OUTSTANDING = 50_000;

export interface WsTicketGrant {
  /** EIP-55 address of the caller (a guest's random address for a guest session). */
  checksumAddress: string;
  guest: boolean;
  /** Epoch seconds at which the caller's own proof (session token or signature) runs out — the socket's lifetime. */
  authExpiresAt: number;
  /** The battle the ticket opens, or null for an address-room-only socket (queue events). */
  battleId: string | null;
}

interface Entry extends WsTicketGrant {
  expiresAtMs: number;
}

export class WsTicketStore {
  private readonly tickets = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(grant: WsTicketGrant): { ticket: string; expiresInMs: number } {
    if (this.tickets.size >= MAX_OUTSTANDING) this.sweep();
    if (this.tickets.size >= MAX_OUTSTANDING) throw new ApiError('RATE_LIMITED', 'Too many pending connections; try again shortly');
    const ticket = randomBytes(24).toString('base64url');
    this.tickets.set(ticket, { ...grant, expiresAtMs: this.now() + WS_TICKET_TTL_MS });
    return { ticket, expiresInMs: WS_TICKET_TTL_MS };
  }

  /** Spend a ticket on an upgrade. Single use: it is gone whether or not the checks below pass. */
  consume(ticket: string, battleId: string | null): WsTicketGrant {
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!entry || entry.expiresAtMs <= this.now()) throw new ApiError('UNAUTHORIZED', 'Invalid or expired ticket');
    if ((entry.battleId ?? null) !== (battleId ?? null)) throw new ApiError('UNAUTHORIZED', 'This ticket was issued for a different battle');
    const { expiresAtMs: _drop, ...grant } = entry;
    return grant;
  }

  sweep(): void {
    const now = this.now();
    for (const [t, e] of this.tickets) if (e.expiresAtMs <= now) this.tickets.delete(t);
  }

  get size(): number {
    return this.tickets.size;
  }
}

export const wsTickets = new WsTicketStore();
setInterval(() => wsTickets.sweep(), WS_TICKET_TTL_MS).unref?.();
