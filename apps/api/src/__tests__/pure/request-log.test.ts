import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
// Deep import: the package's index exports the middleware factory only.
import { requestBindings, MAX_LOGGED_CHARS } from '@clawbada/logger/src/hono-middleware';

/** What the request log would record for a request. */
async function logged(path: string, headers: Record<string, string>): Promise<{ url: string; method: string; headers: Record<string, string> }> {
  let out: any;
  const app = new Hono();
  app.all('*', (c) => { out = requestBindings(c).req; return c.text('ok'); });
  await app.request(path, { headers });
  return out;
}

describe('request log bindings', () => {
  test('keeps the path (never the query) and the allow-listed headers', async () => {
    const req = await logged('/api/x?signature=0xsecret', { 'user-agent': 'probe', authorization: 'Bearer token', origin: 'https://clawbada.com' });
    expect(req.url).toBe('/api/x');
    expect(req.headers).toEqual({ 'user-agent': 'probe', origin: 'https://clawbada.com' });
  });

  test('clips a long path and long header values: the caller does not choose the size of a log line', async () => {
    const req = await logged(`/${'a'.repeat(5_000)}`, { 'user-agent': 'u'.repeat(9_000) });
    expect(req.url.length).toBe(MAX_LOGGED_CHARS + 1);            // + the ellipsis
    expect(req.url.endsWith('…')).toBe(true);
    expect(req.headers['user-agent'].length).toBe(MAX_LOGGED_CHARS + 1);
  });
});
