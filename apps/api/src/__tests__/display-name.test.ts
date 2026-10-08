import { describe, test, expect } from 'bun:test';
import { validateDisplayName, DISPLAY_NAME_MAX } from '../lib/display-name';
import { ApiError } from '../lib/errors';

/** The rules behind PATCH /api/agent/profile (the wallet panel's Profile dialog, 2026-10-08). */
describe('validateDisplayName', () => {
  test('accepts a plain name, trimmed', () => {
    expect(validateDisplayName('Captain Claw')).toBe('Captain Claw');
    expect(validateDisplayName('  Nzib  ')).toBe('Nzib');
  });

  test('null, undefined and blank strings clear the name', () => {
    expect(validateDisplayName(null)).toBeNull();
    expect(validateDisplayName(undefined)).toBeNull();
    expect(validateDisplayName('')).toBeNull();
    expect(validateDisplayName('   ')).toBeNull();
  });

  test(`allows exactly ${DISPLAY_NAME_MAX} characters, counted as code points`, () => {
    const max = 'x'.repeat(DISPLAY_NAME_MAX);
    expect(validateDisplayName(max)).toBe(max);
    const emoji = '🦞'.repeat(DISPLAY_NAME_MAX);
    expect(validateDisplayName(emoji)).toBe(emoji);
  });

  test('rejects names over the limit with a 400', () => {
    const tooLong = 'x'.repeat(DISPLAY_NAME_MAX + 1);
    expect(() => validateDisplayName(tooLong)).toThrow(ApiError);
    try { validateDisplayName(tooLong); } catch (e) { expect((e as ApiError).status).toBe(400); expect((e as ApiError).code).toBe('INVALID_INPUT'); }
  });

  test('rejects control and format characters', () => {
    expect(() => validateDisplayName('a\nb')).toThrow(ApiError);
    expect(() => validateDisplayName('a\u0000b')).toThrow(ApiError);
    expect(() => validateDisplayName('a‮b')).toThrow(ApiError); // right-to-left override
    expect(() => validateDisplayName('a​b')).toThrow(ApiError); // zero-width space
  });

  test('rejects non-strings', () => {
    expect(() => validateDisplayName(42)).toThrow(ApiError);
    expect(() => validateDisplayName({ name: 'x' })).toThrow(ApiError);
  });
});
