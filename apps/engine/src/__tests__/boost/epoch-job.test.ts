import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { mockDbTables } from './fake-db';

// ── Mock @clawbada/db ──
//
// The job reaches the database only through the injected `db` (the fake chain in
// ./fake-db) plus two module-level imports: the table objects and `applyIdleDecay`.
// EpochClock.fromDb also needs getBoostEpochAnchorMs.
const mockApplyIdleDecay = mock((..._args: unknown[]) => Promise.resolve(true));
const mockGetAnchor = mock(() => Promise.resolve(0));

mock.module('@clawbada/db', () => ({
  ...mockDbTables(),
  applyIdleDecay: mockApplyIdleDecay,
  getBoostEpochAnchorMs: mockGetAnchor,
}));

// ── Import after mocks ──
import { floorPlayedForEpoch, idleDecay, rankQualified, BOOST_ENTRIES_PER_TX } from '@clawbada/game-logic';
import {
  activateEpoch,
  checkOverdue,
  computeEpoch,
  ensureAnnounced,
  runEpochJob,
  stageEpoch,
  BOOST_EPOCH_OVERDUE_MS,
} from '../../boost/epoch-job';
import { ANCHOR_MS, DAY_MS, Scenario, at, epochRow } from './scenario';

beforeEach(() => {
  mockApplyIdleDecay.mockReset();
  mockApplyIdleDecay.mockImplementation(() => Promise.resolve(true));
});

describe('ensureAnnounced', () => {
  test('creates the next window and promotes the current one without touching an existing floor', async () => {
    const s = new Scenario();
    s.now = at(1, 0.5);
    s.epochRows.push(epochRow(0, { status: 'activated', activatedAt: at(1) }));
    // Ops pre-published an override for this week: the job must leave it alone.
    s.epochRows.push(epochRow(1, { floorPlayed: 99, status: 'announced' }));

    const created = await ensureAnnounced(s.deps());

    expect(created).toEqual([2]);
    const inserts = s.fake.byTable('insert', 'boost_epochs');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].has('onConflictDoNothing')).toBe(true);
    const values = inserts[0].values as Record<string, unknown>[];
    expect(values.map((v) => v.epochId)).toEqual([2]);
    expect(values[0]).toMatchObject({ chainEpoch: 3, floorPlayed: floorPlayedForEpoch(2), status: 'announced' });
    expect(values[0].startsAt).toEqual(s.clock.windowOf(2).startsAt);
    expect(values[0].endsAt).toEqual(s.clock.windowOf(2).endsAt);

    // Current row promoted; floor untouched; no update ever carries a floor.
    expect(s.row(1).status).toBe('active');
    expect(s.row(1).floorPlayed).toBe(99);
    for (const u of s.fake.byTable('update', 'boost_epochs')) expect(u.set).not.toHaveProperty('floorPlayed');
    expect(s.logged('boost_epoch_announced')).toHaveLength(1);
    expect(s.logged('boost_epoch_backfill')).toHaveLength(0);
  });

  test('is a no-op when both rows already exist', async () => {
    const s = new Scenario();
    s.now = at(3, 0.2);
    for (let e = 0; e <= 4; e++) s.epochRows.push(epochRow(e, { status: e < 3 ? 'activated' : e === 3 ? 'active' : 'announced' }));
    const created = await ensureAnnounced(s.deps());
    expect(created).toEqual([]);
    expect(s.fake.byTable('insert', 'boost_epochs')).toHaveLength(0);
  });

  test('backfills every window since launch when the engine slept through boundaries', async () => {
    const s = new Scenario();
    s.now = at(3, 0.1);
    const created = await ensureAnnounced(s.deps());
    expect(created).toEqual([0, 1, 2, 3, 4]);
    expect(s.epochRows.map((r) => [r.epochId, r.chainEpoch, r.status])).toEqual([
      [0, 1, 'announced'],
      [1, 2, 'announced'],
      [2, 3, 'announced'],
      [3, 4, 'active'],
      [4, 5, 'announced'],
    ]);
    expect(s.logged('boost_epoch_backfill')).toHaveLength(1);
    expect(s.logged('boost_epoch_backfill')[0].obj).toMatchObject({ count: 5, from: 0, to: 4 });
  });

  test('announces window 0 during the week before launch and nothing earlier', async () => {
    const s = new Scenario();
    s.now = new Date(ANCHOR_MS - DAY_MS);
    expect(await ensureAnnounced(s.deps())).toEqual([0]);
    expect(s.row(0).status).toBe('announced');

    const early = new Scenario();
    early.now = new Date(ANCHOR_MS - 8 * DAY_MS);
    expect(await ensureAnnounced(early.deps())).toEqual([]);
    expect(early.fake.queries).toHaveLength(0);
  });
});

