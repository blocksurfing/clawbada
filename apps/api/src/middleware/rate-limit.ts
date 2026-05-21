import type { MiddlewareHandler } from 'hono';
import { log as baseLog } from '../logger';
import { ApiError } from '../lib/errors';
import { getClientIp } from '../lib/client-ip';

const log = baseLog.child({ module: 'rate-limit' });

// ─── Backend interface ───

interface RateLimitBackend {
  /** Returns the request count after incrementing. */
  hit(key: string, windowMs: number): Promise<number>;
}

// ─── In-memory backend (single instance / local dev) ───

class MemoryBackend implements RateLimitBackend {
  private windows = new Map<string, number[]>();

  constructor() {
    // Periodic cleanup every 5 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [key, timestamps] of this.windows) {
        const valid = timestamps.filter((t) => now - t < 120_000);
        if (valid.length === 0) {
          this.windows.delete(key);
        } else {
          this.windows.set(key, valid);
        }
      }
    }, 5 * 60 * 1000);
  }

  async hit(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    const timestamps = this.windows.get(key) ?? [];
    const recent = timestamps.filter((t) => t > now - windowMs);
    recent.push(now);
    this.windows.set(key, recent);
    return recent.length;
  }
}

// ─── Redis backend (multi-instance production) ───

class RedisBackend implements RateLimitBackend {
  private redis: import('ioredis').default;

  constructor(redis: import('ioredis').default) {
    this.redis = redis;
  }

  async hit(key: string, windowMs: number): Promise<number> {
    const redisKey = `rl:${key}`;
    const ttlSeconds = Math.ceil(windowMs / 1000);

    // INCR + EXPIRE is atomic enough — worst case a key lives one extra window
    const count = await this.redis.incr(redisKey);
    if (count === 1) {
      await this.redis.expire(redisKey, ttlSeconds);
    }
    return count;
  }
}

// ─── Singleton backend ───

let backend: RateLimitBackend | null = null;

async function getBackend(): Promise<RateLimitBackend> {
  if (backend) return backend;

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const { default: Redis } = await import('ioredis');
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    try {
      await redis.connect();
      backend = new RedisBackend(redis);
      log.info('Using Redis backend');
    } catch (err) {
      log.warn({ err }, 'Redis connection failed, falling back to in-memory');
      redis.disconnect();
      backend = new MemoryBackend();
    }
  } else {
    backend = new MemoryBackend();
    log.info('Using in-memory backend (set REDIS_URL for multi-instance)');
  }

  return backend;
}

// Eagerly initialize on module load
getBackend();

// ─── Middleware ───

/**
 * Rate limiting middleware with Redis or in-memory sliding window.
 * Uses Redis when REDIS_URL is set, in-memory Map otherwise.
 * Keys by authenticated wallet address or IP fallback.
 */
export const rateLimit = (maxRequests = 100, windowMs = 60_000): MiddlewareHandler => {
  return async (c, next) => {
    const address = c.get('address') as string | undefined;
    // F-2O: use the same trust policy as the WS upgrade. The Bun server is
    // threaded through Hono's env from the top-level fetch handler so we can
    // resolve the connection peer when TRUST_PROXY is off (the default).
    const server = (c.env as { server?: Parameters<typeof getClientIp>[1] } | undefined)?.server;
    const ip = getClientIp(c.req.raw, server);
    const key = address ?? ip;

    const b = await getBackend();
    const count = await b.hit(key, windowMs);

    if (count > maxRequests) {
      throw new ApiError('RATE_LIMITED', `Rate limit exceeded: ${maxRequests} requests per ${windowMs / 1000}s`);
    }

    await next();
  };
};
