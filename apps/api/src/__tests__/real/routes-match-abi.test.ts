/**
 * Every `buildCalldata(address, SomeAbi, 'functionName', …)` in the API must name a function the
 * contract actually has.
 *
 * Function names reach the encoder as plain strings and every route test stubs the encoder, so
 * nothing else can catch drift. It already happened: the breeding route encoded `breed`, which
 * BreedingLab does not have (it has requestBreed + finalizeBreed), so the real endpoint answered
 * 500 and breeding through the app never worked — with a green test suite.
 *
 * This folder runs in its own process (`test:real`) against the REAL @clawbada/chain.
 */
import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as chain from '@clawbada/chain';

const SRC = join(import.meta.dir, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : sourceFiles(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

// buildCalldata(<address expr>, <Name>Abi [as any], '<function>'
const CALL = /buildCalldata\(\s*[^,]+,\s*(\w+Abi)(?:\s+as\s+\w+)?\s*,\s*'(\w+)'/g;

describe('API calldata matches the contracts', () => {
  const calls = sourceFiles(SRC).flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return [...text.matchAll(CALL)].map((m) => ({ file: file.slice(SRC.length + 1), abi: m[1], fn: m[2] }));
  });

  test('the scan finds the routes (guards against the regex silently matching nothing)', () => {
    expect(calls.length).toBeGreaterThan(15);
    expect(calls.some((c) => c.abi === 'BreedingLabAbi' && c.fn === 'requestBreed')).toBe(true);
  });

  test('every encoded function exists in its ABI', () => {
    const missing = calls.filter(({ abi, fn }) => {
      const def = (chain as Record<string, unknown>)[abi] as readonly { type: string; name?: string }[] | undefined;
      return !def || !def.some((item) => item.type === 'function' && item.name === fn);
    });
    expect(missing.map((c) => `${c.file}: ${c.abi}.${c.fn}`)).toEqual([]);
  });
});
