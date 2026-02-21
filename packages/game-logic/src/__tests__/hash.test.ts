import { describe, test, expect } from 'bun:test';
import {
  keccak256Packed,
  deriveRandom,
  randomInRange,
  randomBool,
  deriveVrfRoll,
} from '../hash';

// ──────────── keccak256Packed ────────────

describe('keccak256Packed', () => {
  test('determinism: same inputs produce same output', () => {
    const a = keccak256Packed(42n, 'hello');
    const b = keccak256Packed(42n, 'hello');
    expect(a).toBe(b);
  });

  test('different inputs produce different outputs', () => {
    const a = keccak256Packed(42n, 'hello');
    const b = keccak256Packed(43n, 'hello');
    expect(a).not.toBe(b);
  });

  test('different salt produces different output', () => {
    const a = keccak256Packed(42n, 'hello');
    const b = keccak256Packed(42n, 'world');
    expect(a).not.toBe(b);
  });

  test('returns a bigint', () => {
    const result = keccak256Packed(1n);
    expect(typeof result).toBe('bigint');
  });

  test('result fits in uint256 (< 2^256)', () => {
    const result = keccak256Packed(999n, 'test');
    expect(result).toBeGreaterThanOrEqual(0n);
    expect(result).toBeLessThan(1n << 256n);
  });

  test('works with bigint argument', () => {
    const result = keccak256Packed(123456789012345678901234567890n);
    expect(typeof result).toBe('bigint');
    expect(result).toBeGreaterThan(0n);
  });

  test('works with number argument', () => {
    const result = keccak256Packed(42);
    expect(typeof result).toBe('bigint');
    expect(result).toBeGreaterThan(0n);
  });

  test('works with string argument', () => {
    const result = keccak256Packed('hello');
    expect(typeof result).toBe('bigint');
    expect(result).toBeGreaterThan(0n);
  });

  test('works with Uint8Array argument', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const result = keccak256Packed(bytes);
    expect(typeof result).toBe('bigint');
    expect(result).toBeGreaterThan(0n);
  });

  test('works with mixed types', () => {
    const result = keccak256Packed(1n, 42, 'salt', new Uint8Array([0xff]));
    expect(typeof result).toBe('bigint');
    expect(result).toBeGreaterThan(0n);
  });

  test('number and equivalent bigint produce the same result', () => {
    // Both number 42 and bigint 42n are encoded as 32-byte big-endian uint256
    const fromNumber = keccak256Packed(42);
    const fromBigint = keccak256Packed(42n);
    expect(fromNumber).toBe(fromBigint);
  });

  test('order of arguments matters', () => {
    const a = keccak256Packed(1n, 2n);
    const b = keccak256Packed(2n, 1n);
    expect(a).not.toBe(b);
  });
});

// ──────────── deriveRandom ────────────

describe('deriveRandom', () => {
  test('equals keccak256Packed(seed, salt)', () => {
    const seed = 12345n;
    const salt = 'test_salt';
    const derived = deriveRandom(seed, salt);
    const direct = keccak256Packed(seed, salt);
    expect(derived).toBe(direct);
  });

  test('is deterministic', () => {
    const a = deriveRandom(100n, 'foo');
    const b = deriveRandom(100n, 'foo');
    expect(a).toBe(b);
  });

  test('different seeds produce different results', () => {
    const a = deriveRandom(1n, 'salt');
    const b = deriveRandom(2n, 'salt');
    expect(a).not.toBe(b);
  });

  test('different salts produce different results', () => {
    const a = deriveRandom(1n, 'alpha');
    const b = deriveRandom(1n, 'beta');
    expect(a).not.toBe(b);
  });
});

// ──────────── randomInRange ────────────

