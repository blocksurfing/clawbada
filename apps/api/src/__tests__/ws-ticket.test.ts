import { describe, test, expect } from 'bun:test';
import { WsTicketStore, WS_TICKET_TTL_MS } from '../lib/ws-ticket';
import { ApiError } from '../lib/errors';
import { allowedWsOrigins, wsOriginAllowed } from '../lib/ws-origin';

const GRANT = { checksumAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', guest: true, authExpiresAt: 2_000_000_000, battleId: 'f_x' };

function codeOf(fn: () => unknown): string | null {
  try { fn(); return null; } catch (e) { return e instanceof ApiError ? e.code : 'other'; }
}

describe('WS tickets', () => {
  test('a ticket opens its battle once and carries the caller', () => {
    const store = new WsTicketStore();
    const { ticket, expiresInMs } = store.issue(GRANT);
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(expiresInMs).toBe(WS_TICKET_TTL_MS);
    expect(store.consume(ticket, 'f_x')).toEqual(GRANT);
    expect(codeOf(() => store.consume(ticket, 'f_x'))).toBe('UNAUTHORIZED');   // single use
  });

  test('expires after 30 seconds', () => {
    let now = 1_000;
    const store = new WsTicketStore(() => now);
    const { ticket } = store.issue(GRANT);
    now += WS_TICKET_TTL_MS;
    expect(codeOf(() => store.consume(ticket, 'f_x'))).toBe('UNAUTHORIZED');
  });

  test('bound to its battle, and spent even when the battle does not match', () => {
    const store = new WsTicketStore();
    const { ticket } = store.issue(GRANT);
    expect(codeOf(() => store.consume(ticket, 'f_other'))).toBe('UNAUTHORIZED');
    expect(codeOf(() => store.consume(ticket, 'f_x'))).toBe('UNAUTHORIZED');
    const { ticket: queue } = store.issue({ ...GRANT, battleId: null });
    expect(codeOf(() => store.consume(queue, 'f_x'))).toBe('UNAUTHORIZED');
  });

  test('an unknown ticket is refused; sweep drops expired ones', () => {
    let now = 0;
    const store = new WsTicketStore(() => now);
    expect(codeOf(() => store.consume('nope', null))).toBe('UNAUTHORIZED');
    store.issue(GRANT);
    store.issue(GRANT);
    now += WS_TICKET_TTL_MS + 1;
    store.sweep();
    expect(store.size).toBe(0);
  });
});

describe('WS origin allowlist', () => {
  const prod = allowedWsOrigins({ NODE_ENV: 'production', AUTH_DOMAINS: 'clawbada-web.vercel.app' });

  test('the game\'s own sites and its previews are allowed', () => {
    expect(wsOriginAllowed('https://clawbada-web.vercel.app', prod)).toBe(true);
    expect(wsOriginAllowed('https://docs.clawbada.com', prod)).toBe(true);
    expect(wsOriginAllowed('https://clawbada-web-a1b2c3-blocksurfing-5487s-projects.vercel.app', prod)).toBe(true);
  });

  test('no Origin (an agent or script) is judged by its credentials alone', () => {
    expect(wsOriginAllowed(null, prod)).toBe(true);
  });

  test('other sites, look-alikes and wildcard escapes are refused', () => {
    expect(wsOriginAllowed('https://evil.example', prod)).toBe(false);
    expect(wsOriginAllowed('http://clawbada-web.vercel.app', prod)).toBe(false);
    expect(wsOriginAllowed('https://clawbada-web.vercel.app.evil.example', prod)).toBe(false);
    expect(wsOriginAllowed('https://clawbada-web-x.evil.com-blocksurfing-5487s-projects.vercel.app', prod)).toBe(false);
    expect(wsOriginAllowed('null', prod)).toBe(false);
    expect(wsOriginAllowed('http://localhost:3000', prod)).toBe(false);
  });

  test('localhost outside production; WS_ALLOWED_ORIGINS replaces the defaults', () => {
    expect(wsOriginAllowed('http://localhost:3000', allowedWsOrigins({ NODE_ENV: 'development' }))).toBe(true);
    const custom = allowedWsOrigins({ WS_ALLOWED_ORIGINS: 'https://play.example' });
    expect(custom).toEqual(['https://play.example']);
    expect(wsOriginAllowed('https://clawbada-web.vercel.app', custom)).toBe(false);
  });
});
