import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { roleKey } from '../client';

const NAMES = ['OPERATOR_PRIVATE_KEY', 'MATCHMAKER_PRIVATE_KEY', 'RESOLVER_PRIVATE_KEY', 'BOOST_ADMIN_PRIVATE_KEY'] as const;
const K = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

describe('roleKey (audit 2026-09 D-26)', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const n of NAMES) {
      saved[n] = process.env[n];
      delete process.env[n];
    }
  });
  afterEach(() => {
    for (const n of NAMES) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  });

  test('a role key of its own is used on every network', () => {
    process.env.OPERATOR_PRIVATE_KEY = K(1);
    process.env.RESOLVER_PRIVATE_KEY = K(3);
    expect(roleKey('RESOLVER_PRIVATE_KEY', true)).toBe(K(3));
    expect(roleKey('RESOLVER_PRIVATE_KEY', false)).toBe(K(3));
  });

  test('off mainnet an unset role key falls back to the operator key', () => {
    process.env.OPERATOR_PRIVATE_KEY = K(1);
    process.env.MATCHMAKER_PRIVATE_KEY = '0x'; // the .env.example placeholder
    expect(roleKey('MATCHMAKER_PRIVATE_KEY', true)).toBe(K(1));
    expect(roleKey('BOOST_ADMIN_PRIVATE_KEY', true)).toBe(K(1));
  });

  test('on mainnet there is no fallback: one compromise must not yield two roles', () => {
    process.env.OPERATOR_PRIVATE_KEY = K(1);
    for (const name of ['MATCHMAKER_PRIVATE_KEY', 'RESOLVER_PRIVATE_KEY', 'BOOST_ADMIN_PRIVATE_KEY'] as const) {
      expect(() => roleKey(name, false)).toThrow(`${name} not set. On mainnet every hot role needs its own key`);
    }
  });

  test('nothing set at all is still an error off mainnet', () => {
    expect(() => roleKey('RESOLVER_PRIVATE_KEY', true)).toThrow('RESOLVER_PRIVATE_KEY (or OPERATOR_PRIVATE_KEY fallback) not set');
  });
});
