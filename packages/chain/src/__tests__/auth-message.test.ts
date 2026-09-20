import { describe, test, expect } from 'bun:test';
import { buildAuthMessage, newAuthNonce, authUriFor, AUTH_NONCE_RE, AUTH_STATEMENT, AUTH_TTL_SEC } from '../auth-message';

const ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

describe('EIP-4361 login message (C-01)', () => {
  // The API rebuilds this text to verify a signature, so its exact bytes are a wire format.
  test('the exact text is pinned', () => {
    expect(buildAuthMessage({ domain: 'clawbada-web.vercel.app', address: ADDRESS, chainId: 8453, nonce: 'a1b2c3d4e5f60718', issuedAt: 1_700_000_000 })).toBe(
      [
        'clawbada-web.vercel.app wants you to sign in with your Ethereum account:',
        ADDRESS,
        '',
        AUTH_STATEMENT,
        '',
        'URI: https://clawbada-web.vercel.app',
        'Version: 1',
        'Chain ID: 8453',
        'Nonce: a1b2c3d4e5f60718',
        'Issued At: 2023-11-14T22:13:20.000Z',
        'Expiration Time: 2023-11-14T22:18:20.000Z',
      ].join('\n'),
    );
    expect(AUTH_TTL_SEC).toBe(300);
  });

  test('the address is always written checksummed, whatever case the caller used', () => {
    const lower = buildAuthMessage({ domain: 'localhost:3000', address: ADDRESS.toLowerCase(), chainId: 84532, nonce: 'abcdefgh', issuedAt: 1 });
    expect(lower).toContain(`\n${ADDRESS}\n`);
  });

  test('the URI follows from the domain: http only for localhost', () => {
    expect(authUriFor('localhost:3000')).toBe('http://localhost:3000');
    expect(authUriFor('127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(authUriFor('play.clawbada.com')).toBe('https://play.clawbada.com');
    expect(authUriFor('localhost.evil.example')).toBe('https://localhost.evil.example');
  });

  test('a domain must be a bare host[:port] — nothing that could smuggle a second line or a path', () => {
    const base = { address: ADDRESS, chainId: 8453, nonce: 'abcdefgh', issuedAt: 1 };
    for (const domain of ['https://clawbada-web.vercel.app', 'clawbada.com/evil', 'a b', 'clawbada.com\nURI: https://evil', 'user@clawbada.com', '']) {
      expect(() => buildAuthMessage({ ...base, domain })).toThrow();
    }
  });

  test('nonces: generated ones are valid and differ; malformed ones are rejected', () => {
    const a = newAuthNonce(); const b = newAuthNonce();
    expect(AUTH_NONCE_RE.test(a)).toBe(true);
    expect(a).not.toBe(b);
    const base = { domain: 'localhost:3000', address: ADDRESS, chainId: 8453, issuedAt: 1 };
    for (const nonce of ['short', 'with space 123', 'new\nline1234']) expect(() => buildAuthMessage({ ...base, nonce })).toThrow();
  });
});
