/**
 * drand beacon client for verifiable randomness.
 *
 * Fetches beacon values from the drand network and submits
 * them to BattleVRF.sol for on-chain verification.
 *
 * Used for: damage variance (±15%), critical hits, enhanced
 * Special procs, turn order tiebreaks.
 */
import {
  getPublicClient,
  getOperatorClient,
  getBattleVRF,
  addresses,
  BattleVRFAbi,
} from '@clawbada/chain';

interface DrandBeacon {
  round: number;
  randomness: string;
  signature: string;
}

const isTestnet = process.env.CHAIN_ENV !== 'mainnet';

export class DrandClient {
  private chainUrl: string;
  private cache: Map<number, DrandBeacon> = new Map();

  constructor() {
    this.chainUrl = process.env.DRAND_CHAIN_URL ?? 'https://api.drand.sh';
  }

  /**
   * Fetch the latest drand beacon.
   */
  async fetchLatest(): Promise<{ round: number; randomness: string }> {
    const res = await fetch(`${this.chainUrl}/public/latest`);
    if (!res.ok) throw new Error(`drand fetch failed: ${res.status}`);

    const beacon: DrandBeacon = await res.json();
    this.cache.set(beacon.round, beacon);
    return { round: beacon.round, randomness: beacon.randomness };
  }

  /**
   * Fetch a specific drand round.
   */
  async fetchRound(round: number): Promise<{ round: number; randomness: string }> {
    const cached = this.cache.get(round);
    if (cached) return { round: cached.round, randomness: cached.randomness };

    const res = await fetch(`${this.chainUrl}/public/${round}`);
    if (!res.ok) throw new Error(`drand round ${round} fetch failed: ${res.status}`);

    const beacon: DrandBeacon = await res.json();
    this.cache.set(beacon.round, beacon);
    return { round: beacon.round, randomness: beacon.randomness };
  }

  /**
   * Convert a hex randomness string to bigint for use as VRF seed.
   */
  toBigInt(randomness: string): bigint {
    return BigInt(`0x${randomness}`);
  }

  /**
   * Submit a beacon value to BattleVRF.sol on-chain via operator wallet.
   * Returns the transaction hash.
   */
  async submitToChain(round: number, randomness: string): Promise<string> {
    const walletClient = getOperatorClient(isTestnet);
    const publicClient = getPublicClient(isTestnet) as any;

    const hash = await walletClient.writeContract({
      address: addresses.battleVRF,
      abi: BattleVRFAbi as any,
      functionName: 'submitBeacon',
      args: [BigInt(round), BigInt(`0x${randomness}`)],
    });

    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  /**
   * Check if a specific round's beacon has already been submitted on-chain.
   */
  async isSubmitted(round: number): Promise<boolean> {
    const publicClient = getPublicClient(isTestnet) as any;
    const vrf = getBattleVRF(publicClient);

    try {
      const beacon = await vrf.read.getBeacon([BigInt(round)]);
      return beacon !== 0n;
    } catch {
      return false;
    }
  }
}
