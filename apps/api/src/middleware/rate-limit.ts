import type { MiddlewareHandler } from 'hono';
import { ApiError } from '../lib/errors';

// In-memory sliding window: Map<key, timestamp[]>
const windows = new Map<string, number[]>();

// Periodic cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of windows) {
    const valid = timestamps.filter((t) => now - t < 120_000); // keep 2min of data
    if (valid.length === 0) {
      windows.delete(key);
    } else {
      windows.set(key, valid);
    }
  }
}, 5 * 60 * 1000);

/**
 * Rate limiting middleware using in-memory sliding window.
 * Keys by authenticated wallet address or IP fallback.
 */
export const rateLimit = (maxRequests = 100, windowMs = 60_000): MiddlewareHandler => {
  return async (c, next) => {
    const address = c.get('address') as string | undefined;
    const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown';
    const key = address ?? ip;

    const now = Date.now();
    const timestamps = windows.get(key) ?? [];
    const windowStart = now - windowMs;
    const recent = timestamps.filter((t) => t > windowStart);

    if (recent.length >= maxRequests) {
      throw new ApiError('RATE_LIMITED', `Rate limit exceeded: ${maxRequests} requests per ${windowMs / 1000}s`);
    }

    recent.push(now);
    windows.set(key, recent);

    await next();
  };
};
