import { afterEach, describe, expect, test } from 'bun:test';
import { ENTRY_HOLD_MS, _resetBattleEntryForTests, cancelBattleEntry, getEntryState, markArenaReady, markUnityLoadingShown, startBattleEntry } from './battle-entry';

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
    // Still held well before 4.5 s.
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

  test('constants: the hold is the spec\'s 4.5 s', () => {
    expect(ENTRY_HOLD_MS).toBe(4500);
  });
});
