/**
 * drand beacon fetcher (League of Entropy mainnet by default). Shared by the
 * API's battle-session manager (one beacon per real battle at team reveal) and
 * the engine's on-chain submitter (`apps/engine/src/vrf/drand.ts` extends this).
 * Apps never import from other apps, so the pure HTTP part lives here.
 */
export interface DrandBeacon {
  round: number;
  randomness: string;
  signature?: string;
}

/**
 * League of Entropy "quicknet": a round every 3 seconds. D-01 makes a staked battle wait for a
 * round emitted AFTER its reveal transaction, so the period is felt at every battle start — the
 * older default chain (30 s rounds) would add up to half a minute. Override with DRAND_CHAIN_URL.
 */
export const DEFAULT_DRAND_URL = 'https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';

export class DrandBeaconClient {
  protected readonly chainUrl: string;
  private readonly cache = new Map<number, DrandBeacon>();

  constructor(chainUrl: string = process.env.DRAND_CHAIN_URL ?? DEFAULT_DRAND_URL, private readonly fetchImpl: typeof fetch = fetch) {
    this.chainUrl = chainUrl.replace(/\/$/, '');
  }

  /** Latest published beacon. */
  async fetchLatest(): Promise<{ round: number; randomness: string }> {
    const res = await this.fetchImpl(`${this.chainUrl}/public/latest`);
    if (!res.ok) throw new Error(`drand fetch failed: ${res.status}`);
    const beacon = (await res.json()) as DrandBeacon;
    this.cache.set(beacon.round, beacon);
    return { round: beacon.round, randomness: beacon.randomness };
  }

  /** A specific round (cached after first fetch — beacons are immutable). */
  async fetchRound(round: number): Promise<{ round: number; randomness: string }> {
    const cached = this.cache.get(round);
    if (cached) return { round: cached.round, randomness: cached.randomness };
    const res = await this.fetchImpl(`${this.chainUrl}/public/${round}`);
    if (!res.ok) throw new Error(`drand round ${round} fetch failed: ${res.status}`);
    const beacon = (await res.json()) as DrandBeacon;
    this.cache.set(beacon.round, beacon);
    return { round: beacon.round, randomness: beacon.randomness };
  }

  private chainInfo: { genesisTime: number; period: number } | null = null;

  /** Genesis time and period of the configured chain (cached — they never change). */
  async info(): Promise<{ genesisTime: number; period: number }> {
    if (this.chainInfo) return this.chainInfo;
    const res = await this.fetchImpl(`${this.chainUrl}/info`);
    if (!res.ok) throw new Error(`drand info fetch failed: ${res.status}`);
    const body = (await res.json()) as { genesis_time?: number; period?: number };
    if (!Number.isFinite(body.genesis_time) || !Number.isFinite(body.period) || (body.period as number) <= 0) {
      throw new Error('drand info: missing genesis_time/period');
    }
    this.chainInfo = { genesisTime: body.genesis_time as number, period: body.period as number };
    return this.chainInfo;
  }

  /**
   * A round that may not be published yet: retries until it appears or `timeoutMs` passes.
   * drand answers 404/425 for a future round; anything else is a real failure.
   */
  async fetchRoundWhenReady(round: number, opts: { timeoutMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<{ round: number; randomness: string }> {
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const pollMs = opts.pollMs ?? 1_000;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const cached = this.cache.get(round);
    if (cached) return { round: cached.round, randomness: cached.randomness };
    let waited = 0;
    for (;;) {
      const res = await this.fetchImpl(`${this.chainUrl}/public/${round}`);
      if (res.ok) {
        const beacon = (await res.json()) as DrandBeacon;
        if (beacon.round !== round) throw new Error(`drand returned round ${beacon.round}, wanted ${round}`);
        this.cache.set(beacon.round, beacon);
        return { round: beacon.round, randomness: beacon.randomness };
      }
      if (res.status !== 404 && res.status !== 425) throw new Error(`drand round ${round} fetch failed: ${res.status}`);
      if (waited >= timeoutMs) throw new Error(`drand round ${round} not published after ${timeoutMs} ms`);
      await sleep(pollMs);
      waited += pollMs;
    }
  }

  /** Hex randomness → uint256 VRF seed. */
  toBigInt(randomness: string): bigint {
    return BigInt(`0x${randomness.replace(/^0x/, '')}`);
  }
}
