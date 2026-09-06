import { http, createConfig } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { getDefaultConfig } from 'connectkit';
import { burner } from './burner-connector';

const defaults = getDefaultConfig({
  chains: [base, baseSepolia],
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
