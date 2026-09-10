import { describe, test, expect } from 'bun:test';
import { parseStartBlock, resolveBackfillStart } from '../lib/event-processor';

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
