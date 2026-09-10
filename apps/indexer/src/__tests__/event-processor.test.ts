import { describe, test, expect } from 'bun:test';
import { parseStartBlock, resolveBackfillStart, serializeEventArgs } from '../lib/event-processor';

describe('parseStartBlock', () => {
  test('unset, blank or non-numeric → null', () => {
    expect(parseStartBlock(undefined)).toBeNull();
    expect(parseStartBlock('')).toBeNull();
    expect(parseStartBlock('  ')).toBeNull();
    expect(parseStartBlock('abc')).toBeNull();
    expect(parseStartBlock('-5')).toBeNull();
  });
  test('non-negative integers parse as bigint', () => {
    expect(parseStartBlock('0')).toBe(0n);
    expect(parseStartBlock(' 12345 ')).toBe(12345n);
  });
});

describe('resolveBackfillStart', () => {
  test('a stored last block resumes from the next block regardless of the configured start', () => {
    expect(resolveBackfillStart(100n, 0n, 250n)).toBe(101n);
    expect(resolveBackfillStart(100n, null, 250n)).toBe(101n);
  });
  test('cold start uses INDEXER_START_BLOCK (block 0 included)', () => {
    expect(resolveBackfillStart(0n, 0n, 250n)).toBe(0n);
    expect(resolveBackfillStart(0n, 40n, 250n)).toBe(40n);
  });
  test('cold start without a configured start → no backfill', () => {
    expect(resolveBackfillStart(0n, null, 250n)).toBeNull();
  });
  test('nothing to backfill when already at or past the head', () => {
    expect(resolveBackfillStart(250n, null, 250n)).toBeNull();
    expect(resolveBackfillStart(0n, 300n, 250n)).toBeNull();
  });
});

describe('serializeEventArgs', () => {
  test('bigints (uint args) become decimal strings, nested included; other values untouched', () => {
    const out = serializeEventArgs({ battleId: 42n, playerA: '0xabc', powerA: 3, tokenIds: [1n, 2n], nested: { reward: 10n ** 18n } }) as any;
    expect(out).toEqual({ battleId: '42', playerA: '0xabc', powerA: 3, tokenIds: ['1', '2'], nested: { reward: '1000000000000000000' } });
    expect(serializeEventArgs(undefined)).toEqual({});
  });
});
