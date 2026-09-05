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

export const DEFAULT_DRAND_URL = 'https://api.drand.sh';

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

  /** Hex randomness → uint256 VRF seed. */
  toBigInt(randomness: string): bigint {
    return BigInt(`0x${randomness.replace(/^0x/, '')}`);
  }
}
