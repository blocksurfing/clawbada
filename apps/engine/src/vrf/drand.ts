/**
 * drand beacon client for verifiable randomness.
 *
 * Fetches beacon values from the drand network and submits
 * them to BattleVRF.sol for on-chain verification.
 *
 * Used for: damage variance (±15%), critical hits, enhanced
 * Special procs, turn order tiebreaks.
 */
export class DrandClient {
  private chainUrl: string;

  constructor() {
    this.chainUrl = process.env.DRAND_CHAIN_URL ?? 'https://api.drand.sh';
  }

  /**
   * Fetch the latest drand beacon.
   *
   * TODO: Implement:
   * 1. GET {chainUrl}/public/latest
   * 2. Parse response: { round, randomness, signature }
   * 3. Return beacon value
   */
  async fetchLatest(): Promise<{ round: number; randomness: string }> {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  /**
   * Fetch a specific drand round.
   */
  async fetchRound(_round: number): Promise<{ round: number; randomness: string }> {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  /**
   * Submit a beacon value to BattleVRF.sol on-chain.
   *
   * TODO: Implement:
   * 1. Call BattleVRF.submitBeacon(round, value) via operator wallet
   * 2. Wait for transaction confirmation
   */
  async submitToChain(_round: number, _value: bigint): Promise<string> {
    // TODO: Implement — returns tx hash
    throw new Error('Not implemented');
  }
}
