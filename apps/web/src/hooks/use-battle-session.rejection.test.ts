import { describe, test, expect } from 'bun:test';
import { isWalletRejection, FIRST_CONNECT_ATTEMPTS } from './use-battle-session';

describe('isWalletRejection', () => {
  test('the shapes a refused wallet prompt takes', () => {
    expect(isWalletRejection({ code: 4001, message: 'whatever' })).toBe(true);
    expect(isWalletRejection(Object.assign(new Error('x'), { name: 'UserRejectedRequestError' }))).toBe(true);
    expect(isWalletRejection(new Error('User rejected the request.'))).toBe(true);
    expect(isWalletRejection(new Error('MetaMask Tx Signature: User denied message signature.'))).toBe(true);
  });

  test('a rejection wrapped in another error is still one', () => {
    const inner = Object.assign(new Error('nope'), { code: 4001 });
    expect(isWalletRejection(new Error('Could not sign in', { cause: new Error('signing failed', { cause: inner }) }))).toBe(true);
  });

  test('ordinary failures are not: they are retried', () => {
    expect(isWalletRejection(new Error('Failed to fetch'))).toBe(false);
    expect(isWalletRejection(new Error('Rate limit exceeded: 60 requests per 60s'))).toBe(false);
    expect(isWalletRejection(null)).toBe(false);
    expect(isWalletRejection('User rejected')).toBe(false);   // not an error object
  });

  test('a battle that was never reached is given up on after eight attempts', () => {
    expect(FIRST_CONNECT_ATTEMPTS).toBe(8);
  });
});
