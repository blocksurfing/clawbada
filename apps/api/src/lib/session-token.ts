import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAddress } from '@clawbada/chain';
import { ApiError } from './errors';

/**
 * Short-lived session tokens, so a player signs once instead of every few minutes.
 *
 * The wallet signature scheme it sits on top of has a 5-minute replay window, which means a
 * browser wallet pops a signing modal in the middle of a battle — over a live board, while the
 * shot clock runs. A player signs once here, gets a bearer token, and plays.
 *
 * Stateless by design (HMAC over the claims, no table, nothing to look up) because the thing it
 * stands in for is stateless too. The trade-off against the signature scheme is deliberate and
 * bounded: a leaked signature is usable for 5 minutes, a leaked token for at most TTL_SEC, and a
 * token carries no authority beyond the address it names — every route still checks ownership
 * and participation for itself.
 *
 * `sid` anchors the original signature, so refreshing cannot roll a session forward for ever:
 * past MAX_AGE_SEC from the first signature the wallet has to sign again.
 */

/** How long one token is good for. Long enough to cover a battle plus matchmaking. */
export const TOKEN_TTL_SEC = 2 * 60 * 60;
/** How far a session may be refreshed from its original signature before re-signing. */
export const SESSION_MAX_AGE_SEC = 24 * 60 * 60;
/** Refresh once the remaining life drops below this, so the client never races the expiry. */
export const TOKEN_REFRESH_AFTER_SEC = 20 * 60;

const PREFIX = 'clw1';

interface Claims {
  /** EIP-55 checksum address this token speaks for. */
  a: string;
  /** Issued at (unix seconds). */
  iat: number;
  /** Expires at (unix seconds). */
  exp: number;
  /** Session start: when the wallet actually signed. Refreshes inherit it. */
  sid: number;
}

let secret: Buffer | null = null;

/** HMAC key. `AUTH_SESSION_SECRET` keeps tokens valid across restarts and across instances; without
 *  it we mint a per-process key, which is just as strong but logs every player out on a redeploy. */
function key(): Buffer {
  if (secret) return secret;
  const fromEnv = process.env.AUTH_SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) {
    secret = Buffer.from(fromEnv, 'utf8');
  } else {
    if (fromEnv) console.warn('[auth] AUTH_SESSION_SECRET is shorter than 32 chars — ignoring it');
    console.warn('[auth] no AUTH_SESSION_SECRET — generating a per-process key; session tokens will not survive a restart');
    secret = randomBytes(32);
  }
  return secret;
}

/** Test seam: drop the cached key so a test can set the env and re-read it. */
export function resetSessionSecret(): void {
  secret = null;
}

const b64 = (buf: Buffer): string => buf.toString('base64url');

function sign(body: string): Buffer {
  return createHmac('sha256', key()).update(body).digest();
}

export interface MintedToken {
  token: string;
  /** Unix seconds — the client refreshes before this. */
  expiresAt: number;
  /** Unix seconds — past this the wallet must sign again, refresh or not. */
  sessionEndsAt: number;
}

/**
 * Mint a token for an address already proven by a wallet signature.
 * `sessionStart` carries over on refresh; omit it when a fresh signature was just verified.
 */
export function mintSessionToken(address: string, sessionStart?: number): MintedToken {
  const checksumAddress = getAddress(address);
  const now = Math.floor(Date.now() / 1000);
  const sid = sessionStart ?? now;
  const claims: Claims = { a: checksumAddress, iat: now, exp: now + TOKEN_TTL_SEC, sid };
  const body = `${PREFIX}.${b64(Buffer.from(JSON.stringify(claims), 'utf8'))}`;
  return {
    token: `${body}.${b64(sign(body))}`,
    expiresAt: claims.exp,
    sessionEndsAt: sid + SESSION_MAX_AGE_SEC,
  };
}

export interface VerifiedToken {
  checksumAddress: string;
  expiresAt: number;
  sessionStart: number;
}

/** Verify a bearer token. Throws ApiError(UNAUTHORIZED) on anything suspect. */
export function verifySessionToken(token: string): VerifiedToken {
  const bad = (msg: string) => new ApiError('UNAUTHORIZED', msg);
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) throw bad('Malformed session token');

  const expected = sign(`${parts[0]}.${parts[1]}`);
  let given: Buffer;
  try {
    given = Buffer.from(parts[2], 'base64url');
  } catch {
    throw bad('Malformed session token');
  }
  // Compare in constant time, and only when the lengths already match — timingSafeEqual throws otherwise.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw bad('Invalid session token');

  let claims: Claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Claims;
  } catch {
    throw bad('Malformed session token');
  }
  if (typeof claims.a !== 'string' || typeof claims.exp !== 'number' || typeof claims.sid !== 'number') {
    throw bad('Malformed session token');
  }

  const now = Math.floor(Date.now() / 1000);
  if (now >= claims.exp) throw bad('Session expired — sign in again');
  if (now >= claims.sid + SESSION_MAX_AGE_SEC) throw bad('Session too old — sign in again');

  let checksumAddress: string;
  try {
    checksumAddress = getAddress(claims.a);
  } catch {
    throw bad('Invalid session token address');
  }
  return { checksumAddress, expiresAt: claims.exp, sessionStart: claims.sid };
}

/** Pull a bearer token out of an Authorization header, or null when it isn't one. */
export function bearerFrom(header: string | undefined | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m ? m[1] : null;
}
