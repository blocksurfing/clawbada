export * from './abis/index';
export * from './addresses';
export * from './client';
export * from './contracts';

// Re-export viem utilities so consumers don't need a separate viem dependency
export { encodeFunctionData, verifyMessage, getAddress } from 'viem';
export type { Abi } from 'viem';
export { base, baseSepolia } from 'viem/chains';
