/**
 * How many WebSockets may be open at once: per wallet address, per client IP, and in total.
 *
 * The instance serves at most 1000 requests at a time (Cloud Run's ceiling, one instance), and every open socket
 * is one of them for as long as it lives — up to the session's two hours. The per-minute limit on upgrade ATTEMPTS
 * (index.ts) does not bound that: sockets opened slowly still add up. So:
 *   - per address: tabs + dev tools of one player (as before);
 *   - per IP: one machine cannot hold more than a household's worth, however many addresses it makes up;
 *   - in total: sockets never take the whole instance — the rest stays free for ordinary requests.
 * Counters are process-local, like everything else about live battles on this single instance.
 */
export interface SocketLimits {
  perAddress: number;
  perIp: number;
  total: number;
}

export const DEFAULT_SOCKET_LIMITS: SocketLimits = { perAddress: 8, perIp: 16, total: 600 };

function envInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** WS_PER_IP_MAX_CONCURRENT and WS_MAX_SOCKETS override the defaults. */
export function socketLimitsFromEnv(env: Record<string, string | undefined> = process.env): SocketLimits {
  return {
    perAddress: DEFAULT_SOCKET_LIMITS.perAddress,
    perIp: envInt(env.WS_PER_IP_MAX_CONCURRENT, DEFAULT_SOCKET_LIMITS.perIp),
    total: envInt(env.WS_MAX_SOCKETS, DEFAULT_SOCKET_LIMITS.total),
  };
}

/** Who a socket counts against. `address` is null for a spectator; `ip` is 'unknown' when it could not be resolved. */
export interface SocketOwner {
  address: string | null;
  ip: string;
}

/** Which cap refused a socket. Sent to the client as the close reason `<cap>-capacity` (code 1013, try again later). */
export type SocketRefusal = 'address' | 'ip' | 'server';

/** An unresolved IP is one shared bucket for everybody behind it, so it is not held to the per-IP cap. */
const UNKNOWN_IP = 'unknown';

export class SocketBudget {
  private readonly byAddress = new Map<string, number>();
  private readonly byIp = new Map<string, number>();
  private total = 0;

  constructor(private readonly limits: SocketLimits = DEFAULT_SOCKET_LIMITS) {}

  /** Take a slot for a socket that just opened: null when it has one, else the cap that refused it (nothing is taken). */
  reserve(owner: SocketOwner): SocketRefusal | null {
    const address = owner.address?.toLowerCase() ?? null;
    if (this.total >= this.limits.total) return 'server';
    if (address && (this.byAddress.get(address) ?? 0) >= this.limits.perAddress) return 'address';
    if (owner.ip !== UNKNOWN_IP && (this.byIp.get(owner.ip) ?? 0) >= this.limits.perIp) return 'ip';
    this.total++;
    if (address) this.byAddress.set(address, (this.byAddress.get(address) ?? 0) + 1);
    if (owner.ip !== UNKNOWN_IP) this.byIp.set(owner.ip, (this.byIp.get(owner.ip) ?? 0) + 1);
    return null;
  }

  /** Give back a slot `reserve` granted. Call exactly once per granted socket (index.ts tracks that on the socket). */
  release(owner: SocketOwner): void {
    const address = owner.address?.toLowerCase() ?? null;
    this.total = Math.max(0, this.total - 1);
    if (address) dec(this.byAddress, address);
    if (owner.ip !== UNKNOWN_IP) dec(this.byIp, owner.ip);
  }

  /** Open sockets (for logs and tests). */
  counts(): { total: number; addresses: number; ips: number } {
    return { total: this.total, addresses: this.byAddress.size, ips: this.byIp.size };
  }
}

function dec(map: Map<string, number>, key: string): void {
  const n = map.get(key) ?? 0;
  if (n <= 1) map.delete(key);
  else map.set(key, n - 1);
}