describe('computeEpoch', () => {
  test('ranks qualified teams, decays the rest, writes the ladder once (idempotent)', async () => {
    const s = new Scenario();
    s.epochId = 4;
    s.now = at(5);
    s.epochRows.push(epochRow(4)); // floor 14 from window 4 on
    expect(s.row(4).floorPlayed).toBe(14);
    s.team(1n, 1300, 20);
    s.team(2n, 1200, 14);
    s.team(3n, 1250, 3);
    s.team(4n, 1100, 0);

    const first = await computeEpoch(s.deps(), 4);
    expect(first).toMatchObject({ status: 'computed', ratedCount: 4, qualifiedCount: 2, lapsedCount: 0, batches: 1, avgBoostBps: 3000 });

    // Idle decay for the two non-qualifiers only, once each, with the pure function's value.
    expect(mockApplyIdleDecay).toHaveBeenCalledTimes(2);
    expect(mockApplyIdleDecay.mock.calls.map((c) => c.slice(1))).toEqual([
      [3n, 4, 1250, idleDecay(1250)],
      [4n, 4, 1100, idleDecay(1100)],
    ]);

    // Ladder rows for chain epoch 5, ordered top-down, matching the pure ranker.
    const expected = rankQualified([
      { teamId: 1n, rating: 1300 },
      { teamId: 2n, rating: 1200 },
    ]);
    expect(s.insertedBoosts).toHaveLength(2);
    expect(s.insertedBoosts[0]).toMatchObject({
      epochId: 5,
      teamId: 1n,
      earnedEpochId: 4,
      rating: 1300,
      rank: 1,
      percentile: expected[0].percentile.toFixed(6),
      boostBps: 5000,
      power: 5,
      gamesPlayed: 20,
      batchIndex: 0,
    });
    expect(s.insertedBoosts[1]).toMatchObject({ teamId: 2n, rank: 2, boostBps: 1000, gamesPlayed: 14, batchIndex: 0 });
    expect(s.fake.byTable('insert', 'team_boosts')[0].has('onConflictDoNothing')).toBe(true);

    expect(s.row(4)).toMatchObject({ status: 'computed', ratedCount: 4, qualifiedCount: 2, lapsedCount: 0, avgBoostBps: 3000 });
    expect(s.row(4).flags).toEqual({ repeatedPairs: [], sameOwnerPairs: [], playedCacheMismatches: [] });
    expect(s.logged('boost_epoch_computed')).toHaveLength(1);
    expect(s.logged('played_cache_mismatch')).toHaveLength(0);

    // Second run: the row is already computed → nothing else happens.
    const second = await computeEpoch(s.deps(), 4);
    expect(second.status).toBe('skipped');
    expect(mockApplyIdleDecay).toHaveBeenCalledTimes(2);
    expect(s.fake.byTable('insert', 'team_boosts')).toHaveLength(1);
    expect(s.logged('boost_epoch_computed')).toHaveLength(1);
  });

  test('450 qualified teams → 3 batches of 200/200/50 in ladder order', async () => {
    const s = new Scenario();
    s.epochId = 4;
    s.now = at(5);
    s.epochRows.push(epochRow(4));
    for (let i = 0; i < 450; i++) s.team(BigInt(i + 1), 1200 + i, 14);

    const r = await computeEpoch(s.deps(), 4);
    expect(r).toMatchObject({ status: 'computed', qualifiedCount: 450, batches: 3 });
    const byBatch = new Map<number, number>();
    for (const b of s.insertedBoosts) byBatch.set(b.batchIndex as number, (byBatch.get(b.batchIndex as number) ?? 0) + 1);
    expect([...byBatch.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 200],
      [1, 200],
      [2, 50],
    ]);
    expect(s.insertedBoosts[0]).toMatchObject({ teamId: 450n, rank: 1, batchIndex: 0 });
    expect(s.insertedBoosts[199]).toMatchObject({ rank: 200, batchIndex: 0 });
    expect(s.insertedBoosts[200]).toMatchObject({ rank: 201, batchIndex: 1 });
    expect(s.insertedBoosts[449]).toMatchObject({ teamId: 1n, rank: 450, batchIndex: 2 });
    expect(mockApplyIdleDecay).not.toHaveBeenCalled();
  });

  test('counts lapsed teams against the table that was live this window', async () => {
    const s = new Scenario();
    s.epochId = 4;
    s.now = at(5);
    s.epochRows.push(epochRow(4));
    s.previousBoosts = [1n, 2n, 3n]; // chain epoch 4 table
    s.team(2n, 1300, 14);
    s.team(3n, 1250, 14);
    s.team(4n, 1200, 14);
    // Team 1 disbanded: not in the rated join at all → lapsed.
    const r = await computeEpoch(s.deps(), 4);
    expect(r).toMatchObject({ qualifiedCount: 3, lapsedCount: 1 });
    expect(s.fake.byTable('select', 'team_boosts')[0].whereValue('team_boosts.epochId')).toBe(4);
  });

  test('flags repeated and same-owner pairs and played-cache mismatches', async () => {
    const s = new Scenario();
    s.epochId = 4;
    s.now = at(5);
    s.epochRows.push(epochRow(4));
    s.team(1n, 1300, 20, { owner: '0xsame', cachePlayed: 99 }); // cache disagrees with the ledger
    s.team(2n, 1290, 20, { owner: '0xsame' });
    s.team(3n, 1280, 20, { owner: '0xother', cacheEpochId: 3 }); // stale cache epoch with ledger rows
    s.team(4n, 1270, 20);
    s.pairs.push({ teamA: '1', teamB: '2', battles: 4 }, { teamA: '3', teamB: '4', battles: 3 });

    await computeEpoch(s.deps(), 4);

    const flags = s.row(4).flags as { repeatedPairs: unknown[]; sameOwnerPairs: unknown[]; playedCacheMismatches: unknown[] };
    expect(flags.repeatedPairs).toEqual([
      { teamA: '1', teamB: '2', battles: 4, sameOwner: true },
      { teamA: '3', teamB: '4', battles: 3, sameOwner: false },
    ]);
    expect(flags.sameOwnerPairs).toEqual([{ teamA: '1', teamB: '2', battles: 4, owner: '0xsame' }]);
    expect(flags.playedCacheMismatches).toEqual([
      { teamId: '1', cached: 99, ledger: 20 },
      { teamId: '3', cached: 0, ledger: 20 },
    ]);
    expect(s.logged('boost_win_trading_flag')).toHaveLength(2);
    expect(s.logged('played_cache_mismatch')).toHaveLength(1);
  });

  test('power outside 3..9 never qualifies; missing row is reported', async () => {
    const s = new Scenario();
    s.epochId = 4;
    s.now = at(5);
    s.epochRows.push(epochRow(4));
    s.team(1n, 1300, 20, { power: 2 });
    const r = await computeEpoch(s.deps(), 4);
    expect(r).toMatchObject({ qualifiedCount: 0, ratedCount: 1 });
    expect(mockApplyIdleDecay).toHaveBeenCalledTimes(1);

    expect((await computeEpoch(s.deps(), 7)).status).toBe('missing');
    expect(s.logged('boost_epoch_row_missing')).toHaveLength(1);
  });
});

