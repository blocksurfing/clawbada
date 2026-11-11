import { describe, test, expect } from 'bun:test';
import nextConfig, { SECURITY_HEADERS } from '../../next.config';

const value = (key: string) => SECURITY_HEADERS.find((h) => h.key === key)?.value;

describe('security headers (next.config.ts)', () => {
  test('no other site may frame the game — both spellings', () => {
    expect(value('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(value('X-Frame-Options')).toBe('DENY');
  });

  test('content types are not sniffed, and other sites learn the origin only', () => {
    expect(value('X-Content-Type-Options')).toBe('nosniff');
    expect(value('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  test('scripts are not restricted yet, and wallet pop-ups keep their opener', () => {
    const csp = value('Content-Security-Policy') ?? '';
    expect(csp).not.toMatch(/script-src|default-src/);
    expect(SECURITY_HEADERS.some((h) => h.key === 'Cross-Origin-Opener-Policy')).toBe(false);
  });

  test('they apply to every path, and the invite page still sends no referrer at all', async () => {
    const rules = await nextConfig.headers!();
    expect(rules[0]).toEqual({ source: '/:path*', headers: SECURITY_HEADERS });
    const invite = rules.findIndex((r) => r.source === '/battle-friends/:path*');
    expect(invite).toBeGreaterThan(0);   // after the general rule, so its Referrer-Policy wins there
    expect(rules[invite].headers).toEqual([{ key: 'Referrer-Policy', value: 'no-referrer' }]);
  });
});
