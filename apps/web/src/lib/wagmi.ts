import { http, createConfig } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { getDefaultConfig } from 'connectkit';
import { burner } from './burner-connector';

/**
 * The chain a fresh connection lands on is `chains[0]`, and it must be the chain the API
 * serves (`GET /api/auth/params` → chainId) — a wallet refuses to even DISPLAY the EIP-4361
 * login message when the two differ. Default: Base Sepolia, which is what the deployed API
 * serves today. Set NEXT_PUBLIC_CHAIN_ID=8453 at mainnet launch, in the same change that
 * points the API at mainnet.
 */
const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? baseSepolia.id);
const ordered = chainId === base.id ? ([base, baseSepolia] as const) : ([baseSepolia, base] as const);

const defaults = getDefaultConfig({
  chains: ordered,
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL),
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL),
  },
  walletConnectProjectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? '',
  appName: 'Clawbada',
  appDescription: 'Agent-first idle game on Base',
});

// Dev-only burner wallet (local playtesting / automation) — never set in production.
const devBurner = process.env.NEXT_PUBLIC_DEV_BURNER === 'true';

export const config = createConfig({
  ...defaults,
  connectors: devBurner ? [...(defaults.connectors ?? []), burner()] : defaults.connectors,
});