describe('stageEpoch', () => {
  test('enqueues one set job per batch, in order, with the ladder entries', async () => {
    const s = new Scenario();
    s.epochId = 4;
    s.now = at(5);
    s.epochRows.push(epochRow(4));
    for (let i = 0; i < 450; i++) s.team(BigInt(i + 1), 1200 + i, 14);
    await computeEpoch(s.deps(), 4);
    s.chainEpoch = 4; // chain epoch 5 is the next one

    expect(await stageEpoch(s.deps(), 4)).toBe('staged');

    expect(s.jobs.map((j) => j.idempotencyKey)).toEqual(['boost:set:5:0', 'boost:set:5:1', 'boost:set:5:2']);
    expect(s.jobs.every((j) => j.jobType === 'set_team_boosts')).toBe(true);
    const payloads = s.jobs.map((j) => j.payload as { epoch: number; entries: { teamId: string; bps: number; power: number }[] });
    expect(payloads.map((p) => p.entries.length)).toEqual([200, 200, 50]);
    expect(payloads.every((p) => p.epoch === 5)).toBe(true);
    expect(payloads[0].entries[0]).toEqual({ teamId: '450', bps: 5000, power: 5 });
    expect(payloads[2].entries[49]).toEqual({ teamId: '1', bps: 1000, power: 5 });
    expect(payloads.flatMap((p) => p.entries).every((e) => e.bps <= 5000 && e.bps >= 1000)).toBe(true);
    expect(payloads.reduce((n, p) => n + p.entries.length, 0)).toBe(450);
    expect(s.fake.byTable('insert', 'operator_jobs').every((q) => q.has('onConflictDoNothing'))).toBe(true);

    expect(s.row(4)).toMatchObject({ status: 'staged', setJobIds: ['1', '2', '3'] });
    expect(s.logged('boost_epoch_staged')[0].obj).toMatchObject({ chainEpoch: 5, batches: 3, entries: 450 });

    // Re-running on a staged row does nothing, not even a chain read.
    const reads = s.chainReads;
    expect(await stageEpoch(s.deps(), 4)).toBe('skipped');
    expect(s.chainReads).toBe(reads);
    expect(s.jobs).toHaveLength(3);
  });

  test('re-run after a partial stage reuses the existing outbox rows', async () => {
    const s = new Scenario();
    s.epochId = 4;
    s.now = at(5);
    s.epochRows.push(epochRow(4));
    for (let i = 0; i < 250; i++) s.team(BigInt(i + 1), 1200 + i, 14);
    await computeEpoch(s.deps(), 4);
    s.chainEpoch = 4;
    // Pretend a previous attempt got batch 0 in before crashing (row still 'computed').
    s.jobs.push({ id: 41n, jobType: 'set_team_boosts', payload: {}, idempotencyKey: 'boost:set:5:0', status: 0, txHash: null, lastError: null });

    expect(await stageEpoch(s.deps(), 4)).toBe('staged');
    expect(s.jobs.map((j) => j.idempotencyKey)).toEqual(['boost:set:5:0', 'boost:set:5:1']);
    expect(s.row(4).setJobIds).toEqual(['41', '42']);
  });

  test('chain out of sync → failed with chain_out_of_sync', async () => {
    const s = new Scenario();
    s.now = at(5);
    s.epochRows.push(epochRow(4, { status: 'computed', qualifiedCount: 0 }));
    s.chainEpoch = 2; // expected 4

    expect(await stageEpoch(s.deps(), 4)).toBe('failed');
    expect(s.row(4).status).toBe('failed');
    expect(s.row(4).lastError).toContain('chain_out_of_sync');
    expect(s.row(4).lastError).toContain('currentBoostEpoch=2');
    expect(s.jobs).toHaveLength(0);
    expect(s.logged('boost_epoch_failed')).toHaveLength(1);
    expect(s.logged('boost_epoch_failed')[0].level).toBe('error');
  });

  test('chain already at or past this epoch → marked activated without jobs', async () => {
    const s = new Scenario();
    s.now = at(5);
    s.epochRows.push(epochRow(4, { status: 'computed', qualifiedCount: 0 }));
    s.chainEpoch = 5;

    expect(await stageEpoch(s.deps(), 4)).toBe('activated');
    expect(s.row(4)).toMatchObject({ status: 'activated', activatedAt: s.now });
    expect(s.jobs).toHaveLength(0);
    expect(s.logged('boost_epoch_already_activated')).toHaveLength(1);
  });
});

