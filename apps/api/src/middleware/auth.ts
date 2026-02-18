import type { MiddlewareHandler } from 'hono';
import { verifyMessage, getAddress } from '@clawbada/chain';
import { ApiError } from '../lib/errors';

const AUTH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Wallet-based authentication middleware.
 * Verifies EIP-191 signed messages to authenticate wallet ownership.
 *
 * Expected headers:
 *   X-Wallet-Address: 0x...
 *   X-Signature: 0x...
 *   X-Timestamp: Unix timestamp in seconds
 */
export const walletAuth: MiddlewareHandler = async (c, next) => {
  const address = c.req.header('X-Wallet-Address');
  const signature = c.req.header('X-Signature');
  const timestampStr = c.req.header('X-Timestamp');

  if (!address || !signature || !timestampStr) {
    throw new ApiError('UNAUTHORIZED', 'Missing auth headers: X-Wallet-Address, X-Signature, X-Timestamp');
  }

  const timestamp = Number(timestampStr);
  if (Number.isNaN(timestamp)) {
    throw new ApiError('UNAUTHORIZED', 'Invalid timestamp');
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > AUTH_WINDOW_MS / 1000) {
    throw new ApiError('UNAUTHORIZED', 'Timestamp expired or too far in future');
  }

  const message = `Clawbada Auth: ${timestamp}`;

  let checksumAddress: string;
  try {
    checksumAddress = getAddress(address);
  } catch {
    throw new ApiError('UNAUTHORIZED', 'Invalid wallet address');
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

  c.set('address', checksumAddress);
  await next();
};
