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

// buildCalldata(<address expr>, <Name>Abi [as any], '<function>'[, [<args literal>]]
const CALL = /buildCalldata\(\s*[^,]+,\s*(\w+Abi)(?:\s+as\s+\w+)?\s*,\s*'(\w+)'(?:\s*,\s*\[([^\]]*)\])?/g;

/** Top-level elements of an array literal's body (nested call parentheses are kept whole). */
function countArgs(body: string | undefined): number | null {
  if (body === undefined) return 0; // buildCalldata's default `args = []`
  const trimmed = body.trim();
  if (trimmed === '') return 0;
  if (trimmed.startsWith('...')) return null; // spread — cannot count statically
  let depth = 0;
  let n = 1;
  for (const ch of trimmed) {
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) n++;
  }
  return n;
}

describe('API calldata matches the contracts', () => {
  const calls = sourceFiles(SRC).flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return [...text.matchAll(CALL)].map((m) => ({ file: file.slice(SRC.length + 1), abi: m[1], fn: m[2], argc: countArgs(m[3]) }));
  });

  test('every encoded call passes as many arguments as the function takes', () => {
    // viem's encodeFunctionData throws on a length mismatch, and the route tests stub it: the
    // market buy route passed `[listingId]` to `buyLobster(listingId, maxPrice)` for weeks with a
    // green suite (2026-10-15).
    const wrong = calls
      .filter((c) => c.argc !== null)
      .filter(({ abi, fn, argc }) => {
        const def = (chain as Record<string, unknown>)[abi] as readonly { type: string; name?: string; inputs?: unknown[] }[] | undefined;
        const item = def?.find((d) => d.type === 'function' && d.name === fn);
        return !!item && (item.inputs?.length ?? 0) !== argc;
      });
    expect(wrong.map((c) => `${c.file}: ${c.abi}.${c.fn} passes ${c.argc} args`)).toEqual([]);
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
