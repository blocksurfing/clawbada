import { createPublicClient, createWalletClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';

export function getPublicClient(testnet = false) {
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
