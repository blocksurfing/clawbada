import { getAddress } from 'viem';

/**
 * The message a wallet signs to log in to the Clawbada API — EIP-4361 ("Sign-In with Ethereum").
 * Single source of truth for the API (which rebuilds it to verify), the web app, the e2e agents
 * and the scripts. Any drift makes every login fail, so nothing else may format this string.
 *
 * Audit C-01: the old message was the bare text `Clawbada Auth: <unix time>`. It named no site,
 * no chain and nothing about what was being authorised, so any other site — or a testnet or
 * preview deployment of Clawbada itself — could ask a player to sign the identical string and the
 * mainnet API would accept it. One phished signature let an opponent act as the victim in a staked
 * battle (submit turns, resign). EIP-4361 binds the signature to a domain, a URI and a chain id,
 * and wallets that understand the format warn when the domain is not the page asking.
 *
 * Replay: a signature is accepted for AUTH_TTL_SEC after `issuedAt` and may be reused within that
 * window (clients cache one for REST and the socket), exactly as before. The nonce makes every
 * message unique and is required by the standard; it is not tracked server-side.
 */
export const AUTH_TTL_SEC = 5 * 60;

export const AUTH_STATEMENT =
  'Sign in to Clawbada. This signature only authorises game API requests for the next 5 minutes. It cannot move funds.';

/** EIP-4361: at least 8 alphanumeric characters. */
export const AUTH_NONCE_RE = /^[a-zA-Z0-9]{8,64}$/;
/** host[:port] — no scheme, path, userinfo or whitespace. */
export const AUTH_DOMAIN_RE = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/;

export interface AuthMessageParams {
  /** host[:port] of the site requesting the signature, e.g. `clawbada-web.vercel.app`. */
  domain: string;
  address: string;
  chainId: number;
  nonce: string;
  /** Unix seconds. Sent to the API as X-Timestamp. */
  issuedAt: number;
}

/** The URI is derived from the domain so it is not a second thing a client could get wrong. */
export function authUriFor(domain: string): string {
  return `${/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(domain) ? 'http' : 'https'}://${domain}`;
}

const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();

export function buildAuthMessage(p: AuthMessageParams): string {
  if (!AUTH_DOMAIN_RE.test(p.domain)) throw new Error('auth message: domain must be host[:port]');
  if (!AUTH_NONCE_RE.test(p.nonce)) throw new Error('auth message: nonce must be 8-64 alphanumeric characters');
  if (!Number.isInteger(p.chainId) || p.chainId <= 0) throw new Error('auth message: bad chain id');
  if (!Number.isInteger(p.issuedAt) || p.issuedAt <= 0) throw new Error('auth message: bad issuedAt');
  return [
    `${p.domain} wants you to sign in with your Ethereum account:`,
    getAddress(p.address),
    '',
    AUTH_STATEMENT,
    '',
    `URI: ${authUriFor(p.domain)}`,
    'Version: 1',
    `Chain ID: ${p.chainId}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${iso(p.issuedAt)}`,
    `Expiration Time: ${iso(p.issuedAt + AUTH_TTL_SEC)}`,
  ].join('\n');
}

/** 16 random hex characters. */
export function newAuthNonce(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