describe('activateEpoch', () => {
  test('zero qualified still stages and activates', async () => {
    const s = new Scenario();
    s.epochId = 4;
    s.now = at(5);
    s.epochRows.push(epochRow(4));
    s.team(1n, 1300, 3);
    s.team(2n, 1200, 0);

    const c = await computeEpoch(s.deps(), 4);
    expect(c).toMatchObject({ status: 'computed', qualifiedCount: 0, avgBoostBps: null, batches: 0 });
    expect(s.fake.byTable('insert', 'team_boosts')).toHaveLength(0);

    s.chainEpoch = 4;
    expect(await stageEpoch(s.deps(), 4)).toBe('staged');
    expect(s.jobs).toHaveLength(0);
    expect(s.row(4).setJobIds).toEqual([]);

    expect(await activateEpoch(s.deps(), 4)).toBe('waiting');
    expect(s.jobs).toHaveLength(1);
    expect(s.jobs[0]).toMatchObject({ jobType: 'activate_boost_epoch', idempotencyKey: 'boost:activate:5', payload: { epoch: 5 } });
    expect(s.row(4).activateJobId).toBe(1n);
    expect(s.logged('boost_epoch_activate_enqueued')).toHaveLength(1);

    // Still pending: keep waiting, do not enqueue twice.
    expect(await activateEpoch(s.deps(), 4)).toBe('waiting');
    expect(s.jobs).toHaveLength(1);

    s.jobs[0].status = 2;
    s.jobs[0].txHash = '0xactivate';
    expect(await activateEpoch(s.deps(), 4)).toBe('activated');
    expect(s.row(4)).toMatchObject({ status: 'activated', activateTxHash: '0xactivate', activatedAt: s.now, lastError: null });
    expect(s.logged('boost_epoch_activated')).toHaveLength(1);

    expect(await activateEpoch(s.deps(), 4)).toBe('skipped');
  });

  test('activation is enqueued only after every set job succeeded', async () => {
    const s = new Scenario();
    s.now = at(5);
    s.epochRows.push(epochRow(4, { status: 'staged', setJobIds: ['1', '2'] }));
    s.jobs.push(
      { id: 1n, jobType: 'set_team_boosts', payload: {}, idempotencyKey: 'boost:set:5:0', status: 2, txHash: '0xset0', lastError: null },
      { id: 2n, jobType: 'set_team_boosts', payload: {}, idempotencyKey: 'boost:set:5:1', status: 0, txHash: null, lastError: null },
    );

    expect(await activateEpoch(s.deps(), 4)).toBe('waiting');
    expect(s.jobs).toHaveLength(2);
    expect(s.row(4).activateJobId).toBeNull();
    expect(s.teamBoostUpdates).toHaveLength(0);

    s.jobs[1].status = 2;
    s.jobs[1].txHash = '0xset1';
    expect(await activateEpoch(s.deps(), 4)).toBe('waiting');
    expect(s.jobs).toHaveLength(3);
    expect(s.jobs[2].idempotencyKey).toBe('boost:activate:5');
    expect(s.row(4).activateJobId).toBe(3n);
    // Each batch's rows are stamped with the tx that posted them.
    expect(s.teamBoostUpdates.map((u) => u.set)).toEqual([{ txHash: '0xset0' }, { txHash: '0xset1' }]);
  });

  test('dead set job → failed', async () => {
    const s = new Scenario();
    s.now = at(5);
    s.epochRows.push(epochRow(4, { status: 'staged', setJobIds: ['1', '2'] }));
    s.jobs.push(
      { id: 1n, jobType: 'set_team_boosts', payload: {}, idempotencyKey: 'boost:set:5:0', status: 2, txHash: '0xset0', lastError: null },
      { id: 2n, jobType: 'set_team_boosts', payload: {}, idempotencyKey: 'boost:set:5:1', status: 3, txHash: null, lastError: 'revert:BoostTooHigh' },
    );

    expect(await activateEpoch(s.deps(), 4)).toBe('failed');
    expect(s.row(4).status).toBe('failed');
    expect(s.row(4).lastError).toContain('set_job_dead');
    expect(s.row(4).lastError).toContain('2:revert:BoostTooHigh');
    expect(s.jobs).toHaveLength(2);
  });

  test('dead or missing activate job → failed', async () => {
    const dead = new Scenario();
    dead.now = at(5);
    dead.epochRows.push(epochRow(4, { status: 'staged', setJobIds: [], activateJobId: 7n }));
    dead.jobs.push({ id: 7n, jobType: 'activate_boost_epoch', payload: {}, idempotencyKey: 'boost:activate:5', status: 3, txHash: null, lastError: 'revert:unknown' });
    expect(await activateEpoch(dead.deps(), 4)).toBe('failed');
    expect(dead.row(4).lastError).toContain('activate_job_dead');

    const missing = new Scenario();
    missing.now = at(5);
    missing.epochRows.push(epochRow(4, { status: 'staged', setJobIds: ['9'] }));
    expect(await activateEpoch(missing.deps(), 4)).toBe('failed');
    expect(missing.row(4).lastError).toContain('set_job_missing');
  });
});

