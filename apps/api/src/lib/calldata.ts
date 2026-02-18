import { encodeFunctionData, type Abi, base, baseSepolia } from '@clawbada/chain';

const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
const chain = isTestnet ? baseSepolia : base;

export interface CalldataResult {
  to: string;
  data: string;
  value: string;
  chainId: number;
}

export interface CalldataStep {
  description: string;
  calldata: CalldataResult;
  optional?: boolean;
}

export function buildCalldata(
  address: string,
  abi: Abi,
  functionName: string,
  args: unknown[] = [],
  value: bigint = 0n,
): CalldataResult {
  const data = encodeFunctionData({ abi, functionName, args });
  return {
    to: address,
    data,
    value: value.toString(),
    chainId: chain.id,
  };
}

export function singleStep(description: string, calldata: CalldataResult): { steps: CalldataStep[] } {
  return { steps: [{ description, calldata }] };
}

export function multiStep(...steps: CalldataStep[]): { steps: CalldataStep[] } {
  return { steps };
}
