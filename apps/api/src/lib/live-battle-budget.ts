/**
 * How many off-chain battles (practice, friend) one client IP may have running at once.
 *
 * A guest session makes a battle free to start, and a battle kept alive with one move a minute runs for the best
 * part of an hour. The Dojo's overall ceiling (PRACTICE_MAX_LIVE) bounds the server's work but not who gets it:
 * without a per-IP share one machine can hold every slot and everybody else hears "The Dojo is full". The per-minute
 * limits on starting battles do not help — the battles add up.
 *
 * The count is of battles still live, looked up when asked, so there is nothing to clean up when a battle ends.
 * Process-local: after a restart resumed battles are not counted against anyone, which only ever errs towards
 * letting a player in.
 */
export const DEFAULT_MAX_LIVE_PER_IP = 6;

/** PRACTICE_MAX_LIVE_PER_IP overrides the default. */
export function maxLivePerIpFromEnv(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.PRACTICE_MAX_LIVE_PER_IP);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_LIVE_PER_IP;
}

export const TOO_MANY_BATTLES_MESSAGE = 'Too many battles are running from your network right now — finish one first';

/** An unresolved IP is one shared bucket for everybody behind it, so it is not held to the cap. */
const UNKNOWN_IP = 'unknown';

export class LiveBattleBudget {
  /** battleId -> the IP that started it. */
  private readonly startedBy = new Map<string, string>();
  /** Starts in flight (the battle id is not known yet), per IP. */
  private readonly pending = new Map<string, number>();

  constructor(
    private readonly isLive: (battleId: string) => boolean,
    private readonly max: () => number = maxLivePerIpFromEnv,
  ) {}

  /** Battles this IP started that are still being played, plus its starts in flight. */
  liveFor(ip: string): number {
    let n = this.pending.get(ip) ?? 0;
    for (const [battleId, owner] of this.startedBy) {
      if (!this.isLive(battleId)) this.startedBy.delete(battleId);
      else if (owner === ip) n++;
    }
    return n;
  }

  /** A cheap early answer (nothing is held): whether this IP is already at its share. */
  atLimit(ip: string): boolean {
    return ip !== UNKNOWN_IP && this.liveFor(ip) >= this.max();
  }

  /**
   * Before starting a battle: true and a slot is held, or false when this IP is at its share. Every true must be
   * followed by exactly one `started` or `abandoned`.
   */
  tryStart(ip: string): boolean {
    if (ip === UNKNOWN_IP) return true;
    if (this.liveFor(ip) >= this.max()) return false;
    this.pending.set(ip, (this.pending.get(ip) ?? 0) + 1);
    return true;
  }

  /** The start succeeded: the held slot becomes this battle's. */
  started(ip: string, battleId: string): void {
    if (ip === UNKNOWN_IP) return;
    this.settle(ip);
    this.startedBy.set(battleId, ip);
  }

  /** The start did not happen (refused, failed, or the other player's request started the battle): free the slot. */
  abandoned(ip: string): void {
    if (ip === UNKNOWN_IP) return;
    this.settle(ip);
  }

  /** Whether a battle is already counted against someone (a friend battle is started by one of two requests). */
  has(battleId: string): boolean {
    return this.startedBy.has(battleId);
  }

  private settle(ip: string): void {
    const n = this.pending.get(ip) ?? 0;
    if (n <= 1) this.pending.delete(ip);
    else this.pending.set(ip, n - 1);
  }
}
