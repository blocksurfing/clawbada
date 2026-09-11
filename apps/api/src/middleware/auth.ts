import type { MiddlewareHandler } from 'hono';
import { verifyMessage, getAddress } from '@clawbada/chain';
import { ApiError } from '../lib/errors';
import { bearerFrom, verifySessionToken } from '../lib/session-token';

/** Maximum allowable backdating of the timestamp (signed message in the past). */
export const AUTH_PAST_WINDOW_SEC = 5 * 60;
/** Maximum allowable forward-skew of the timestamp (signed message in the future).
 *  F-2F: kept tight (30s clock skew) so a future-dated signature can't
 *  effectively double the replay window to ~10 minutes. */
export const AUTH_FUTURE_SKEW_SEC = 30;

/** F-2A: maximum lifetime an authenticated WS socket may stay subscribed.
 *  Exposed for the upgrade handler so it can schedule a close timer that
 *  matches the signature's effective expiry. */
export const WS_AUTH_LIFETIME_SEC = AUTH_PAST_WINDOW_SEC;

export interface VerifiedWallet {
  /** EIP-55 checksum-cased address recovered from the signature. */
  checksumAddress: string;
  /** Unix seconds at which this signature should no longer be honored —
   *  `timestamp + AUTH_PAST_WINDOW_SEC`. Used by the WS upgrade handler to
   *  schedule a forced disconnect. */
  expiresAt: number;
}

/**
 * Pure EIP-191 verification helper. Used by:
 *   - `walletAuth` middleware (REST — values from `X-Wallet-Address`/`X-Signature`/`X-Timestamp` headers)
 *   - `/ws` upgrade handler (WebSocket — values from URL search params; F-03/F-07)
 *
 * Stateless — server reconstructs the canonical message from `timestamp` and
 * verifies the signature against the claimed address. 5-minute replay window
 * (`AUTH_WINDOW_MS`) bounds exposure of any leaked signature.
 *
 * Throws `ApiError(UNAUTHORIZED)` on any failure.
 */
export async function verifyWalletSignature(input: {
  address: string;
  signature: string;
  timestamp: number;
}): Promise<VerifiedWallet> {
  const { address, signature, timestamp } = input;

  if (Number.isNaN(timestamp)) {
    throw new ApiError('UNAUTHORIZED', 'Invalid timestamp');
  }
  const now = Math.floor(Date.now() / 1000);
  // F-2F: asymmetric window — `now - timestamp <= AUTH_PAST_WINDOW_SEC` (replay
  // limit) and `timestamp - now <= AUTH_FUTURE_SKEW_SEC` (clock skew only).
  // Symmetric `Math.abs(...)` previously allowed near-doubling of the
  // effective replay window via future-dated signatures.
  if (now - timestamp > AUTH_PAST_WINDOW_SEC) {
    throw new ApiError('UNAUTHORIZED', 'Timestamp expired');
  }
  if (timestamp - now > AUTH_FUTURE_SKEW_SEC) {
    throw new ApiError('UNAUTHORIZED', 'Timestamp too far in future');
  }

  let checksumAddress: string;
  try {
    checksumAddress = getAddress(address);
  } catch {
    throw new ApiError('UNAUTHORIZED', 'Invalid wallet address');
  }

  const message = `Clawbada Auth: ${timestamp}`;
  try {
    const valid = await verifyMessage({
      address: checksumAddress as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
    if (!valid) {
      throw new ApiError('UNAUTHORIZED', 'Invalid signature');
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError('UNAUTHORIZED', 'Signature verification failed');
  }

  return {
    checksumAddress,
    expiresAt: timestamp + AUTH_PAST_WINDOW_SEC,
  };
}

/**
 * Resolve the caller from a request's headers, by either accepted proof:
 *
 *   Authorization: Bearer <session token>   — a wallet signature already exchanged for a token
 *   X-Wallet-Address / X-Signature / X-Timestamp — a fresh EIP-191 signature
 *
 * The token path exists so a player is not asked to sign in the middle of a battle; the
 * signature path stays first-class for agents, which sign per request and hold no session.
 * Returns the EIP-55 checksum address. Throws ApiError(UNAUTHORIZED) if neither proof holds.
 */
export async function resolveCaller(req: { header(name: string): string | undefined }): Promise<string> {
  const bearer = bearerFrom(req.header('Authorization'));
  if (bearer) return verifySessionToken(bearer).checksumAddress;

  const address = req.header('X-Wallet-Address');
  const signature = req.header('X-Signature');
  const timestampStr = req.header('X-Timestamp');
  if (!address || !signature || !timestampStr) {
    throw new ApiError(
      'UNAUTHORIZED',
      'Missing auth: send Authorization: Bearer <session token>, or X-Wallet-Address, X-Signature and X-Timestamp',
    );
  }
  const { checksumAddress } = await verifyWalletSignature({
    address,
    signature,
    timestamp: Number(timestampStr),
  });
  return checksumAddress;
}

/**
 * Wallet-based authentication middleware (REST). Accepts a session token or a fresh signature —
 * see `resolveCaller`.
 */
export const walletAuth: MiddlewareHandler = async (c, next) => {
  c.set('address', await resolveCaller(c.req));
  await next();
};
