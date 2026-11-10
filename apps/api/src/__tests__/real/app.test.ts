/**
 * The HTTP app as assembled (src/app.ts). What is under test is the ORDER of what stands in front of the handlers:
 * the request ceiling, CORS, the closed chain-era routes, and the body limit the server is started with.
 *
 * This folder runs in its own process (`test:real`) with nothing mocked. No database and no chain are touched: only
 * requests that are answered before either would be are sent.
 */
import { describe, test, expect, afterAll } from 'bun:test';

// Read at import time by the modules under test — set first, import after.
process.env.WS_ALLOWED_ORIGINS = 'https://clawbada.com,https://docs.clawbada.com';
process.env.LOG_LEVEL = 'silent';
process.env.AUTH_SESSION_SECRET = 'test-secret-at-least-32-characters-long!!';
delete process.env.CHAIN_ROUTES;
delete process.env.LOBSTER_NFT_ADDRESS;
const { app, GLOBAL_REQUESTS_PER_MIN } = await import('../../app');
const { MAX_REQUEST_BODY_BYTES } = await import('../../lib/server-limits');
const { CHAIN_ROUTES_CLOSED_MESSAGE } = await import('../../lib/chain-gate');

const GAME = 'https://clawbada.com';
const ELSEWHERE = 'https://evil.example';
/** The env index.ts passes to the app: Bun's server, which is where the client IP comes from. One IP per test, so
 *  the per-IP limiters never carry over from one test to the next. */
let nextIp = 1;
const fromFreshIp = () => {
  const address = `192.0.2.${nextIp++}`;
  return { server: { requestIP: () => ({ address }) } };
};
const ALLOWED_HEADERS = 'Content-Type,Accept,Authorization,X-Wallet-Address,X-Signature,X-Timestamp,X-Nonce,X-Auth-Domain';

describe('CORS: only the game\'s own pages may use the API from a browser', () => {
  test('a request from the game gets its origin back', async () => {
    const res = await app.request('/health', { headers: { origin: GAME } }, fromFreshIp());
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(GAME);
  });

  test('a request from another site is answered, but without permission for that page to read it', async () => {
    const res = await app.request('/health', { headers: { origin: ELSEWHERE } }, fromFreshIp());
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('an agent or script (no Origin) is unaffected', async () => {
    const res = await app.request('/api/auth/guest', { method: 'POST' }, fromFreshIp());
    expect(res.status).toBe(200);
    expect((await res.json() as { guest: boolean }).guest).toBe(true);
  });

  test('a preflight from the game lists the headers a page may send — never what the request asked for', async () => {
    const res = await app.request('/api/auth/guest', {
      method: 'OPTIONS',
      headers: { origin: GAME, 'access-control-request-method': 'POST', 'access-control-request-headers': `authorization, x-evil,${' '.repeat(12_000)}x-more` },
    }, fromFreshIp());
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(GAME);
    expect(res.headers.get('access-control-allow-headers')).toBe(ALLOWED_HEADERS);
    expect(res.headers.get('access-control-max-age')).toBe('600');
  });

  test('a preflight from another site gets no permission', async () => {
    const res = await app.request('/api/auth/guest', { method: 'OPTIONS', headers: { origin: ELSEWHERE, 'access-control-request-method': 'POST' } }, fromFreshIp());
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('the request ceiling comes before everything else', () => {
  test(`one IP gets ${GLOBAL_REQUESTS_PER_MIN} requests a minute on any path and method — preflights and unknown paths included`, async () => {
    const env = fromFreshIp();
    const preflight = { method: 'OPTIONS', headers: { origin: GAME, 'access-control-request-method': 'POST' } };
    for (let i = 0; i < GLOBAL_REQUESTS_PER_MIN; i++) {
      const res = await app.request(i % 2 ? '/api/auth/guest' : '/not-a-route', preflight, env);
      if (res.status !== 204) throw new Error(`request ${i + 1} answered ${res.status}`);
    }
    expect((await app.request('/api/auth/guest', preflight, env)).status).toBe(429);
    expect((await app.request('/health', {}, env)).status).toBe(429);
    expect((await app.request('/not-a-route', {}, env)).status).toBe(429);
    // Someone else is not affected.
    expect((await app.request('/health', {}, fromFreshIp())).status).toBe(200);
  });
});

describe('the chain-era routes are closed until the contracts are configured', () => {
  const CLOSED = [
    ['GET', '/api/game/teams?address=0x0000000000000000000000000000000000000001'],
    ['GET', '/api/game/teams/1'],
    ['POST', '/api/game/teams/create'],
    ['GET', '/api/game/mining/budget'],
    ['POST', '/api/game/mining/start'],
    ['GET', '/api/game/market/listings'],
    ['GET', '/api/game/breeding/preview?parentA=1&parentB=2'],
    ['GET', '/api/game/breeding/lineage/1'],
    ['GET', '/api/game/evolution/cost/1'],
    ['GET', '/api/game/repair/cost/1'],
    ['GET', '/api/game/boost/epoch'],
    ['GET', '/api/faucet/status/0x0000000000000000000000000000000000000001'],
    ['POST', '/api/faucet/claim-gold'],
  ] as const;

  test.each(CLOSED)('%s %s answers 404 before authentication or a body is looked at', async (method, path) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{not json' : undefined }, fromFreshIp());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_FOUND', message: CHAIN_ROUTES_CLOSED_MESSAGE });
  });

  test('CHAIN_ROUTES=on opens them: the same request now reaches authentication', async () => {
    process.env.CHAIN_ROUTES = 'on';
    try {
      const res = await app.request('/api/game/teams/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, fromFreshIp());
      expect(res.status).toBe(401);
    } finally {
      delete process.env.CHAIN_ROUTES;
    }
  });

  test('the Dojo is not behind the gate: practice and friend rooms reach authentication, guest sessions are minted', async () => {
    for (const path of ['/api/game/combat/practice', '/api/game/friend/rooms']) {
      const res = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, fromFreshIp());
      expect(res.status).toBe(401);
    }
    expect((await app.request('/api/auth/guest', { method: 'POST' }, fromFreshIp())).status).toBe(200);
    expect((await app.request('/api/auth/params', {}, fromFreshIp())).status).toBe(200);
  });
});

describe('the body limit the server is started with (index.ts: maxRequestBodySize)', () => {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', maxRequestBodySize: MAX_REQUEST_BODY_BYTES, fetch: (req, srv) => app.fetch(req, { server: srv }) });
  afterAll(() => server.stop(true));
  const url = (path: string) => `http://127.0.0.1:${server.port}${path}`;

  test('a small body reaches the route', async () => {
    const res = await fetch(url('/api/auth/ws-ticket'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(401);   // no session: the route's own answer
  });

  test('a body over the limit is refused with 413 and never reaches the route', async () => {
    const res = await fetch(url('/api/auth/ws-ticket'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'a'.repeat(MAX_REQUEST_BODY_BYTES + 1) });
    expect(res.status).toBe(413);
  });

  test('the limit is 64 KB', () => {
    expect(MAX_REQUEST_BODY_BYTES).toBe(64 * 1024);
  });
});
