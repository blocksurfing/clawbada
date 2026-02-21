import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { rateLimit } from '../middleware/rate-limit';
import { ApiError } from '../lib/errors';

// Each test uses a unique IP to avoid interference from the module-level singleton backend.
let testCounter = 0;
function uniqueIp(): string {
  return `10.99.${Math.floor(testCounter / 256)}.${testCounter++ % 256}`;
}

function createApp(max: number, windowMs: number) {
  const app = new Hono();
  // Mirror the global onError handler from index.ts so ApiError thrown by
  // middleware is serialised to the correct HTTP status instead of a bare 500.
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: err.code, message: err.message }, err.status as any);
    }
    return c.json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }, 500);
  });
  app.use('*', rateLimit(max, windowMs));
  app.get('/test', (c) => c.text('ok'));
  return app;
}

describe('rateLimit middleware', () => {
  test('first request passes with 200', async () => {
    const app = createApp(5, 60_000);
    const ip = uniqueIp();
    const res = await app.request('/test', {
      headers: { 'x-forwarded-for': ip },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  test('allows exactly maxRequests, blocks maxRequests+1', async () => {
    const max = 3;
    const app = createApp(max, 60_000);
    const ip = uniqueIp();

    // First 3 requests should pass
    for (let i = 0; i < max; i++) {
      const res = await app.request('/test', {
        headers: { 'x-forwarded-for': ip },
      });
      expect(res.status).toBe(200);
    }

    // 4th request should be rate limited
    const res = await app.request('/test', {
      headers: { 'x-forwarded-for': ip },
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('RATE_LIMITED');
  });

  test('different keys (IPs) are tracked independently', async () => {
    const max = 2;
    const app = createApp(max, 60_000);
    const ipA = uniqueIp();
    const ipB = uniqueIp();

    // Exhaust ipA's limit
    for (let i = 0; i < max; i++) {
      await app.request('/test', { headers: { 'x-forwarded-for': ipA } });
    }
    const blockedA = await app.request('/test', {
      headers: { 'x-forwarded-for': ipA },
    });
    expect(blockedA.status).toBe(429);

    // ipB should still be allowed
    const allowedB = await app.request('/test', {
      headers: { 'x-forwarded-for': ipB },
    });
    expect(allowedB.status).toBe(200);
  });

  test('uses X-Forwarded-For header as key', async () => {
    const max = 2;
    const app = createApp(max, 60_000);
    const ip = uniqueIp();

    // Make max requests with the same forwarded IP
    for (let i = 0; i < max; i++) {
      await app.request('/test', { headers: { 'x-forwarded-for': ip } });
    }

    // Next request from same forwarded IP should be blocked
    const res = await app.request('/test', {
      headers: { 'x-forwarded-for': ip },
    });
    expect(res.status).toBe(429);
  });

  test('uses X-Real-IP as fallback when no X-Forwarded-For', async () => {
    const max = 2;
    const app = createApp(max, 60_000);
    const ip = uniqueIp();

    // Make max requests using X-Real-IP only (no X-Forwarded-For)
    for (let i = 0; i < max; i++) {
      await app.request('/test', { headers: { 'x-real-ip': ip } });
    }

    // Next request from same X-Real-IP should be blocked
    const res = await app.request('/test', {
      headers: { 'x-real-ip': ip },
    });
    expect(res.status).toBe(429);
  });

  test('X-Forwarded-For takes precedence over X-Real-IP', async () => {
    const max = 2;
    const app = createApp(max, 60_000);
    const forwardedIp = uniqueIp();
    const realIp = uniqueIp();

    // Exhaust the forwarded IP's limit
    for (let i = 0; i < max; i++) {
      await app.request('/test', {
        headers: { 'x-forwarded-for': forwardedIp, 'x-real-ip': realIp },
      });
    }

    // Blocked because X-Forwarded-For is the key
    const res = await app.request('/test', {
      headers: { 'x-forwarded-for': forwardedIp, 'x-real-ip': realIp },
    });
    expect(res.status).toBe(429);

    // But X-Real-IP alone (different key) is still allowed
    const res2 = await app.request('/test', {
      headers: { 'x-real-ip': realIp },
    });
    expect(res2.status).toBe(200);
  });
});
