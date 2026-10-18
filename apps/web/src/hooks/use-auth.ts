'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAccount, useSignMessage, useSwitchChain } from 'wagmi';
import { api } from '@/lib/api';
import { buildAuthMessage, newAuthNonce } from '@clawbada/chain';

const CACHE_TTL_MS = 4.5 * 60 * 1000; // 4.5 minutes (server TTL = 5 min)
/** Renew a session token once its remaining life drops below this. */
const TOKEN_REFRESH_MARGIN_MS = 20 * 60 * 1000;
const SESSION_STORAGE_PREFIX = 'clawbada.session.';
/** The guest session's slot in localStorage (one per browser; the wallet sessions are keyed by address). */
const GUEST_STORAGE_KEY = 'guest';
/** How long an action waits for wagmi to finish probing connectors before concluding there is no wallet. */
const WALLET_SETTLE_MS = 5_000;

interface CachedAuth {
  address: string;
  signature: string;
  timestamp: number;
  /** C-01: the EIP-4361 nonce and domain the signature was made over — the API needs both to
   *  rebuild the exact message. */
  nonce: string;
  domain: string;
  expiresAt: number;
}

/** The chains the API will accept in a login message, fetched once. `chainIds[0]` is the one it
 *  serves; the rest are accepted so a wallet need not switch networks merely to sign in. */
let authChainsPromise: Promise<number[]> | null = null;
function getAuthChains(): Promise<number[]> {
  if (!authChainsPromise) {
    authChainsPromise = api.auth
      .params()
      .then((p) => (p.chainIds?.length ? p.chainIds : [p.chainId]))
      .catch((err) => {
        authChainsPromise = null; // let the next attempt retry
        throw err;
      });
  }
  return authChainsPromise;
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

/**
 * Session tokens, keyed by lower-cased address like the signature cache above.
 *
 * A signature is only good for five minutes, which meant the wallet interrupted a live battle to
 * re-sign — a modal over the board with the shot clock running. The signature is now exchanged
 * once for a bearer token that outlives a match, renewed without the wallet, and kept in
 * localStorage so a reload does not prompt either.
 */
interface Session {
  token: string;
  address: string;
  expiresAtMs: number;
  sessionEndsAtMs: number;
  /** A guest session: no wallet behind the address; the API accepts it for practice battles only. */
  guest?: boolean;
}
const sessions = new Map<string, Session>();
const sessionInFlight = new Map<string, Promise<Session>>();

/**
 * The guest session — the Dojo without a wallet.
 *
 * One per browser, held at module scope like the wallet caches and mirrored into localStorage, so a
 * reload or the battle page finds the same throwaway identity. It is minted only inside an action (the
 * Dojo's Train, a forfeit) and only for a page that opted in with `allowGuest` — never on page load, so
 * a visitor who merely looks around is never given an identity, and a wallet that wagmi is still
 * reconnecting is never mistaken for a guest. A wallet always wins when one is connected.
 */
let guestSession: Session | null = null;
let guestLoaded = false;
let guestInFlight: Promise<Session> | null = null;
const guestListeners = new Set<() => void>();
function setGuest(s: Session | null): void {
  guestSession = s;
  try {
    if (s) window.localStorage.setItem(SESSION_STORAGE_PREFIX + GUEST_STORAGE_KEY, JSON.stringify(s));
    else window.localStorage.removeItem(SESSION_STORAGE_PREFIX + GUEST_STORAGE_KEY);
  } catch {
    /* private mode, quota — the in-memory copy still covers this tab */
  }
  for (const l of guestListeners) l();
}
/** Read the stored guest once per tab (client only — called from an effect). */
function loadGuestOnce(): void {
  if (guestLoaded) return;
  guestLoaded = true;
  const s = loadStoredSession(GUEST_STORAGE_KEY);
  if (s?.guest && Date.now() < s.sessionEndsAtMs) guestSession = s;
  for (const l of guestListeners) l();
}
const subscribeGuest = (l: () => void) => { guestListeners.add(l); return () => { guestListeners.delete(l); }; };
const guestAddressSnapshot = (): string | null => guestSession?.address ?? null;
const noGuest = (): string | null => null;

function loadStoredSession(lowerAddr: string): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_PREFIX + lowerAddr);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (typeof s?.token !== 'string' || typeof s?.expiresAtMs !== 'number') return null;
    return s;
  } catch {
    return null;   // private mode, quota, corrupt entry — just sign again
  }
}

