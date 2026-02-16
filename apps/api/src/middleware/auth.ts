import type { MiddlewareHandler } from 'hono';

/**
 * Wallet-based authentication middleware.
 * Verifies EIP-191 signed messages to authenticate wallet ownership.
 *
 * Expected headers:
 *   X-Wallet-Address: 0x...
 *   X-Signature: 0x...
 *   X-Timestamp: Unix timestamp (for replay protection)
 */
export const walletAuth: MiddlewareHandler = async (c, next) => {
  // TODO: Implement signature verification
  // 1. Extract address, signature, timestamp from headers
  // 2. Verify timestamp is within acceptable window (e.g., 5 minutes)
  // 3. Reconstruct message: `Clawbada Auth: ${timestamp}`
  // 4. Recover signer from signature using viem's verifyMessage
  // 5. Compare recovered address to claimed address
  // 6. Set c.set('address', verifiedAddress) for downstream handlers
  await next();
};
