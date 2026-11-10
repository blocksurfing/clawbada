import { ApiError } from './errors';

/** A uint256 has at most 78 decimal digits. */
const UINT_RE = /^\d{1,78}$/;

/**
 * An on-chain id (token, team, listing, battle…) from a path, a query or a JSON body, as a bigint.
 *
 * Use this instead of a bare `BigInt(input)`: that throws a SyntaxError on anything that is not a number — a 500
 * instead of a 400 — and it accepts hex, whitespace and strings of any length. Checking first also means every
 * id is known to be good before any read is started with one of them.
 */
export function parseUint(raw: unknown, name: string): bigint {
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) return BigInt(raw);
  if (typeof raw === 'string' && UINT_RE.test(raw)) return BigInt(raw);
  throw new ApiError('INVALID_INPUT', `${name} must be a non-negative whole number`);
}

/** The largest value a Postgres `bigint` column holds. */
const INT64_MAX = 9_223_372_036_854_775_807n;

/** An id that is looked up in a Postgres `bigint` column: `parseUint`, and small enough for the column — a larger
 *  number cannot be a row, and would otherwise reach the database as an out-of-range error. */
export function parseDbId(raw: unknown, name: string): bigint {
  const id = parseUint(raw, name);
  if (id > INT64_MAX) throw new ApiError('INVALID_INPUT', `${name} is out of range`);
  return id;
}
