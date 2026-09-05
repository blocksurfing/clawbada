export * from './abis/index';
export * from './addresses';
export * from './client';
export * from './contracts';
export * from './commit';
export * from './drand';

// Re-export viem utilities so consumers don't need a separate viem dependency
export { encodeFunctionData, verifyMessage, getAddress } from 'viem';
export { privateKeyToAccount } from 'viem/accounts';
export type { Abi } from 'viem';
export { base, baseSepolia } from 'viem/chains';
