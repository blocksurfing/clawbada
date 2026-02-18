import { createPublicClient, createWalletClient, http, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPublicClient(testnet = false): any {
  const chain = testnet ? baseSepolia : base;
  const rpcUrl = testnet ? process.env.BASE_SEPOLIA_RPC_URL : process.env.BASE_RPC_URL;

  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
}

export function getWalletClient(testnet = false) {
  const chain = testnet ? baseSepolia : base;
  const rpcUrl = testnet ? process.env.BASE_SEPOLIA_RPC_URL : process.env.BASE_RPC_URL;

  return createWalletClient({
    chain,
    transport: http(rpcUrl),
  });
}

/**
 * Returns a wallet client configured with the server operator key.
 * Used for privileged on-chain actions: createBattle, settle, advanceRound, submitVRF.
 * Requires OPERATOR_PRIVATE_KEY env var.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getOperatorClient(testnet = false): any {
  const key = process.env.OPERATOR_PRIVATE_KEY;
  if (!key) throw new Error('OPERATOR_PRIVATE_KEY not set');

  const account = privateKeyToAccount(key as `0x${string}`);
  const chain = testnet ? baseSepolia : base;
  const rpcUrl = testnet ? process.env.BASE_SEPOLIA_RPC_URL : process.env.BASE_RPC_URL;

  return createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
}
