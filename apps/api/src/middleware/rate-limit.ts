import type { MiddlewareHandler } from 'hono';
import { ApiError } from '../lib/errors';

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
      console.log('[rate-limit] Using Redis backend');
    } catch (err) {
      console.warn('[rate-limit] Redis connection failed, falling back to in-memory:', (err as Error).message);
      redis.disconnect();
      backend = new MemoryBackend();
    }
  } else {
    backend = new MemoryBackend();
    console.log('[rate-limit] Using in-memory backend (set REDIS_URL for multi-instance)');
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
    const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown';
    const key = address ?? ip;

    const b = await getBackend();
    const count = await b.hit(key, windowMs);

    if (count > maxRequests) {
      throw new ApiError('RATE_LIMITED', `Rate limit exceeded: ${maxRequests} requests per ${windowMs / 1000}s`);
    }

    await next();
  };
};
