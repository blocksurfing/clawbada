import { describe, test, expect } from 'bun:test';
import { parseUint, parseDbId } from '../../lib/parse-uint';
import { ApiError } from '../../lib/errors';

describe('parseUint', () => {
  test('accepts decimal strings and safe whole numbers', () => {
    expect(parseUint('0', 'id')).toBe(0n);
    expect(parseUint('42', 'id')).toBe(42n);
    expect(parseUint(7, 'id')).toBe(7n);
    // The largest uint256 is 78 digits long.
    const max = (2n ** 256n - 1n).toString();
    expect(max.length).toBe(78);
    expect(parseUint(max, 'id')).toBe(2n ** 256n - 1n);
  });

  test.each([
    ['x'], [''], [' 1'], ['1 '], ['0x10'], ['-1'], ['1.5'], ['1e3'], ['١٢'], ['9'.repeat(79)],
    [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1], [NaN], [Infinity],
    [null], [undefined], [true], [{}], [['1']], [1n],
  ])('refuses %p with INVALID_INPUT', (raw) => {
    let caught: unknown;
    try {
      parseUint(raw, 'tokenId');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe('INVALID_INPUT');
    expect((caught as ApiError).message).toContain('tokenId');
  });
});

describe('parseDbId', () => {
  test('an id that fits a Postgres bigint column', () => {
    expect(parseDbId('1', 'battleId')).toBe(1n);
    expect(parseDbId('9223372036854775807', 'battleId')).toBe(9223372036854775807n);
  });

  test('refuses what cannot be a row: too large for the column, or not a number at all', () => {
    for (const raw of ['9223372036854775808', '9'.repeat(40), 'abc', '-1']) {
      expect(() => parseDbId(raw, 'battleId')).toThrow(ApiError);
    }
  });
});
