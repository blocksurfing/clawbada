import { describe, test, expect, mock } from 'bun:test';
import { mockDbTables } from './fake-db';

const ANCHOR_MS = Date.UTC(2026, 8, 7);
const mockGetAnchor = mock(() => Promise.resolve(ANCHOR_MS));

mock.module('@clawbada/db', () => ({
  ...mockDbTables(),
  applyIdleDecay: mock(() => Promise.resolve(true)),
  getBoostEpochAnchorMs: mockGetAnchor,
}));

import { BOOST_EPOCH_MS } from '@clawbada/game-logic';
import { EpochClock } from '../../boost/epoch-clock';

describe('EpochClock', () => {
  test('fromDb resolves the anchor through getBoostEpochAnchorMs', async () => {
    const clock = await EpochClock.fromDb({} as never);
    expect(mockGetAnchor).toHaveBeenCalledTimes(1);
    expect(clock.anchorMs).toBe(ANCHOR_MS);
  });

  test('epochIdAt / current / windowOf wrap the weekly grid', () => {
    const clock = new EpochClock(ANCHOR_MS);
    expect(clock.current(ANCHOR_MS)).toBe(0);
    expect(clock.current(new Date(ANCHOR_MS + BOOST_EPOCH_MS - 1))).toBe(0);
    expect(clock.current(ANCHOR_MS + BOOST_EPOCH_MS)).toBe(1);
    expect(clock.epochIdAt(ANCHOR_MS - 1)).toBe(-1);
    expect(clock.epochIdAt(new Date(ANCHOR_MS + 10 * BOOST_EPOCH_MS + 5))).toBe(10);

    const w = clock.windowOf(3);
    expect(w.startsAt.getTime()).toBe(ANCHOR_MS + 3 * BOOST_EPOCH_MS);
    expect(w.endsAt.getTime()).toBe(ANCHOR_MS + 4 * BOOST_EPOCH_MS);
    expect(clock.epochIdAt(w.startsAt)).toBe(3);
    expect(clock.epochIdAt(w.endsAt)).toBe(4);
  });

  test('rejects a non-finite anchor', () => {
    expect(() => new EpochClock(Number.NaN)).toThrow();
  });
});
