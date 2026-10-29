import { afterEach, describe, expect, test } from 'bun:test';
import { EXIT_IRIS_CLOSE_MS, EXIT_NAVY_BEAT_MS, _resetBattleExitForTests, getExitState, openBattleExit, startBattleExit } from './battle-exit';

// The way out of a battle (owner 2026-10-29): the 1.5 s Looney Tunes zoom-out, navy while the page switches, then open.
describe('battle exit', () => {
  afterEach(() => _resetBattleExitForTests());

  test('the zoom-out takes 1.5 s; the battle may close once the navy beat has passed', async () => {
    expect(EXIT_IRIS_CLOSE_MS).toBe(1500);
    const t0 = Date.now();
    const done = startBattleExit();
    expect(getExitState().phase).toBe('closing');
    await done;
    expect(Date.now() - t0).toBeGreaterThanOrEqual(EXIT_IRIS_CLOSE_MS + EXIT_NAVY_BEAT_MS - 5);
    expect(getExitState().phase).toBe('closed');
  });

  test('opens only from closed, and a second start while running changes nothing', async () => {
    const done = startBattleExit();
    openBattleExit();
    expect(getExitState().phase).toBe('closing');   // too early: still closing
    const again = startBattleExit();
    await again;                                     // resolves at once, no restart
    expect(getExitState().phase).toBe('closing');
    await done;
    openBattleExit();
    expect(getExitState().phase).toBe('opening');
  });
});
