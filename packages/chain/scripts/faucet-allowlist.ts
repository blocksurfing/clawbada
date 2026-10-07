#!/usr/bin/env bun
/**
 * faucet-allowlist — the faucet's eligibility signer (M10, manual edition).
 *
 * Reads a list of wallet addresses, checks each one against the published rules, and marks the
 * ones that pass eligible on the Faucet (`setEligibleBatch`, ELIGIBILITY_ROLE) — in chunks of at
 * most 500, signed by ELIGIBILITY_PRIVATE_KEY: a key no running service loads (the deploy scripts
 * require it to differ from every other hot key on mainnet). Self-serve eligibility (the agent
 * kit asking for its own wallet) is the Phase 3 follow-up; until then this is the procedure.
 *
 *   bun run faucet-allowlist --file wallets.txt            # dry run: verdicts only, nothing sent
 *   bun run faucet-allowlist --file wallets.txt --send     # grant the ones that pass
 *   bun run faucet-allowlist --file wallets.txt --skip-age # testnet: no Basescan history needed
 *
 * The rules (docs/gitbook/getting-started.md):
 *   - holds at least 0.001 ETH on Base                  (RPC getBalance)
 *   - at least 3 prior transactions on Base             (RPC getTransactionCount, i.e. the nonce)
 *   - at least 7 days old on Base                        (first transaction, Basescan txlist;
 *                                                         needs BASESCAN_API_KEY, or --skip-age)
 *   - has not already been marked eligible              (Faucet.isEligible)
 *
 * Env: FAUCET_ADDRESS, CHAIN_ENV (mainnet | testnet), BASE_RPC_URL / BASE_SEPOLIA_RPC_URL,
 *      ELIGIBILITY_PRIVATE_KEY (--send only), BASESCAN_API_KEY (unless --skip-age).
 * The wallet file: one address per line; blank lines and lines starting with # are ignored.
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, getAddress, http, isAddress, parseEther, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { FaucetAbi } from '../src/abis';

export const MIN_ETH_WEI = parseEther('0.001');
export const MIN_TX_COUNT = 3;
export const MIN_AGE_SEC = 7 * 24 * 3600;
export const MAX_BATCH = 500;

export interface WalletFacts {
  address: Address;
  balanceWei: bigint;
  txCount: number;
  /** Unix seconds of the first transaction, null when the history was not checked. */
  firstTxAt: number | null;
  alreadyEligible: boolean;
}

/** The decision for one wallet, from facts alone (pure — unit-testable). */
export function verdict(f: WalletFacts, nowSec: number, skipAge: boolean): { ok: boolean; reason: string } {
  if (f.alreadyEligible) return { ok: false, reason: 'already eligible' };
  if (f.balanceWei < MIN_ETH_WEI) return { ok: false, reason: `balance below 0.001 ETH` };
  if (f.txCount < MIN_TX_COUNT) return { ok: false, reason: `${f.txCount} transaction(s), needs ${MIN_TX_COUNT}` };
  if (!skipAge) {
    if (f.firstTxAt === null) return { ok: false, reason: 'no transaction history found' };
    if (nowSec - f.firstTxAt < MIN_AGE_SEC) return { ok: false, reason: `wallet is ${Math.floor((nowSec - f.firstTxAt) / 86400)} day(s) old, needs 7` };
  }
  return { ok: true, reason: skipAge ? 'passes (age not checked)' : 'passes' };
}

/** Parse the wallet file: one address per line, comments and blanks ignored, duplicates dropped. */
export function parseWalletFile(text: string): { addresses: Address[]; invalid: string[] } {
  const seen = new Set<string>(); const addresses: Address[] = []; const invalid: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (!isAddress(line)) { invalid.push(line); continue; }
    const a = getAddress(line);
    if (seen.has(a)) continue;
    seen.add(a); addresses.push(a);
  }
  return { addresses, invalid };
}

export function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

async function firstTxTimestamp(address: Address, mainnet: boolean, apiKey: string): Promise<number | null> {
  const host = mainnet ? 'https://api.basescan.org' : 'https://api-sepolia.basescan.org';
  const url = `${host}/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=1&sort=asc&apikey=${apiKey}`;
  const res = await fetch(url);
  const json = (await res.json()) as { status: string; result: Array<{ timeStamp: string }> | string };
  if (!Array.isArray(json.result) || json.result.length === 0) return null;
  return Number(json.result[0].timeStamp);
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(name);
  const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const file = opt('--file');
  if (!file) { console.error('usage: bun run faucet-allowlist --file wallets.txt [--send] [--skip-age]'); process.exit(2); }
  const send = flag('--send'); const skipAge = flag('--skip-age');

  const mainnet = process.env.CHAIN_ENV === 'mainnet';
  const rpc = opt('--rpc') ?? (mainnet ? process.env.BASE_RPC_URL : process.env.BASE_SEPOLIA_RPC_URL);
  const faucet = process.env.FAUCET_ADDRESS as Address | undefined;
  if (!rpc || !faucet) { console.error('FAUCET_ADDRESS and the RPC url (BASE_RPC_URL / BASE_SEPOLIA_RPC_URL or --rpc) are required'); process.exit(2); }
  const apiKey = process.env.BASESCAN_API_KEY ?? '';
  if (!skipAge && !apiKey) { console.error('BASESCAN_API_KEY is required to check wallet age (or pass --skip-age on a testnet)'); process.exit(2); }

  const { addresses, invalid } = parseWalletFile(readFileSync(file, 'utf8'));
  for (const bad of invalid) console.warn(`skip (not an address): ${bad}`);
  const pub = createPublicClient({ chain: mainnet ? base : baseSepolia, transport: http(rpc) });
  const now = Math.floor(Date.now() / 1000);

  const passing: Address[] = [];
  for (const address of addresses) {
    const [balanceWei, txCount, alreadyEligible] = await Promise.all([
      pub.getBalance({ address }),
      pub.getTransactionCount({ address }),
      pub.readContract({ address: faucet, abi: FaucetAbi, functionName: 'isEligible', args: [address] }) as Promise<boolean>,
    ]);
    let firstTxAt: number | null = null;
    if (!skipAge) {
      firstTxAt = await firstTxTimestamp(address, mainnet, apiKey);
      await new Promise((r) => setTimeout(r, 250)); // Basescan free tier: 5 requests / second
    }
    const v = verdict({ address, balanceWei, txCount, firstTxAt, alreadyEligible }, now, skipAge);
    console.log(`${v.ok ? 'PASS' : 'skip'}  ${address}  ${v.reason}`);
    if (v.ok) passing.push(address);
  }
  console.log(`\n${passing.length} of ${addresses.length} wallet(s) pass${send ? '' : ' (dry run: nothing sent; add --send to grant)'}`);
  if (!send || passing.length === 0) return;

  const key = process.env.ELIGIBILITY_PRIVATE_KEY;
  if (!key) { console.error('ELIGIBILITY_PRIVATE_KEY is required with --send'); process.exit(2); }
  const account = privateKeyToAccount(key as Hex);
  const wallet = createWalletClient({ account, chain: mainnet ? base : baseSepolia, transport: http(rpc) });
  for (const batch of chunk(passing, MAX_BATCH)) {
    const { request } = await pub.simulateContract({ address: faucet, abi: FaucetAbi, functionName: 'setEligibleBatch', args: [batch, true], account });
    const hash = await wallet.writeContract(request);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`setEligibleBatch reverted: ${hash}`);
    console.log(`granted ${batch.length} wallet(s) in ${hash}`);
  }
}

if (import.meta.main) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
