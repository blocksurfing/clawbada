import { describe, test, expect, afterEach } from 'bun:test';
import { purgeOnce, retentionDaysFromEnv, startRetentionTicker, stopRetentionTicker, DEFAULT_RETENTION_DAYS, type RetentionStore } from '../../lib/retention';

const DAY = 86_400_000;
const NOW = new Date('2026-11-11T12:00:00Z');

/** A store holding `sessions` old battles (three turns each) and `rooms` old rooms; records every cutoff it is asked for. */
function fakeStore(sessions: number, rooms: number) {
  const asked: Date[] = [];
  const calls = { sessions: 0, rooms: 0 };
  const store: RetentionStore = {
    async purgeSessions(olderThan, limit) {
      asked.push(olderThan);
      calls.sessions++;
      const n = Math.min(limit, sessions);
      sessions -= n;
      return { sessions: n, turns: n * 3 };
    },
    async purgeRooms(olderThan, limit) {
      asked.push(olderThan);
      calls.rooms++;
      const n = Math.min(limit, rooms);
      rooms -= n;
      return n;
    },
  };
  return { store, asked, calls, left: () => ({ sessions, rooms }) };
}
const noPause = async () => {};

describe('retentionDaysFromEnv', () => {
  test('30 days unless told otherwise', () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(30);
    expect(retentionDaysFromEnv({})).toBe(30);
    expect(retentionDaysFromEnv({ OFFCHAIN_RETENTION_DAYS: '' })).toBe(30);
    expect(retentionDaysFromEnv({ OFFCHAIN_RETENTION_DAYS: '7' })).toBe(7);
    expect(retentionDaysFromEnv({ OFFCHAIN_RETENTION_DAYS: ' 90 ' })).toBe(90);
  });

  test('0 or "off" switches it off', () => {
    expect(retentionDaysFromEnv({ OFFCHAIN_RETENTION_DAYS: '0' })).toBe(0);
    expect(retentionDaysFromEnv({ OFFCHAIN_RETENTION_DAYS: 'off' })).toBe(0);
    expect(retentionDaysFromEnv({ OFFCHAIN_RETENTION_DAYS: 'OFF' })).toBe(0);
  });

  test('a value that is not a whole number of days falls back to 30 — a typo never means "delete sooner"', () => {
    for (const bad of ['-1', '1.5', 'thirty', '1e2x', 'NaN']) expect(retentionDaysFromEnv({ OFFCHAIN_RETENTION_DAYS: bad })).toBe(30);
  });
});

describe('purgeOnce', () => {
  test('the cutoff is `days` before now, for battles and rooms alike', async () => {
    const { store, asked } = fakeStore(1, 1);
    await purgeOnce(store, { days: 30, now: NOW, pause: noPause });
    expect(asked.length).toBe(2);
    for (const d of asked) expect(d.getTime()).toBe(NOW.getTime() - 30 * DAY);
  });

  test('switched off: the store is never asked', async () => {
    const { store, calls } = fakeStore(5, 5);
    expect(await purgeOnce(store, { days: 0, now: NOW, pause: noPause })).toEqual({ sessions: 0, turns: 0, rooms: 0, capped: false });
    expect(calls).toEqual({ sessions: 0, rooms: 0 });
  });

  test('nothing old: one look at each table and done', async () => {
    const { store, calls } = fakeStore(0, 0);
    expect(await purgeOnce(store, { days: 30, now: NOW, pause: noPause })).toEqual({ sessions: 0, turns: 0, rooms: 0, capped: false });
    expect(calls).toEqual({ sessions: 1, rooms: 1 });
  });

  test('works through a backlog in batches and stops at the first short batch', async () => {
    const { store, calls, left } = fakeStore(25, 12);
    let pauses = 0;
    const pass = await purgeOnce(store, { days: 30, now: NOW, batch: 10, maxBatches: 20, pause: async () => { pauses++; } });
    expect(pass).toEqual({ sessions: 25, turns: 75, rooms: 12, capped: false });
    expect(calls).toEqual({ sessions: 3, rooms: 2 });   // 10 + 10 + 5, then 10 + 2
    expect(pauses).toBe(3);                              // only between full batches
    expect(left()).toEqual({ sessions: 0, rooms: 0 });
  });

  test('stops at the cap and says so; the rest waits for the next pass', async () => {
    const { store, left } = fakeStore(100, 100);
    const first = await purgeOnce(store, { days: 30, now: NOW, batch: 10, maxBatches: 3, pause: noPause });
    expect(first).toEqual({ sessions: 30, turns: 90, rooms: 30, capped: true });
    expect(left()).toEqual({ sessions: 70, rooms: 70 });
  });

  test('a backlog of exactly one batch is not reported as capped', async () => {
    const { store } = fakeStore(10, 0);
    expect((await purgeOnce(store, { days: 30, now: NOW, batch: 10, maxBatches: 3, pause: noPause })).capped).toBe(false);
  });

  test('asked to stop: the pass ends before its next batch and does not claim to be capped', async () => {
    const { store, calls, left } = fakeStore(100, 100);
    let batches = 0;
    const pass = await purgeOnce(store, { days: 30, now: NOW, batch: 10, maxBatches: 20, pause: noPause, stopped: () => ++batches > 2 });
    expect(pass).toEqual({ sessions: 20, turns: 60, rooms: 0, capped: false });
    expect(calls).toEqual({ sessions: 2, rooms: 0 });
    expect(left()).toEqual({ sessions: 80, rooms: 100 });
  });

  test('a failing store fails the pass (the ticker logs it and tries again later)', async () => {
    const store: RetentionStore = { purgeSessions: async () => { throw new Error('db down'); }, purgeRooms: async () => 0 };
    await expect(purgeOnce(store, { days: 30, now: NOW, pause: noPause })).rejects.toThrow('db down');
  });
});

describe('the ticker', () => {
  afterEach(() => stopRetentionTicker());

  test('switched off: starting it arms nothing', async () => {
    const { store, calls } = fakeStore(5, 5);
    startRetentionTicker(store, 0);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual({ sessions: 0, rooms: 0 });
  });

  test('starting it does not delete anything at boot, and stop disarms it', async () => {
    const { store, calls } = fakeStore(5, 5);
    startRetentionTicker(store, 30);
    startRetentionTicker(store, 30);   // idempotent
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual({ sessions: 0, rooms: 0 });
    stopRetentionTicker();
  });
});
