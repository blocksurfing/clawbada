/**
 * DB-backed verification of the boost server layer against a REAL Postgres
 * (migrations 0000..0005 applied). Exercises the drizzle SQL the unit tests mock:
 * lineage resolution, participation ledger, rating outcome (FOR UPDATE + idempotency),
 * idle decay (partial unique index), and the engine epoch job end to end
 * (announce -> compute -> stage -> activate) with a stubbed chain read and a
 * simulated operator worker.
 *
 * Run (against a throwaway Postgres with migrations applied; WIPES the boost tables):
 *   DATABASE_URL=... BOOST_EPOCH_ANCHOR_TS=<unix secs, 8+ days ago> bun run verify:boost
 */
import { eq, sql, inArray, and } from 'drizzle-orm';
import {
  db,
  teams,
  lobsters,
  battles,
  teamRatings,
  battleParticipation,
  ratingEvents,
  boostEpochs,
  teamBoosts,
  operatorJobs,
  ensureTeamRating,
  recordParticipation,
  applyBattleOutcome,
  resetBoostEpochAnchorCache,
  getBoostEpochAnchorMs,
} from '../src/index';
import { EpochClock } from '../../../apps/engine/src/boost/epoch-clock';
import {
  ensureAnnounced,
  computeEpoch,
  stageEpoch,
  activateEpoch,
  runEpochJob,
  checkOverdue,
} from '../../../apps/engine/src/boost/epoch-job';

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail !== undefined ? ' -> ' + JSON.stringify(detail, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) : ''}`);
  }
}

const A = '0x000000000000000000000000000000000000aaaa';
const B = '0x000000000000000000000000000000000000bbbb';
const lob = (i: number) => BigInt(1000 + i);
const T = (i: number) => BigInt(i);

async function reset() {
  for (const t of [ratingEvents, battleParticipation, teamBoosts, boostEpochs, operatorJobs, teamRatings, battles, teams, lobsters]) {
    await db.delete(t);
  }
}

async function seed() {
  const rows = [];
  for (let i = 1; i <= 9; i++) {
    rows.push({ tokenId: lob(i), owner: i <= 3 || i >= 7 ? A : B, dna: '0', class: 0, evolutionTier: 1, damage: 0 } as any);
  }
  await db.insert(lobsters).values(rows);
  await db.insert(teams).values([
    { teamId: T(1), owner: A, lobster0: lob(1), lobster1: lob(2), lobster2: lob(3), active: false },
    { teamId: T(2), owner: B, lobster0: lob(4), lobster1: lob(5), lobster2: lob(6), active: false },
  ]);
}

async function main() {
  resetBoostEpochAnchorCache();
  const anchorMs = await getBoostEpochAnchorMs(db);
  const clock = new EpochClock(anchorMs);
  console.log(`anchor=${new Date(anchorMs).toISOString()} currentWindow=${clock.current()}`);
  check('anchor puts us in window 1 (window 0 has ended)', clock.current() === 1, clock.current());

  await reset();
  await seed();

  console.log('\n[1] ensureTeamRating: fresh rows');
  const r1 = await ensureTeamRating(db, { teamId: T(1), owner: A, lobsterIds: [lob(1), lob(2), lob(3)], power: 3, epochId: 0 });
  const r2 = await ensureTeamRating(db, { teamId: T(2), owner: B, lobsterIds: [lob(4), lob(5), lob(6)], power: 3, epochId: 0 });
  check('T1 created at 1200', r1.created && r1.rating === 1200, r1);
  check('T2 created at 1200', r2.created && r2.rating === 1200, r2);
  const again = await ensureTeamRating(db, { teamId: T(1), owner: A, lobsterIds: [lob(1), lob(2), lob(3)], power: 3, epochId: 0 });
  check('second ensure is a no-op', !again.created && !again.reset, again);

  console.log('\n[2] lineage across disband + recreate');
  await db.update(teamRatings).set({ rating: 1500 }).where(eq(teamRatings.teamId, T(1)));
  await db.update(teams).set({ disbandedAt: new Date(), active: false }).where(eq(teams.teamId, T(1)));
  await db.insert(teams).values({ teamId: T(3), owner: A, lobster0: lob(1), lobster1: lob(2), lobster2: lob(7), active: false });
  const r3 = await ensureTeamRating(db, { teamId: T(3), owner: A, lobsterIds: [lob(1), lob(2), lob(7)], power: 3, epochId: 0 });
  check('T3 inherits from T1 with 2 shared -> regress 1/3 of 300 -> 1400', r3.created && r3.rating === 1400, r3);
  const [t3row] = await db.select().from(teamRatings).where(eq(teamRatings.teamId, T(3)));
  check('T3 lineage columns', t3row.lineageParentId === T(1) && t3row.lineageShared === 2 && t3row.lineageReason === 'inherited', t3row);
  const [t1row] = await db.select().from(teamRatings).where(eq(teamRatings.teamId, T(1)));
  check('T1 consumed by T3', t1row.lineageConsumedBy === T(3), t1row.lineageConsumedBy);
  await db.insert(teams).values({ teamId: T(4), owner: A, lobster0: lob(3), lobster1: lob(8), lobster2: lob(9), active: false });
  const r4 = await ensureTeamRating(db, { teamId: T(4), owner: A, lobsterIds: [lob(3), lob(8), lob(9)], power: 3, epochId: 0 });
  check('T4 shares 1 lobster with consumed T1 -> fresh 1200', r4.created && r4.rating === 1200, r4);
  const [t4row] = await db.select().from(teamRatings).where(eq(teamRatings.teamId, T(4)));
  check('T4 lineage reason fresh', t4row.lineageReason === 'fresh' && t4row.lineageParentId === null, t4row);
  const rPower = await ensureTeamRating(db, { teamId: T(2), owner: B, lobsterIds: [lob(4), lob(5), lob(6)], power: 4, epochId: 0 });
  check('T2 power change -> reset to 1200 (reset=true)', rPower.reset && rPower.rating === 1200, rPower);
  const [t2row] = await db.select().from(teamRatings).where(eq(teamRatings.teamId, T(2)));
  check('T2 stored power now 4, reason power_changed', t2row.power === 4 && t2row.lineageReason === 'power_changed', t2row);
  // put T2 back at power 3 so it can fight T3 in the same pool for this scenario
  await ensureTeamRating(db, { teamId: T(2), owner: B, lobsterIds: [lob(4), lob(5), lob(6)], power: 3, epochId: 0 });
  // T5: rated 1500, disbanded, NOT consumed by any successor -> must still decay (disband-freeze loophole).
  await db.insert(lobsters).values([10, 11, 12].map((i) => ({ tokenId: lob(i), owner: A, dna: '0', class: 0, evolutionTier: 1, damage: 0 }) as any));
  await db.insert(teams).values({ teamId: T(5), owner: A, lobster0: lob(10), lobster1: lob(11), lobster2: lob(12), active: false });
  await ensureTeamRating(db, { teamId: T(5), owner: A, lobsterIds: [lob(10), lob(11), lob(12)], power: 3, epochId: 0 });
  await db.update(teamRatings).set({ rating: 1500 }).where(eq(teamRatings.teamId, T(5)));
  await db.update(teams).set({ disbandedAt: new Date() }).where(eq(teams.teamId, T(5)));

  console.log('\n[3] played ledger + rating outcomes in window 0 (8 battles, T3 wins 6)');
  const E = 0;
  for (let i = 1; i <= 8; i++) {
    const battleId = BigInt(500 + i);
    await db.insert(battles).values({
      battleId, playerA: A, playerB: B, teamA: T(3), teamB: T(2), stakeBracket: 0, stakeAmount: '2500', phase: 6,
      createdAt: new Date(anchorMs + i * 3600_000), settledAt: new Date(anchorMs + i * 3600_000 + 300_000), powerA: 3, powerB: 3,
    } as any);
    await db.transaction(async (tx) => {
      const a = await recordParticipation(tx, { battleId, teamId: T(3), opponentTeamId: T(2), epochId: E });
      const b = await recordParticipation(tx, { battleId, teamId: T(2), opponentTeamId: T(3), epochId: E });
      if (i === 1) check('participation rows inserted', a && b, { a, b });
      const out = await applyBattleOutcome(tx, { battleId, teamA: T(3), teamB: T(2), winnerTeam: i <= 6 ? T(3) : T(2), epochId: E });
      if (i === 1) check('first outcome applied', out.applied && out.ratingA! > 1400, out);
    });
  }
  const replay = await db.transaction((tx) => applyBattleOutcome(tx, { battleId: 501n, teamA: T(3), teamB: T(2), winnerTeam: T(3), epochId: E }));
  check('replaying battle 501 is rejected (applied=false)', replay.applied === false, replay);
  const dupPart = await recordParticipation(db, { battleId: 501n, teamId: T(3), opponentTeamId: T(2), epochId: E });
  check('replaying participation returns false', dupPart === false);
  const [{ n: partCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(battleParticipation);
  const [{ n: evCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(ratingEvents).where(inArray(ratingEvents.kind, ['battle', 'forfeit_loss']));
  check('16 participation rows, 16 battle rating events', Number(partCount) === 16 && Number(evCount) === 16, { partCount, evCount });
  const [t3after] = await db.select().from(teamRatings).where(eq(teamRatings.teamId, T(3)));
  const [t2after] = await db.select().from(teamRatings).where(eq(teamRatings.teamId, T(2)));
  check('ratings zero-sum (1400+1200), T3 ahead, counters roll', t3after.rating + t2after.rating === 2600 && t3after.rating > t2after.rating && t3after.wins === 6 && t2after.losses === 6 && t3after.gamesPlayedEpoch === 8 && t2after.gamesPlayedEpoch === 8, { t3: t3after.rating, t2: t2after.rating, w: t3after.wins, l: t2after.losses, gp3: t3after.gamesPlayedEpoch, gp2: t2after.gamesPlayedEpoch });

  console.log('\n[4] epoch job: announce -> compute -> stage -> activate (chain stub at epoch 0)');
  const logs: { level: string; msg: string; obj: Record<string, unknown> }[] = [];
  const log = {
    debug: (obj: Record<string, unknown>, msg: string) => logs.push({ level: 'debug', msg, obj }),
    info: (obj: Record<string, unknown>, msg: string) => logs.push({ level: 'info', msg, obj }),
    warn: (obj: Record<string, unknown>, msg: string) => logs.push({ level: 'warn', msg, obj }),
    error: (obj: Record<string, unknown>, msg: string) => logs.push({ level: 'error', msg, obj }),
  };
  let chainEpoch = 0;
  const deps = { db, clock, chain: { currentBoostEpoch: async () => chainEpoch }, now: () => new Date(), log };

  const announced = await ensureAnnounced(deps);
  const epochRows = await db.select().from(boostEpochs).orderBy(boostEpochs.epochId);
  check('announced windows 0 and 1', epochRows.length >= 2 && epochRows[0].epochId === 0 && epochRows[0].floorPlayed === 7 && epochRows[1].epochId === 1, epochRows.map((r) => [r.epochId, r.status, r.floorPlayed]));
  await db.update(boostEpochs).set({ floorPlayed: 9 }).where(eq(boostEpochs.epochId, 1));
  await ensureAnnounced(deps);
  const [w1] = await db.select().from(boostEpochs).where(eq(boostEpochs.epochId, 1));
  check('ensureAnnounced never overwrites an existing floor (ops override kept)', w1.floorPlayed === 9, w1.floorPlayed);

  const c1 = await computeEpoch(deps, 0);
  check('computeEpoch(0) computed: 2 qualified (T3, T2); T1 consumed skipped; T4 + disbanded T5 rated', c1.status === 'computed' && c1.qualifiedCount === 2 && c1.ratedCount === 4, c1);
  const ladder = await db.select().from(teamBoosts).where(eq(teamBoosts.epochId, 1)).orderBy(teamBoosts.rank);
  check('ladder for chain epoch 1: T3 rank1 +50%, T2 rank2 +10%', ladder.length === 2 && ladder[0].teamId === T(3) && ladder[0].boostBps === 5000 && ladder[1].teamId === T(2) && ladder[1].boostBps === 1000, ladder.map((r) => [r.teamId, r.rank, r.boostBps, r.power]));
  const decays = await db.select().from(ratingEvents).where(and(eq(ratingEvents.kind, 'idle_decay'), eq(ratingEvents.epochId, 0)));
  check('idle decay applied to non-qualified rated teams: T4 (live) and T5 (disbanded, unconsumed); consumed T1 skipped', decays.length === 2 && decays.some((d) => d.teamId === T(4)) && decays.some((d) => d.teamId === T(5)) && !decays.some((d) => d.teamId === T(1)), decays.map((d) => [d.teamId, d.ratingBefore, d.ratingAfter]));
  const t5decay = decays.find((d) => d.teamId === T(5));
  check('disbanded T5 1500 -> 1455 (15% of the 300 gap): disbanding does not freeze a rating', t5decay?.ratingAfter === 1455, t5decay);
  const [t5row] = await db.select().from(teamRatings).where(eq(teamRatings.teamId, T(5)));
  check('T5 row updated to 1455', t5row.rating === 1455, t5row.rating);
  const c2 = await computeEpoch(deps, 0);
  const decays2 = await db.select().from(ratingEvents).where(and(eq(ratingEvents.kind, 'idle_decay'), eq(ratingEvents.epochId, 0)));
  const ladder2 = await db.select().from(teamBoosts).where(eq(teamBoosts.epochId, 1));
  check('computeEpoch(0) re-run is a no-op', c2.status !== 'computed' && decays2.length === 2 && ladder2.length === 2, { c2, decays: decays2.length, ladder: ladder2.length });

  const s1 = await stageEpoch(deps, 0);
  const setJobs = await db.select().from(operatorJobs).where(eq(operatorJobs.jobType, 'set_team_boosts'));
  check('stageEpoch enqueued 1 set_team_boosts job (2 entries), key boost:set:1:0', s1 === 'staged' && setJobs.length === 1 && setJobs[0].idempotencyKey === 'boost:set:1:0' && (setJobs[0].payload as any).entries.length === 2 && (setJobs[0].payload as any).epoch === 1, { s1, jobs: setJobs.map((j) => [j.idempotencyKey, j.status]) });
  const s1b = await stageEpoch(deps, 0);
  const setJobs2 = await db.select().from(operatorJobs).where(eq(operatorJobs.jobType, 'set_team_boosts'));
  check('stageEpoch re-run reuses the outbox row', setJobs2.length === 1, { s1b, n: setJobs2.length });

  const a0 = await activateEpoch(deps, 0);
  const [row0a] = await db.select().from(boostEpochs).where(eq(boostEpochs.epochId, 0));
  check('activateEpoch waits while set jobs are pending', row0a.status === 'staged', { a0, status: row0a.status });
  // simulate the operator worker succeeding on the set job
  await db.update(operatorJobs).set({ status: 2, txHash: '0x' + 'a'.repeat(64), completedAt: new Date() }).where(eq(operatorJobs.jobType, 'set_team_boosts'));
  const a1 = await activateEpoch(deps, 0);
  const actJobs = await db.select().from(operatorJobs).where(eq(operatorJobs.jobType, 'activate_boost_epoch'));
  check('activate job enqueued after set jobs succeed, key boost:activate:1', actJobs.length === 1 && actJobs[0].idempotencyKey === 'boost:activate:1', { a1, jobs: actJobs.map((j) => j.idempotencyKey) });
  await db.update(operatorJobs).set({ status: 2, txHash: '0x' + 'b'.repeat(64), completedAt: new Date() }).where(eq(operatorJobs.jobType, 'activate_boost_epoch'));
  chainEpoch = 1;
  const a2 = await activateEpoch(deps, 0);
  const [row0b] = await db.select().from(boostEpochs).where(eq(boostEpochs.epochId, 0));
  check('window 0 activated with tx hash', row0b.status === 'activated' && row0b.activatedAt !== null && row0b.activateTxHash === '0x' + 'b'.repeat(64), { a2, status: row0b.status, tx: row0b.activateTxHash });
  const stamped = await db.select().from(teamBoosts).where(eq(teamBoosts.epochId, 1));
  check('team_boosts rows stamped with the set tx hash', stamped.every((r) => r.txHash === '0x' + 'a'.repeat(64)), stamped.map((r) => r.txHash));

  await runEpochJob(deps);
  const [row0c] = await db.select().from(boostEpochs).where(eq(boostEpochs.epochId, 0));
  const [row1c] = await db.select().from(boostEpochs).where(eq(boostEpochs.epochId, 1));
  check('runEpochJob afterwards leaves window 0 activated and window 1 active', row0c.status === 'activated' && row1c.status === 'active', [row0c.status, row1c.status]);
  const overdue = await checkOverdue(deps);
  check('not overdue', overdue === false, overdue);
  const errors = logs.filter((l) => l.level === 'error');
  check('no error logs from the job', errors.length === 0, errors.map((e) => e.msg));

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('verification crashed:', err);
  process.exit(2);
});