describe('runEpochJob', () => {
  test('drives due windows in order and stops at the first one still in flight', async () => {
    const s = new Scenario();
    s.epochId = 5;
    s.now = at(6, 0.1);
    for (let e = 0; e <= 3; e++) s.epochRows.push(epochRow(e, { status: 'activated', activatedAt: at(e + 1) }));
    s.epochRows.push(epochRow(4, { status: 'staged', setJobIds: [] }));
    s.epochRows.push(epochRow(5));
    s.team(1n, 1300, 14);
    s.chainEpoch = 4;

    await runEpochJob(s.deps());

    // Announced the current + next window, enqueued activation for 4, left 5 untouched.
    expect(s.epochRows.map((r) => r.epochId)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(s.row(6).status).toBe('active');
    expect(s.row(7).status).toBe('announced');
    expect(s.jobs.map((j) => j.idempotencyKey)).toEqual(['boost:activate:5']);
    expect(s.row(4).status).toBe('staged');
    expect(s.row(5).status).toBe('active');
    expect(s.logged('boost_epoch_computed')).toHaveLength(0);
    // Window 4 has been sitting un-activated for over a week: the newest activation
    // (window 3, at the end of window 3) is 2.1 weeks old → the alarm fires this tick.
    expect(s.logged('boost_epoch_overdue')).toHaveLength(1);

    // The activate tx lands (chain now at 5) → next tick finishes 4 and takes 5 through
    // compute → stage; activation waits for the set job.
    s.jobs[0].status = 2;
    s.jobs[0].txHash = '0xact5';
    s.chainEpoch = 5;
    await runEpochJob(s.deps());

    expect(s.row(4)).toMatchObject({ status: 'activated', activateTxHash: '0xact5' });
    expect(s.row(5).status).toBe('staged');
    expect(s.jobs.map((j) => j.idempotencyKey)).toEqual(['boost:activate:5', 'boost:set:6:0']);
    expect(s.logged('boost_epoch_computed')).toHaveLength(1);

    // The set tx lands → next tick enqueues activation for 6 and keeps waiting.
    s.jobs[1].status = 2;
    s.jobs[1].txHash = '0xset6';
    await runEpochJob(s.deps());

    expect(s.row(5).status).toBe('staged');
    expect(s.jobs.map((j) => j.idempotencyKey)).toEqual(['boost:activate:5', 'boost:set:6:0', 'boost:activate:6']);
    expect(s.logged('boost_epoch_computed')).toHaveLength(1);
    // Cleared since window 4 activated in the second tick: still exactly one alarm.
    expect(s.logged('boost_epoch_overdue')).toHaveLength(1);
  });

  test('a failed row blocks later windows and is logged every tick', async () => {
    const s = new Scenario();
    s.now = at(6, 0.1);
    for (let e = 0; e <= 3; e++) s.epochRows.push(epochRow(e, { status: 'activated', activatedAt: at(e + 1) }));
    s.epochRows.push(epochRow(4, { status: 'failed', lastError: 'chain_out_of_sync: x' }));
    s.epochRows.push(epochRow(5));
    s.chainEpoch = 4;

    await runEpochJob(s.deps());
    await runEpochJob(s.deps());

    expect(s.row(5).status).toBe('active');
    expect(s.logged('boost_epoch_blocked')).toHaveLength(2);
    expect(s.logged('boost_epoch_blocked')[0].obj).toMatchObject({ epochId: 4, lastError: 'chain_out_of_sync: x' });
    expect(s.chainReads).toBe(0);
    expect(s.jobs).toHaveLength(0);
  });

  test('windows the chain already has are marked activated and skipped over', async () => {
    const s = new Scenario();
    s.epochId = 5;
    s.now = at(6, 0.1);
    for (let e = 0; e <= 3; e++) s.epochRows.push(epochRow(e, { status: 'activated', activatedAt: at(e + 1) }));
    s.epochRows.push(epochRow(4, { status: 'computed', qualifiedCount: 0 }));
    s.epochRows.push(epochRow(5));
    s.chainEpoch = 5; // someone activated chain epoch 5 by hand
    s.team(1n, 1300, 14);

    await runEpochJob(s.deps());

    expect(s.row(4).status).toBe('activated');
    expect(s.logged('boost_epoch_already_activated')).toHaveLength(1);
    expect(s.row(5).status).toBe('staged');
    expect(s.jobs.map((j) => j.idempotencyKey)).toEqual(['boost:set:6:0']);
    expect(s.chainReads).toBe(2);
  });

  test('a backfilled window the chain has already passed is settled without a tx', async () => {
    // Engine slept from window 1 to window 4 while the chain was driven by hand to 3.
    const s = new Scenario();
    s.now = at(4, 0.1);
    s.epochRows.push(epochRow(0, { status: 'activated', activatedAt: at(1) }));
    s.chainEpoch = 3;

    await runEpochJob(s.deps());

    expect(s.epochRows.map((r) => [r.epochId, r.status])).toEqual([
      [0, 'activated'],
      [1, 'activated'],
      [2, 'activated'],
      [3, 'staged'],
      [4, 'active'],
      [5, 'announced'],
    ]);
    expect(s.jobs.map((j) => j.idempotencyKey)).toEqual(['boost:activate:4']);
  });
});

describe('checkOverdue', () => {
  test('alarms when the newest activation is older than 8 days', async () => {
    const s = new Scenario();
    s.now = new Date(ANCHOR_MS + 20 * DAY_MS);
    s.epochRows.push(epochRow(0, { status: 'activated', activatedAt: new Date(s.now.getTime() - 9 * DAY_MS) }));
    expect(await checkOverdue(s.deps())).toBe(true);
    expect(s.logged('boost_epoch_overdue')).toHaveLength(1);
    expect(s.logged('boost_epoch_overdue')[0].level).toBe('error');
    expect(s.logged('boost_epoch_overdue')[0].obj).toMatchObject({ lastActivatedEpochId: 0, ttlDays: 10 });

    s.row(0).activatedAt = new Date(s.now.getTime() - BOOST_EPOCH_OVERDUE_MS);
    expect(await checkOverdue(s.deps())).toBe(false);
  });

  test('measures from the anchor when nothing has been activated yet', async () => {
    const s = new Scenario();
    s.now = new Date(ANCHOR_MS + 9 * DAY_MS);
    expect(await checkOverdue(s.deps())).toBe(true);
    s.now = new Date(ANCHOR_MS + 7 * DAY_MS);
    expect(await checkOverdue(s.deps())).toBe(false);
    s.now = new Date(ANCHOR_MS - 30 * DAY_MS);
    expect(await checkOverdue(s.deps())).toBe(false);
  });
});
