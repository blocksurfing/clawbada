import { describe, test, expect } from 'bun:test';
import { renderRoutesOpen } from '../../lib/render-gate';

describe('renderRoutesOpen', () => {
  test('closed until switched on', () => {
    expect(renderRoutesOpen({})).toBe(false);
    expect(renderRoutesOpen({ LOBSTER_RENDER_ENABLED: '' })).toBe(false);
    expect(renderRoutesOpen({ LOBSTER_RENDER_ENABLED: 'false' })).toBe(false);
    expect(renderRoutesOpen({ LOBSTER_RENDER_ENABLED: 'true' })).toBe(true);
  });

  test('only the word `true` opens it', () => {
    for (const value of ['1', 'on', 'yes', 'TRUE']) expect(renderRoutesOpen({ LOBSTER_RENDER_ENABLED: value })).toBe(false);
  });
});
