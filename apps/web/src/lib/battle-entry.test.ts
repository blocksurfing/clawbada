import { afterEach, describe, expect, test } from 'bun:test';
import { ENTRY_FADE_MS, ENTRY_HOLD_MS, ENTRY_IRIS_CLOSE_MS, ENTRY_IRIS_OPEN_MS, ENTRY_NAVY_BEAT_MS, ENTRY_REVEALED_MS, _resetBattleEntryForTests, cancelBattleEntry, getEntryState, loopShownAt, markArenaReady, markUnityLoadingShown, startBattleEntry } from './battle-entry';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('battle entry store', () => {
  afterEach(() => _resetBattleEntryForTests());

  test('starts once with a tip and ignores a second start', () => {
    startBattleEntry({ kind: 'practice' });
    const s = getEntryState();
    expect(s.phase).toBe('web');
    expect(s.kind).toBe('practice');
    expect(typeof s.tip).toBe('string');
    startBattleEntry({ kind: 'battle' });
    expect(getEntryState().kind).toBe('practice');
  });

  test('cancel drops it at once', () => {
    startBattleEntry({ kind: 'practice' });
    cancelBattleEntry();
    expect(getEntryState().phase).toBe('idle');
  });

  test('a release signal before the hold waits for the hold', async () => {
    startBattleEntry({ kind: 'practice' });
    markUnityLoadingShown();
    expect(getEntryState().phase).toBe('web');
    expect(getEntryState().unityShown).toBe(true);
    // Still held well before the hold ends.
    await sleep(50);
    expect(getEntryState().phase).toBe('web');
  });

  test('arena-ready alone waits the grace; a later loadingShown overrides it', async () => {
    startBattleEntry({ kind: 'practice' });
    markArenaReady();
    expect(getEntryState().phase).toBe('web');
    markUnityLoadingShown();
    expect(getEntryState().unityShown).toBe(true);
  });

  test('constants: the Shifu hold is 6 s; the way in is slower than the way out', () => {
    expect(ENTRY_HOLD_MS).toBe(6000);
    expect(ENTRY_IRIS_CLOSE_MS + ENTRY_NAVY_BEAT_MS + ENTRY_IRIS_OPEN_MS).toBe(ENTRY_REVEALED_MS);
    expect(ENTRY_REVEALED_MS).toBeGreaterThanOrEqual(2300);   // owner 2026-10-27: about 2.5 s press → Shifu
    expect(ENTRY_REVEALED_MS).toBeLessThanOrEqual(2800);
  });

  test('the hold counts from the loop (after the curtain), not from the press', () => {
    startBattleEntry({ kind: 'practice' });
    const { startedAt } = getEntryState();
    expect(loopShownAt()).toBe(startedAt + ENTRY_IRIS_CLOSE_MS + ENTRY_NAVY_BEAT_MS);   // no window here → no reduced-motion shortcut
  });
});
