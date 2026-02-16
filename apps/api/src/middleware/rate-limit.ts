import type { MiddlewareHandler } from 'hono';

/**
 * Rate limiting middleware.
 * Limits requests per wallet address per time window.
 *
 * TODO: Implement using a sliding window counter
 * - Key: wallet address (from auth middleware) or IP
 * - Default: 100 requests per minute
 * - Battle endpoints: 30 requests per minute (higher-value actions)
 * - Faucet endpoints: 5 requests per minute (anti-abuse)
 */
export const rateLimit = (maxRequests = 100, windowMs = 60_000): MiddlewareHandler => {
  // TODO: Implement with in-memory Map or Redis
  return async (_c, next) => {
    await next();
  };
};