function storeSession(lowerAddr: string, s: Session): void {
  sessions.set(lowerAddr, s);
  try {
    window.localStorage.setItem(SESSION_STORAGE_PREFIX + lowerAddr, JSON.stringify(s));
  } catch {
    /* non-fatal: the in-memory copy still covers this tab */
  }
}

function clearStoredSession(lowerAddr: string): void {
  sessions.delete(lowerAddr);
  try {
    window.localStorage.removeItem(SESSION_STORAGE_PREFIX + lowerAddr);
  } catch {
    /* ignore */
  }
}

const toSession = (r: { token: string; address: string; expiresAt: number; sessionEndsAt: number; guest?: boolean }): Session => ({
  token: r.token,
  address: r.address,
  expiresAtMs: r.expiresAt * 1000,
  sessionEndsAtMs: r.sessionEndsAt * 1000,
  ...(r.guest ? { guest: true } : {}),
});

export interface AuthParams {
  address: string;
  signature: string;
  timestamp: number;
  nonce: string;
  domain: string;
}

export interface UseAuthOptions {
  /** Let the page work without a wallet through a guest session (the Dojo; practice battles only). */
  allowGuest?: boolean;
  /** Act as THIS identity when it is the stored guest, even if a wallet has since connected: the battle
   *  page pins the guest that started a practice battle so the battle does not change hands midway. */
  forAddress?: string;
}

