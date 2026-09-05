'use client';

import { useCallback, useRef } from 'react';
import { useAccount, useSignMessage } from 'wagmi';

const CACHE_TTL_MS = 4.5 * 60 * 1000; // 4.5 minutes (server TTL = 5 min)

interface CachedAuth {
  address: string;
  signature: string;
  timestamp: number;
  expiresAt: number;
}

export function useAuth() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const cacheRef = useRef<CachedAuth | null>(null);

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (!address) throw new Error('Wallet not connected');

    const now = Date.now();
    const cached = cacheRef.current;
    if (cached && cached.address === address && now < cached.expiresAt) {
      return {
        'X-Wallet-Address': cached.address,
        'X-Signature': cached.signature,
        'X-Timestamp': String(cached.timestamp),
      };
    }

    const timestamp = Math.floor(now / 1000);
    const message = `Clawbada Auth: ${timestamp}`;
    const signature = await signMessageAsync({ message });

    cacheRef.current = {
      address,
      signature,
      timestamp,
      expiresAt: now + CACHE_TTL_MS,
    };

    return {
      'X-Wallet-Address': address,
      'X-Signature': signature,
      'X-Timestamp': String(timestamp),
    };
  }, [address, signMessageAsync]);

  /** Same cached signature as the headers, for the WebSocket upgrade URL params. */
  const getAuthParams = useCallback(async (): Promise<{ address: string; signature: string; timestamp: string }> => {
    const h = await getAuthHeaders();
    return { address: h['X-Wallet-Address'], signature: h['X-Signature'], timestamp: h['X-Timestamp'] };
  }, [getAuthHeaders]);

  return { getAuthHeaders, getAuthParams, isConnected: !!address };
}
