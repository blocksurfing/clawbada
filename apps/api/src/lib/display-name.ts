import { ApiError } from './errors';

/** The longest display name the wallet panel shows (Nzib's plank fits about that at 21 px Upheaval). */
export const DISPLAY_NAME_MAX = 20;
/** The longest raw input looked at: room for the name (a character is at most two UTF-16 units) and stray padding. */
const RAW_MAX = 256;

/**
 * A player's display name (PATCH /api/agent/profile): trimmed, 1–20 characters, printable — no control or
 * format characters, so a name cannot smuggle line breaks or direction overrides into the UI. `null`,
 * `undefined` and an empty/blank string all mean "clear it". Anything else is a 400.
 */
export function validateDisplayName(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw new ApiError('INVALID_INPUT', 'displayName must be a string or null');
  // Before the string is trimmed and walked character by character: nothing this long can be a name.
  if (raw.length > RAW_MAX) throw new ApiError('INVALID_INPUT', `displayName is longer than ${DISPLAY_NAME_MAX} characters`);
  const name = raw.trim();
  if (name.length === 0) return null;
  if ([...name].length > DISPLAY_NAME_MAX) throw new ApiError('INVALID_INPUT', `displayName is longer than ${DISPLAY_NAME_MAX} characters`);
  if (/[\p{Cc}\p{Cf}]/u.test(name)) throw new ApiError('INVALID_INPUT', 'displayName contains control characters');
  return name;
}