export function useAuth(opts: UseAuthOptions = {}) {
  // `chainId` here is the CONNECTION's chain — what the wallet is actually on.
  // NOT `useChainId()`, which returns `config.state.chainId`: the config's own chain,
  // seeded from `chains[0]` and only updated when the connector reports a change. That
  // reads as the API's chain while the wallet sits on another one, so a guard against it
  // passes and the wallet then rejects the message. See the switch below.
  const { address, chainId: connectedChainId, status } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();

  // ── Guest identity (see the module-scope notes above) ──
  const allowGuest = !!opts.allowGuest;
  const guestAddress = useSyncExternalStore(subscribeGuest, guestAddressSnapshot, noGuest);
  const [guestHydrated, setGuestHydrated] = useState(false);
  useEffect(() => {
    if (!allowGuest) return;
    loadGuestOnce();
    setGuestHydrated(true);
  }, [allowGuest]);
  // wagmi reconnects a remembered wallet after mount — and ConnectKit's connectors keep the status at
  // 'connecting' for a few seconds while they probe (longer in a headless browser). Until it has decided,
  // nobody is a guest; an action started in that window waits for the decision (see getSessionToken).
  const settling = status === 'reconnecting' || status === 'connecting';
  const resolving = settling || (allowGuest && !guestHydrated);
  const pinnedGuest = !!opts.forAddress && !!guestAddress && opts.forAddress.toLowerCase() === guestAddress.toLowerCase();
  const asGuest = allowGuest && (opts.forAddress ? pinnedGuest : !address && !resolving);
  // Live values for a callback that outlives the render it was created in (the wait below).
  const statusRef = useRef(status);
  statusRef.current = status;
  const addressRef = useRef(address);
  addressRef.current = address;

  /** The guest's bearer token: the stored one, a silent refresh, or a brand-new guest (a new one is as good as the old). */
  const getGuestToken = useCallback(async (): Promise<string> => {
    const current = guestSession;
    if (current && Date.now() < current.expiresAtMs - TOKEN_REFRESH_MARGIN_MS) return current.token;
    if (guestInFlight) {
      const s = await guestInFlight;
      if (Date.now() < s.expiresAtMs) return s.token;
    }
    const promise = (async (): Promise<Session> => {
      if (current && Date.now() < current.expiresAtMs && Date.now() < current.sessionEndsAtMs) {
        try {
          const refreshed = toSession(await api.auth.refresh(current.token));
          setGuest(refreshed);
          return refreshed;
        } catch {
          /* fall through to a fresh guest */
        }
      }
      const minted = toSession(await api.auth.guest());
      setGuest(minted);
      return minted;
    })();
    guestInFlight = promise;
    try {
      return (await promise).token;
    } finally {
      if (guestInFlight === promise) guestInFlight = null;
    }
  }, []);

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
        nonce: existing.nonce,
        domain: existing.domain,
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
          nonce: result.nonce,
          domain: result.domain,
        };
      }
      // Fall through to sign a fresh challenge for this address.
    }

    const promise = (async (): Promise<CachedAuth> => {
      // C-01: an EIP-4361 message bound to THIS site and the API's chain. The old bare string
      // ("Clawbada Auth: <time>") could be requested by any site and replayed against the API.
      // Sign with the chain the wallet is ALREADY on when the API accepts it. Practice
      // battles are entirely off-chain, so making someone switch networks — and on wallets
      // that hide test networks, enable a developer setting — just to log in was a barrier
      // in front of the part of the game that has no chain in it. On-chain actions still
      // prompt for the right network at transaction time, which is when it matters.
      const accepted = await getAuthChains();
      // If the wallet is already on a chain the API accepts, sign there and switch nothing.
      // Otherwise pick the accepted chain that is EASIEST to reach: Base mainnet over Base
      // Sepolia, because wallets that hide test networks (Phantom's "Testnet mode") refuse a
      // testnet switch outright until a developer setting is on. Logging in on mainnet while
      // the game runs on Sepolia is fine — the signature only authorises API calls, and
      // anything on-chain prompts for the right network when the transaction is sent.
      const BASE_MAINNET = 8453;
      const chainId =
        connectedChainId && accepted.includes(connectedChainId)
          ? connectedChainId
          : accepted.includes(BASE_MAINNET)
            ? BASE_MAINNET
            : accepted[0]!;
      // A wallet will not DISPLAY an EIP-4361 message whose `Chain ID:` differs from the chain
      // it is connected to — it errors out before the user ever sees a prompt ("the chain ID
      // does not match the provided chain ID for verification"). Before C-01 the message was a
      // bare string with no chain in it, so any chain worked and nothing had to switch. Now the
      // wallet has to be on the API's chain first. This blocks login outright, including for
      // practice battles, which are otherwise entirely off-chain.
      // Switch unless the CONNECTION positively reports it is already there. `undefined`
      // means we do not know, so switch — a switch to the chain the wallet is already on is
      // a no-op per EIP-3326, whereas skipping a needed one breaks login outright.
      if (connectedChainId !== chainId) {
        console.info(`[auth] wallet on chain ${connectedChainId ?? 'unknown'}; API accepts ${accepted.join('/')} — switching to ${chainId}`);
        try {
          await switchChainAsync({ chainId });
        } catch (err) {
          // Wallets that hide test networks behind a setting (Phantom's "Testnet mode",
          // and others like it) refuse the switch outright rather than prompting, so the
          // switch failing is NOT necessarily a rejected prompt. Say so while the game is
          // on Sepolia — otherwise this is a dead end for anyone using such a wallet.
          const testnet = chainId !== 8453 && chainId !== 1;
          throw new Error(
            `Clawbada runs on chain ${chainId}; your wallet is on ${connectedChainId ?? 'another network'}. ` +
              'Approve the network switch, or switch manually in your wallet and try again.' +
              (testnet
                ? ' If your wallet refused, it may hide test networks — turn on testnet mode'
                  + " (Phantom: Settings → Developer Settings → Testnet Mode) and retry."
                : ''),
            { cause: err },
          );
        }
      }
      const ts = Math.floor(Date.now() / 1000);
      const nonce = newAuthNonce();
      const domain = window.location.host;
      const message = buildAuthMessage({ domain, address, chainId, nonce, issuedAt: ts });
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
        nonce,
        domain,
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
      nonce: result.nonce,
      domain: result.domain,
    };
  }, [address, signMessageAsync, connectedChainId, switchChainAsync]);

  /**
   * F-2H: invalidate the cached signature so the next `getAuthParams()` call
   * forces a fresh signMessage. Called by `useBattleWs` when the server
   * closes the socket with code `1008` (signature expired) — at that point
   * the cached signature is server-rejected even if its client TTL hasn't
   * yet elapsed.
   */
  const invalidateAuthCache = useCallback(() => {
    if (asGuest) { setGuest(null); return; }   // the next call mints a fresh guest
    if (!address) return;
    const lowerAddr = address.toLowerCase();
    cached.delete(lowerAddr);
    // The session token is a proof too: if the server rejected us, drop it as well or the next
    // attempt replays the same rejected credential.
    clearStoredSession(lowerAddr);
    // Don't touch in-flight promises — letting any pending popup resolve is
    // safer than aborting it. The next call will re-sign cleanly.
  }, [address, asGuest]);

  /**
   * The bearer token for this wallet, signing only when there is no usable session.
   *
   * Order of preference: a live token in memory or localStorage, then a silent refresh (no
   * wallet), and only then a signature. That is what keeps a battle free of signing modals —
   * the token outlives a match, and renewing it never touches the wallet.
   */
  const getSessionToken = useCallback(async (): Promise<string> => {
    if (asGuest) return getGuestToken();
    if (allowGuest && !opts.forAddress && !address) {
      // Clicked while wagmi was still probing connectors: wait for it to settle before deciding there is
      // no wallet, instead of failing a visitor who has none with "Wallet not connected".
      const deadline = Date.now() + WALLET_SETTLE_MS;
      while ((statusRef.current === 'connecting' || statusRef.current === 'reconnecting') && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 150));
      }
      if (!addressRef.current) return getGuestToken();
      // A remembered wallet came back during the wait: this closure predates it, so ask for one more click.
      throw new Error('Your wallet just reconnected — try again.');
    }
    if (!address) throw new Error('Wallet not connected');
    const lowerAddr = address.toLowerCase();
    const now = Date.now();

    let current = sessions.get(lowerAddr) ?? loadStoredSession(lowerAddr);
    if (current && current.address.toLowerCase() !== lowerAddr) current = null;   // stale wallet switch
    if (current && now < current.expiresAtMs - TOKEN_REFRESH_MARGIN_MS) {
      sessions.set(lowerAddr, current);
      return current.token;
    }

    // One acquisition at a time per address, mirroring the signature cache above, so two
    // callers (REST and WebSocket) cannot start two sign-ins.
    const pending = sessionInFlight.get(lowerAddr);
    if (pending) {
      const s = await pending;
      if (Date.now() < s.expiresAtMs) return s.token;
    }

    const promise = (async (): Promise<Session> => {
      // Renew silently while the token is still valid and the session has not aged out.
      if (current && Date.now() < current.expiresAtMs && Date.now() < current.sessionEndsAtMs) {
        try {
          const refreshed = toSession(await api.auth.refresh(current.token));
          storeSession(lowerAddr, refreshed);
          return refreshed;
        } catch {
          clearStoredSession(lowerAddr);   // fall through to a signature
        }
      }
      const headers = await getAuthHeadersFromSignature();
      const minted = toSession(await api.auth.session(headers));
      storeSession(lowerAddr, minted);
      return minted;
    })();

    sessionInFlight.set(lowerAddr, promise);
    try {
      return (await promise).token;
    } finally {
      if (sessionInFlight.get(lowerAddr) === promise) sessionInFlight.delete(lowerAddr);
    }

    async function getAuthHeadersFromSignature(): Promise<Record<string, string>> {
      const { address: a, signature, timestamp, nonce, domain } = await getAuthParams();
      return { 'X-Wallet-Address': a, 'X-Signature': signature, 'X-Timestamp': String(timestamp), 'X-Nonce': nonce, 'X-Auth-Domain': domain };
    }
  }, [address, asGuest, allowGuest, opts.forAddress, getAuthParams, getGuestToken]);

  /** REST auth: a bearer token. Falls back to nothing else — a failure here is a real failure. */
  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    return { Authorization: `Bearer ${await getSessionToken()}` };
  }, [getSessionToken]);

  return {
    getAuthHeaders,
    getAuthParams,
    getSessionToken,
    invalidateAuthCache,
    /** A wallet is connected. Unchanged by guests: transaction buttons and the queue key off this. */
    isConnected: !!address,
    /** Who the page acts as: the wallet when one is connected, else the guest once a page allowed one and it exists. */
    address: asGuest ? guestAddress : (address ?? null),
    kind: (asGuest ? (guestAddress ? 'guest' : null) : address ? 'wallet' : null) as 'wallet' | 'guest' | null,
    /** True while wagmi is still reconnecting a remembered wallet or the stored guest has not been read yet. */
    resolving,
    /** wagmi's connection status, for pages (and probes) that want to show why `resolving` is still true. */
    walletStatus: status,
    /** The stored guest has been read (client only). The battle page uses it to recognise its guest without waiting on wagmi. */
    guestReady: !allowGuest || guestHydrated,
    /** The stored guest's address, whether or not it is the identity in use (the battle page matches it against a battle's owner). */
    guestAddress,
  };
}
