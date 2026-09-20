import type { MiddlewareHandler } from 'hono';
import { verifyMessage, getAddress } from '@clawbada/chain';
// Deep import on purpose: a dozen route tests replace '@clawbada/chain' wholesale with a stub
// (verifyMessage → true), and the login message must still be the real one under them.
import { buildAuthMessage, AUTH_NONCE_RE, AUTH_DOMAIN_RE } from '@clawbada/chain/src/auth-message';
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

/**
 * Sites allowed to request a login signature (EIP-4361 `domain`, host[:port]). A signature made
 * for any other domain is refused, so a look-alike site cannot mint one this API will accept.
 * AUTH_DOMAINS (comma-separated) overrides; the first entry is the default for callers that send
 * no X-Auth-Domain (agents and scripts have no page origin). Localhost is allowed outside production.
 */
export function allowedAuthDomains(env: Record<string, string | undefined> = process.env): string[] {
  const configured = (env.AUTH_DOMAINS ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (configured.length) return configured;
  const defaults = ['clawbada-web.vercel.app'];
  if (env.NODE_ENV !== 'production') defaults.push('localhost:3000', '127.0.0.1:3000');
  return defaults;
}

/** The chain this API serves — part of the signed message, so a testnet signature is useless on mainnet. */
export function authChainId(env: Record<string, string | undefined> = process.env): number {
  return env.CHAIN_ENV === 'mainnet' ? 8453 : 84532;
}

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
  /** EIP-4361 nonce (X-Nonce / ?nonce=). Absent = the legacy bare-string message. */
  nonce?: string | null;
  /** EIP-4361 domain (X-Auth-Domain / ?domain=). Defaults to the first allowed domain. */
  domain?: string | null;
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

  let message: string;
  if (input.nonce) {
    // C-01: EIP-4361. The message is rebuilt here from the API's OWN domain allow-list and
    // chain id, so a signature made for another site or another chain cannot verify.
    if (!AUTH_NONCE_RE.test(input.nonce)) throw new ApiError('UNAUTHORIZED', 'Invalid nonce: 8-64 alphanumeric characters');
    const allowed = allowedAuthDomains();
    const domain = (input.domain ?? allowed[0] ?? '').toLowerCase();
    if (!AUTH_DOMAIN_RE.test(domain) || !allowed.includes(domain)) {
      throw new ApiError('UNAUTHORIZED', 'This site is not allowed to sign in to the Clawbada API');
    }
    message = buildAuthMessage({ domain, address: checksumAddress, chainId: authChainId(), nonce: input.nonce, issuedAt: timestamp });
  } else if (process.env.AUTH_ALLOW_LEGACY === '1') {
    // Rollout only: the web app and the API deploy separately. Unset once both are live.
    message = `Clawbada Auth: ${timestamp}`;
  } else {
    throw new ApiError('UNAUTHORIZED', 'Unsupported login message: sign the EIP-4361 message (see GET /api/auth/params) and send X-Nonce');
  }
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
 *   X-Wallet-Address / X-Signature / X-Timestamp / X-Nonce [/ X-Auth-Domain] — a fresh signature
 *     over the EIP-4361 login message (packages/chain buildAuthMessage; GET /api/auth/params)
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
      'Missing auth: send Authorization: Bearer <session token>, or X-Wallet-Address, X-Signature, X-Timestamp and X-Nonce',
    );
  }
  const { checksumAddress } = await verifyWalletSignature({
    address,
    signature,
    timestamp: Number(timestampStr),
    nonce: req.header('X-Nonce'),
    domain: req.header('X-Auth-Domain'),
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
