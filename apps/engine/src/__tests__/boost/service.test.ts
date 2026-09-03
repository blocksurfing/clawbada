import { describe, test, expect, mock } from 'bun:test';
import { mockDbTables } from './fake-db';

// ── Mock @clawbada/db ──
mock.module('@clawbada/db', () => ({
  ...mockDbTables(),
  applyIdleDecay: mock(() => Promise.resolve(true)),
  getBoostEpochAnchorMs: mock(() => Promise.resolve(0)),
}));

// ── Import after mocks ──
import { BoostEpochService } from '../../boost/service';
import { EpochClock } from '../../boost/epoch-clock';
import { ANCHOR_MS, DAY_MS, Scenario, epochRow } from './scenario';

function serviceFor(s: Scenario, clockFactory: () => Promise<EpochClock> = () => Promise.resolve(s.clock)) {
  return new BoostEpochService({
    db: s.fake.db,
    chain: { currentBoostEpoch: async () => s.chainEpoch },
    clockFactory,
    now: () => s.now,
    log: s.log,
  });
}

describe('BoostEpochService', () => {
  test('runOnce raises the overdue alarm when the newest activation is older than 8 days', async () => {
    const s = new Scenario();
    s.now = new Date(ANCHOR_MS + 20 * DAY_MS); // window 2
    s.epochRows.push(epochRow(0, { status: 'activated', activatedAt: new Date(ANCHOR_MS + 7 * DAY_MS) }));
    s.epochRows.push(epochRow(1, { status: 'activated', activatedAt: new Date(s.now.getTime() - 9 * DAY_MS) }));

    const service = serviceFor(s);
    expect(await service.runOnce()).toBe(true);

    expect(s.logged('boost_epoch_clock_ready')).toHaveLength(1);
    expect(s.logged('boost_epoch_overdue')).toHaveLength(1);
    expect(s.logged('boost_epoch_overdue')[0].level).toBe('error');
    // The regular tick work still happened around the alarm.
    expect(s.epochRows.map((r) => r.epochId)).toEqual([0, 1, 2, 3]);
  });

  test('a missing anchor is a warning, retried on the next tick, then cached', async () => {
    const s = new Scenario();
    s.now = new Date(ANCHOR_MS + DAY_MS);
    let calls = 0;
    const factory = () => {
      calls++;
      return calls === 1 ? Promise.reject(new Error('Boost epoch anchor unavailable')) : Promise.resolve(s.clock);
    };
    const service = serviceFor(s, factory);

    expect(await service.runOnce()).toBe(false);
    expect(s.logged('boost_epoch_anchor_unavailable')).toHaveLength(1);
    expect(s.logged('boost_epoch_anchor_unavailable')[0].level).toBe('warn');
    expect(s.fake.queries).toHaveLength(0);

    expect(await service.runOnce()).toBe(true);
    expect(await service.runOnce()).toBe(true);
    expect(calls).toBe(2);
    expect(s.row(0).status).toBe('active');
  });

  test('a throwing tick is logged, never propagated, and does not wedge the service', async () => {
    const s = new Scenario();
    s.now = new Date(ANCHOR_MS + DAY_MS);
    const service = serviceFor(s, () => Promise.resolve(s.clock));
    s.fake.db.select = () => {
      throw new Error('db down');
    };

    expect(await service.runOnce()).toBe(false);
    expect(s.logged('boost_epoch_tick_failed')).toHaveLength(1);
    expect(s.logged('boost_epoch_tick_failed')[0].level).toBe('error');
    expect(await service.runOnce()).toBe(false);
    expect(s.logged('boost_epoch_tick_failed')).toHaveLength(2);
  });

  test('overlapping ticks are skipped', async () => {
    const s = new Scenario();
    let release: (c: EpochClock) => void = () => {};
    const service = serviceFor(s, () => new Promise<EpochClock>((resolve) => (release = resolve)));

    const first = service.runOnce();
    expect(await service.runOnce()).toBe(false);
    release(s.clock);
    expect(await first).toBe(true);
  });

  test('start runs immediately and stop is idempotent', async () => {
    const s = new Scenario();
    s.now = new Date(ANCHOR_MS + DAY_MS);
    let calls = 0;
    const service = serviceFor(s, () => {
      calls++;
      return Promise.resolve(s.clock);
    });
    service.start(60_000);
    service.start(60_000); // duplicate start is a warning, not a second timer
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(1);
    expect(s.logged('boost_epoch_service_started')).toHaveLength(1);
    expect(s.logged('boost_epoch_service_already_started')).toHaveLength(1);
    service.stop();
    service.stop();
    expect(s.logged('boost_epoch_service_stopped')).toHaveLength(1);
  });
});
