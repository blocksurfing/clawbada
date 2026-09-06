/**
 * Dev-only burner wallet connector (enabled with NEXT_PUBLIC_DEV_BURNER=true).
 *
 * A viem private-key account that lives in localStorage, exposed to wagmi as a
 * connector so the app can be driven without a browser extension — local
 * playtesting, bots, and browser automation. It signs messages (wallet auth) and
 * typed data; it does NOT send transactions (no funds, no chain writes).
 */
import { createConnector } from 'wagmi';
import { getAddress, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'wagmi/chains';

const STORAGE_KEY = 'clawbada.burner.key';

function loadOrCreateKey(): Hex {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && /^0x[0-9a-fA-F]{64}$/.test(existing)) return existing as Hex;
    const fresh = generatePrivateKey();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return generatePrivateKey();
  }
}

export function burner() {
  let connected = false;
  const chainId = baseSepolia.id;

  return createConnector<unknown>((config) => ({
    id: 'burner',
    name: 'Burner (dev)',
    type: 'burner',
    async setup() {},
    async connect(parameters?: { withCapabilities?: boolean }) {
      const account = privateKeyToAccount(loadOrCreateKey());
      connected = true;
      const accounts = parameters?.withCapabilities
        ? [{ address: account.address, capabilities: {} }]
        : [account.address];
      // wagmi's `connect` is generic over withCapabilities; the runtime shape above matches.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { accounts, chainId } as any;
    },
    async disconnect() {
      connected = false;
    },
    async getAccounts() {
      if (!connected) return [];
      return [getAddress(privateKeyToAccount(loadOrCreateKey()).address)];
    },
    async getChainId() {
      return chainId;
    },
    async isAuthorized() {
      return connected;
    },
    async switchChain({ chainId: id }) {
      const chain = config.chains.find((c) => c.id === id);
      if (!chain) throw new Error(`Unsupported chain ${id}`);
      return chain;
    },
    onAccountsChanged() {},
    onChainChanged() {},
    onDisconnect() {
      connected = false;
    },
    async getProvider() {
      return {
        async request({ method, params }: { method: string; params?: unknown[] }) {
          const account = privateKeyToAccount(loadOrCreateKey());
          switch (method) {
            case 'eth_accounts':
            case 'eth_requestAccounts':
              return [account.address];
            case 'eth_chainId':
              return `0x${chainId.toString(16)}`;
            case 'personal_sign': {
              // [data(hex or utf8), address]
              const data = (params?.[0] ?? '') as string;
              const message = /^0x[0-9a-fA-F]*$/.test(data) ? { raw: data as Hex } : data;
              return account.signMessage({ message });
            }
            case 'eth_signTypedData_v4': {
              const typed = JSON.parse((params?.[1] ?? '{}') as string);
              return account.signTypedData(typed);
            }
            case 'wallet_switchEthereumChain':
              return null;
            default:
              throw new Error(`burner wallet does not support ${method}`);
          }
        },
      };
    },
  }));
}