describe('randomInRange', () => {
  test('stays within [min, max] over 1000 iterations', () => {
    const min = 10n;
    const max = 20n;
    for (let i = 0; i < 1000; i++) {
      const seed = BigInt(i * 7 + 13);
      const result = randomInRange(seed, `iter_${i}`, min, max);
      expect(result).toBeGreaterThanOrEqual(min);
      expect(result).toBeLessThanOrEqual(max);
    }
  });

  test('min = max returns min', () => {
    const result = randomInRange(42n, 'test', 5n, 5n);
    expect(result).toBe(5n);
  });

  test('min > max throws', () => {
    expect(() => randomInRange(42n, 'test', 10n, 5n)).toThrow('min');
  });

  test('range of 1 (min+1 = max)', () => {
    const result = randomInRange(42n, 'test', 100n, 101n);
    expect(result === 100n || result === 101n).toBe(true);
  });

  test('large range still works', () => {
    const min = 0n;
    const max = (1n << 128n) - 1n;
    const result = randomInRange(42n, 'big', min, max);
    expect(result).toBeGreaterThanOrEqual(min);
    expect(result).toBeLessThanOrEqual(max);
  });

  test('is deterministic', () => {
    const a = randomInRange(42n, 'salt', 1n, 100n);
    const b = randomInRange(42n, 'salt', 1n, 100n);
    expect(a).toBe(b);
  });
});

// ──────────── randomBool ────────────

describe('randomBool', () => {
  test('chance = 0 always returns false', () => {
    for (let i = 0; i < 100; i++) {
      expect(randomBool(BigInt(i), `test_${i}`, 0n, 10000n)).toBe(false);
    }
  });

  test('chance >= outOf always returns true', () => {
    for (let i = 0; i < 100; i++) {
      expect(randomBool(BigInt(i), `test_${i}`, 10000n, 10000n)).toBe(true);
    }
  });

  test('chance > outOf always returns true', () => {
    for (let i = 0; i < 100; i++) {
      expect(randomBool(BigInt(i), `test_${i}`, 15000n, 10000n)).toBe(true);
    }
  });

  test('~50% for chance = outOf/2 over 10000 trials (tolerance +/-5%)', () => {
    let trueCount = 0;
    const trials = 10000;
    for (let i = 0; i < trials; i++) {
      if (randomBool(BigInt(i), `trial_${i}`, 5000n, 10000n)) {
        trueCount++;
      }
    }
    const ratio = trueCount / trials;
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.55);
  });

  test('~10% for chance=1000 outOf=10000 over 10000 trials (tolerance +/-5%)', () => {
    let trueCount = 0;
    const trials = 10000;
    for (let i = 0; i < trials; i++) {
      if (randomBool(BigInt(i), `trial10_${i}`, 1000n, 10000n)) {
        trueCount++;
      }
    }
    const ratio = trueCount / trials;
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.15);
  });

  test('is deterministic', () => {
    const a = randomBool(42n, 'salt', 5000n, 10000n);
    const b = randomBool(42n, 'salt', 5000n, 10000n);
    expect(a).toBe(b);
  });

  test('negative chance returns false', () => {
    expect(randomBool(42n, 'test', -1n, 10000n)).toBe(false);
  });
});

// ──────────── deriveVrfRoll ────────────

describe('deriveVrfRoll', () => {
  test('always in [850, 1150] over 1000 iterations', () => {
    for (let i = 0; i < 1000; i++) {
      const seed = BigInt(i * 31 + 7);
      const roll = deriveVrfRoll(seed, `round_${i}`);
      expect(roll).toBeGreaterThanOrEqual(850n);
      expect(roll).toBeLessThanOrEqual(1150n);
    }
  });

  test('is deterministic', () => {
    const a = deriveVrfRoll(42n, 'test');
    const b = deriveVrfRoll(42n, 'test');
    expect(a).toBe(b);
  });

  test('different seeds produce different rolls', () => {
    const a = deriveVrfRoll(1n, 'test');
    const b = deriveVrfRoll(2n, 'test');
    // Could theoretically collide, but extremely unlikely
    expect(a).not.toBe(b);
  });

  test('produces a variety of values (not stuck at one value)', () => {
    const values = new Set<bigint>();
    for (let i = 0; i < 100; i++) {
      values.add(deriveVrfRoll(BigInt(i), 'variety'));
    }
    // Should have significant variety in 100 samples across a 301-value range
    expect(values.size).toBeGreaterThan(50);
  });
});
