import { describe, expect, test } from 'bun:test';
import { ARENA_MUSIC } from './arena-music.generated';
import { pickArenaTrack } from './arena-music';

describe('pickArenaTrack', () => {
  test('a single-track tier always plays that track', () => {
    expect(pickArenaTrack('evolved', 'p_abc')).toBe(ARENA_MUSIC.evolved[0]);
  });
  test('the Dojo has two tracks, and the same battle always gets the same one', () => {
    expect(ARENA_MUSIC.dojo.length).toBe(2);
    const a = pickArenaTrack('dojo', 'p_123');
    expect(ARENA_MUSIC.dojo).toContain(a!);
    expect(pickArenaTrack('dojo', 'p_123')).toBe(a);
  });
  test('across many battles both Dojo tracks come up, roughly evenly', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 400; i++) { const t = pickArenaTrack('dojo', `p_${i.toString(36)}_${i * 7919}`)!; counts.set(t, (counts.get(t) ?? 0) + 1); }
    expect(counts.size).toBe(2);
    for (const n of counts.values()) expect(n).toBeGreaterThan(120);
  });
});
