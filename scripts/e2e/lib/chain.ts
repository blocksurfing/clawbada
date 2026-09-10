/**
 * Direct chain access for the harness: deployer-side setup (eligibility, fuel mints, CLAW
 * top-ups) and read-side assertions. Players never use this — they go through the API's
 * calldata steps like a real client.
 */
import { createPublicClient, createWalletClient, http, parseEventLogs, type Abi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import {
  BattleArenaAbi, ClawTokenAbi, LobsterNFTAbi, TeamManagerAbi, MiningPoolAbi, FaucetAbi, EvolutionLabAbi,
} from '@clawbada/chain';
import type { Deployment } from './forge';

export const WEI = 10n ** 18n;

export class Chain {
  readonly pub;
  constructor(readonly rpcUrl: string, readonly d: Deployment) {
    this.pub = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  }

  wallet(key: string) {
    return createWalletClient({ account: privateKeyToAccount(key as Hex), chain: baseSepolia, transport: http(this.rpcUrl) });
  }

  async read<T = unknown>(address: Hex, abi: Abi | readonly unknown[], functionName: string, args: unknown[] = []): Promise<T> {
    return (await this.pub.readContract({ address, abi: abi as Abi, functionName, args })) as T;
  }

  /** simulate → write → receipt; returns the receipt and the simulated result. */
  async tx(key: string, address: Hex, abi: Abi | readonly unknown[], functionName: string, args: unknown[] = []) {
    const w = this.wallet(key);
    const { request, result } = await this.pub.simulateContract({ address, abi: abi as Abi, functionName, args, account: w.account });
    const hash = await w.writeContract(request);
    const receipt = await this.pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`${functionName} reverted (${hash})`);
    return { hash, receipt, result };
  }

  /** Raw calldata step from the API, signed by `key`. */
  async sendStep(key: string, step: { to: string; data: string; value?: string; chainId?: number }) {
    const w = this.wallet(key);
    const hash = await w.sendTransaction({ to: step.to as Hex, data: step.data as Hex, value: step.value ? BigInt(step.value) : 0n });
    const receipt = await this.pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`calldata step to ${step.to} reverted (${hash})`);
    return receipt;
  }

  events<T = any>(receipt: { logs: any[] }, abi: Abi | readonly unknown[], eventName: string): T[] {
    return parseEventLogs({ abi: abi as Abi, logs: receipt.logs, eventName: eventName as any }).map((l: any) => l.args as T);
  }

  // ── contracts ──
  get arena() { return this.d.contracts.BattleArena; }
  get claw() { return this.d.contracts.ClawToken; }
  get nft() { return this.d.contracts.LobsterNFT; }
  get teams() { return this.d.contracts.TeamManager; }
  get pool() { return this.d.contracts.MiningPool; }
  get faucet() { return this.d.contracts.Faucet; }
  get evolution() { return this.d.contracts.EvolutionLab; }

  balance(addr: string) { return this.read<bigint>(this.claw, ClawTokenAbi, 'balanceOf', [addr]); }
  totalSupply() { return this.read<bigint>(this.claw, ClawTokenAbi, 'totalSupply'); }
  getBattle(id: bigint) { return this.read<any>(this.arena, BattleArenaAbi, 'getBattle', [id]); }
  getTeam(id: bigint) { return this.read<any>(this.teams, TeamManagerAbi, 'getTeam', [id]); }
  getLobster(id: bigint) { return this.read<any>(this.nft, LobsterNFTAbi, 'getLobster', [id]); }
  getExpedition(id: bigint) { return this.read<any>(this.pool, MiningPoolAbi, 'getExpedition', [id]); }
  seasonStart() { return this.read<any>(this.pool, MiningPoolAbi, 'getSeasonConfig', [1n]).then((s) => BigInt(s.startTime)); }
  latestTimestamp() { return this.pub.getBlock({ blockTag: 'latest' }).then((b) => b.timestamp); }

  // ── deployer-side setup ──
  async setEligible(deployerKey: string, addrs: string[]) {
    await this.tx(deployerKey, this.faucet, FaucetAbi, 'setEligibleBatch', [addrs, true]);
  }
  /** Grant MINTER_ROLE to the deployer once, then mint plain Base lobsters (fuel). */
  async mintBaseLobsters(deployerKey: string, to: string, n: number): Promise<bigint[]> {
    const deployer = privateKeyToAccount(deployerKey as Hex).address;
    const role = await this.read<Hex>(this.nft, LobsterNFTAbi, 'MINTER_ROLE');
    const has = await this.read<boolean>(this.nft, LobsterNFTAbi, 'hasRole', [role, deployer]);
    if (!has) await this.tx(deployerKey, this.nft, LobsterNFTAbi, 'grantRole', [role, deployer]);
    const ids: bigint[] = [];
    for (let i = 0; i < n; i++) {
      const { receipt } = await this.tx(deployerKey, this.nft, LobsterNFTAbi, 'mint', [to, dna(i), false]);
      const ev = this.events<{ tokenId: bigint }>(receipt, LobsterNFTAbi, 'LobsterMinted')[0];
      ids.push(BigInt(ev.tokenId));
    }
    return ids;
  }
  async transferClaw(fromKey: string, to: string, amountWei: bigint) {
    await this.tx(fromKey, this.claw, ClawTokenAbi, 'transfer', [to, amountWei]);
  }
}

/** Valid DNA with a spread of class affinities so evolved lobsters aren't all one look. */
export function dna(seed: number): bigint {
  const cls = BigInt(seed % 10);
  let v = (cls << 252n) | (BigInt(seed % 64) << 244n);
  for (let i = 0n; i < 18n; i++) {
    const affinity = (BigInt(seed) * 7n + i * 3n) % 10n;
    const variant = (BigInt(seed) + i) % 16n;
    v |= ((affinity << 4n) | variant) << (96n + 8n * i);
  }
  return v;
}

export { BattleArenaAbi, ClawTokenAbi, LobsterNFTAbi, TeamManagerAbi, MiningPoolAbi, FaucetAbi, EvolutionLabAbi };
