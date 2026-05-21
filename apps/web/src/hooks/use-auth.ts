'use client';

import { useCallback } from 'react';
import { useAccount, useSignMessage } from 'wagmi';

const CACHE_TTL_MS = 4.5 * 60 * 1000; // 4.5 minutes (server TTL = 5 min)

interface CachedAuth {
  address: string;
  signature: string;
  timestamp: number;
  expiresAt: number;
}

/**
 * F-2C: module-scope cache (NOT per-hook-instance). Multiple `useAuth()`
 * callers in the same tab share a single cached signature and a single
 * in-flight signing promise — so the REST and WS auth paths can't each
 * trigger their own wallet popup during a cold start.
 *
 * F-2J: `inFlight` is keyed by normalized address. A pending wallet popup
 * for wallet A must not block a `getAuthParams()` call for wallet B (e.g.
 * after the user switches accounts in MetaMask).
 *
 * F-2P: `cached` is also keyed by normalized address. A slow wallet-A popup
 * resolving after the user has already signed for wallet B must not clobber
 * B's cache (which would force B to re-prompt on the next call).
 */
const cached = new Map<string, CachedAuth>();
const inFlight = new Map<string, Promise<CachedAuth>>();

export interface AuthParams {
  address: string;
  signature: string;
  timestamp: number;
}

export function useAuth() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  /** Acquire the cached signed challenge or sign a fresh one. Shared between
   *  the REST and WebSocket auth paths so a single signMessage call covers
   *  both transports for the next 4.5 minutes. The cache + in-flight promise
   *  live at module scope (see top of file) so multiple `useAuth()` instances
   *  in the same tab cannot race into two wallet popups. */
  const getAuthParams = useCallback(async (): Promise<AuthParams> => {
    if (!address) throw new Error('Wallet not connected');
    const lowerAddr = address.toLowerCase();

    const now = Date.now();
    const existing = cached.get(lowerAddr);
    if (existing && now < existing.expiresAt) {
      return {
        address: existing.address,
        signature: existing.signature,
        timestamp: existing.timestamp,
      };
    }
    // F-2J: piggy-back on any concurrent signing for THIS address.
    // Different-address requests must not wait for a popup that's pending
    // for a different wallet.
    const inflight = inFlight.get(lowerAddr);
    if (inflight) {
      const result = await inflight;
      // F-Y1: the in-flight promise resolves after the popup lands. If the
      // popup took longer than CACHE_TTL_MS to approve (or longer than the
      // server's 5-min replay window), the resolved entry's `expiresAt` may
      // already be in the past. Without this re-check we'd hand back the
      // stale signature once — and the WS upgrade would close 1008 on it,
      // tripping the F-2N pre-open failure terminal classifier.
      if (Date.now() < result.expiresAt) {
        return {
          address: result.address,
          signature: result.signature,
          timestamp: result.timestamp,
        };
      }
      // Fall through to sign a fresh challenge for this address.
    }

    const promise = (async (): Promise<CachedAuth> => {
      const ts = Math.floor(Date.now() / 1000);
      const message = `Clawbada Auth: ${ts}`;
      const signature = await signMessageAsync({ message });
      // F-2K: anchor cache expiry to the SIGNED timestamp, not approval time.
      // If the user's wallet popup sat open for 2 minutes, the server-side
      // 5-min replay window has already partially burned — set the client
      // expiry off the signed timestamp so we never reuse a server-expired
      // signature.
      const entry: CachedAuth = {
        address,
        signature,
        timestamp: ts,
        expiresAt: ts * 1000 + CACHE_TTL_MS,
      };
      // F-2P: only write the cache slot for THIS address (the per-address
      // Map keying ensures a slow popup for wallet A can't clobber a fresh
      // wallet B entry). Skip caching if the entry is already past its
      // anchor-derived expiry (popup took longer than CACHE_TTL_MS).
      if (entry.expiresAt > Date.now()) {
        cached.set(lowerAddr, entry);
      }
      return entry;
    })();
    inFlight.set(lowerAddr, promise);
    let result: CachedAuth;
    try {
      result = await promise;
    } finally {
      // Only clear if our promise is still the registered one.
      if (inFlight.get(lowerAddr) === promise) inFlight.delete(lowerAddr);
    }
    // F-Y1: same re-check on the freshly-signed entry. If the popup took
    // longer than CACHE_TTL_MS, `result.expiresAt` was anchored off the
    // signed timestamp (F-2K) and is already past. Throw a typed error so
    // the caller treats this as a transient retryable failure instead of
    // shipping a guaranteed-rejected signature to the server.
    if (Date.now() >= result.expiresAt) {
      throw new Error(
        'Wallet approval took longer than the auth window; please retry.',
      );
    }
    return {
      address: result.address,
      signature: result.signature,
      timestamp: result.timestamp,
    };
  }, [address, signMessageAsync]);

  /**
   * F-2H: invalidate the cached signature so the next `getAuthParams()` call
   * forces a fresh signMessage. Called by `useBattleWs` when the server
   * closes the socket with code `1008` (signature expired) — at that point
   * the cached signature is server-rejected even if its client TTL hasn't
   * yet elapsed.
   */
  const invalidateAuthCache = useCallback(() => {
    if (!address) return;
    const lowerAddr = address.toLowerCase();
    cached.delete(lowerAddr);
    // Don't touch in-flight promises — letting any pending popup resolve is
    // safer than aborting it. The next call will re-sign cleanly.
  }, [address]);

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const { address: a, signature, timestamp } = await getAuthParams();
    return {
      'X-Wallet-Address': a,
      'X-Signature': signature,
      'X-Timestamp': String(timestamp),
    };
  }, [getAuthParams]);

  return {
    getAuthHeaders,
    getAuthParams,
    invalidateAuthCache,
    isConnected: !!address,
  };
}
