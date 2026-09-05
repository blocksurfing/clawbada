/**
 * drand beacon client for verifiable randomness — engine side.
 *
 * The HTTP fetch/caching lives in `@clawbada/chain` (`DrandBeaconClient`) so the
 * API's battle-session manager can use the same implementation; this subclass adds
 * the on-chain half: submitting beacons to BattleVRF.sol via the operator wallet.
 */
import {
  DrandBeaconClient,
  getPublicClient,
  getOperatorClient,
  getBattleVRF,
  addresses,
  BattleVRFAbi,
} from '@clawbada/chain';

const isTestnet = process.env.CHAIN_ENV !== 'mainnet';

export class DrandClient extends DrandBeaconClient {
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
