import { describe, test, expect } from 'bun:test';
import { serializeBigInts } from '../lib/chain';

describe('serializeBigInts', () => {
  test('converts bigint to string', () => {
    expect(serializeBigInts(123n)).toBe('123');
  });

  test('converts zero bigint to "0"', () => {
    expect(serializeBigInts(0n)).toBe('0');
  });

  test('converts very large bigint to string', () => {
    const big = 2n ** 256n - 1n;
    expect(serializeBigInts(big)).toBe(big.toString());
  });

  test('passes number through unchanged', () => {
    expect(serializeBigInts(42)).toBe(42);
  });

  test('passes string through unchanged', () => {
    expect(serializeBigInts('hello')).toBe('hello');
  });

  test('passes boolean through unchanged', () => {
    expect(serializeBigInts(true)).toBe(true);
    expect(serializeBigInts(false)).toBe(false);
  });

  test('passes null through unchanged', () => {
    expect(serializeBigInts(null)).toBeNull();
  });

  test('passes undefined through unchanged', () => {
    expect(serializeBigInts(undefined)).toBeUndefined();
  });

  test('recursively converts nested objects', () => {
    const input = {
      id: 1n,
      name: 'lobster',
      nested: {
        dna: 999n,
        flag: true,
      },
    };
    const result = serializeBigInts(input);
    expect(result).toEqual({
      id: '1',
      name: 'lobster',
      nested: {
        dna: '999',
        flag: true,
      },
    });
  });

  test('handles arrays with bigints', () => {
    const input = [1n, 2n, 3n];
    const result = serializeBigInts(input);
    expect(result).toEqual(['1', '2', '3']);
  });

  test('handles mixed nested objects and arrays', () => {
    const input = {
      teams: [
        { teamId: 10n, lobsters: [100n, 200n, 300n] },
        { teamId: 20n, lobsters: [400n, 500n, 600n] },
      ],
      season: 1n,
      meta: { active: true, label: 'test' },
    };
    const result = serializeBigInts(input);
    expect(result).toEqual({
      teams: [
        { teamId: '10', lobsters: ['100', '200', '300'] },
        { teamId: '20', lobsters: ['400', '500', '600'] },
      ],
      season: '1',
      meta: { active: true, label: 'test' },
    });
  });

  test('empty object returns empty object', () => {
    expect(serializeBigInts({})).toEqual({});
  });

  test('empty array returns empty array', () => {
    expect(serializeBigInts([])).toEqual([]);
  });

  test('handles objects with null and undefined values', () => {
    const input = { a: null, b: undefined, c: 42n };
    const result = serializeBigInts(input);
    expect(result).toEqual({ a: null, b: undefined, c: '42' });
  });

  test('handles deeply nested structures', () => {
    const input = { a: { b: { c: { d: 77n } } } };
    const result = serializeBigInts(input);
    expect(result).toEqual({ a: { b: { c: { d: '77' } } } });
  });
});
