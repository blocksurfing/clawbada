/**
 * Weekly boost epoch job — turns one window of battle participation into the on-chain
 * boost table for the next window (battle-rank mining boost, S1, locked 2026-09-02).
 *
 * Every step is a function of injected deps so the pipeline runs in tests without
 * Postgres or an RPC. Nothing here signs a transaction: on-chain writes are enqueued
 * as `operator_jobs` rows (`set_team_boosts`, `activate_boost_epoch`) and the operator
 * worker submits them; this job only reads their status back.
 *
 * Per window E (chain epoch E+1):
 *
 *   announced -> active --(endsAt <= now)--> closing -> computed -> staged -> activated
 *                                                                        \-> failed
 *
 * The chain epoch counter is strictly sequential (`activateBoostEpoch` only accepts
 * currentBoostEpoch + 1), so windows are processed in order and a window that is not
 * yet activated blocks every later one. A `failed` row needs an operator — see
 * docs/runbooks/boost-epoch.md.
 */
import { and, asc, count, countDistinct, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import {
  BOOST_ENTRIES_PER_TX,
  BOOST_EPOCH_TTL_SECONDS,
  batchLadder,
  floorPlayedForEpoch,
  idleDecay,
  rankQualified,
} from '@clawbada/game-logic';
import {
  applyIdleDecay,
  battleParticipation,
  boostEpochs,
  operatorJobs,
  teamBoosts,
  teamRatings,
  teams,
  type Database,
  type DbExecutor,
} from '@clawbada/db';
import { JobStatus } from '../operator/types';
import type { ActivateBoostEpochPayload } from '../operator/jobs/activate-boost-epoch';
import type { SetTeamBoostsPayload } from '../operator/jobs/set-team-boosts';
import type { EpochClock } from './epoch-clock';

// ──────────── Constants ────────────

/** Alarm when nothing has been activated for this long; the contract zeroes every
 *  boost after BOOST_EPOCH_TTL_SECONDS (10 days), so 8 days leaves ops two days. */
export const BOOST_EPOCH_OVERDUE_MS = 8 * 24 * 60 * 60 * 1000;
/** Rows per INSERT into team_boosts (statement size, unrelated to the 200-entry tx cap). */
export const TEAM_BOOST_INSERT_CHUNK = 1_000;
/** A pair of teams meeting this often in one window is flagged for win-trading review. */
export const REPEATED_PAIR_THRESHOLD = 3;
/** ensureAnnounced normally creates at most the current and next window; more means the
 *  engine was down across a boundary (or the anchor is wrong) — worth a warning. */
export const BACKFILL_WARN_THRESHOLD = 2;

export const EPOCH_STATUS = {
  Announced: 'announced',
  Active: 'active',
  Closing: 'closing',
  Computed: 'computed',
  Staged: 'staged',
  Activated: 'activated',
  Failed: 'failed',
} as const;
export type EpochStatus = (typeof EPOCH_STATUS)[keyof typeof EPOCH_STATUS];

/** Statuses computeEpoch will act on; anything later (or failed) is a no-op. */
const COMPUTABLE = new Set<string>([EPOCH_STATUS.Announced, EPOCH_STATUS.Active, EPOCH_STATUS.Closing]);

export const SET_TEAM_BOOSTS_JOB = 'set_team_boosts';
export const ACTIVATE_BOOST_EPOCH_JOB = 'activate_boost_epoch';

// ──────────── Dependencies ────────────

/** The only chain read the job needs; writes go through the operator outbox. */
export interface BoostChain {
  currentBoostEpoch(): Promise<number>;
}

/** Structural subset of pino so tests can pass a recorder. */
export interface EpochJobLog {
  debug(obj: Record<string, unknown>, msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface EpochJobDeps {
  db: Database;
  clock: EpochClock;
  chain: BoostChain;
  now(): Date;
  log: EpochJobLog;
}

type EpochRow = typeof boostEpochs.$inferSelect;

export interface EpochFlags {
  repeatedPairs: { teamA: string; teamB: string; battles: number; sameOwner: boolean }[];
  sameOwnerPairs: { teamA: string; teamB: string; battles: number; owner: string }[];
  playedCacheMismatches: { teamId: string; cached: number; ledger: number }[];
}

// ──────────── ensureAnnounced ────────────

/** Make sure a boost_epochs row exists for every window from launch through the next
 *  one. Rows are inserted with ON CONFLICT DO NOTHING and only `status` is ever
 *  updated, so an operator can pre-publish a different floor for a future week by
 *  editing (or pre-inserting) that row. Every window from 0 is covered — not just the
 *  current and next — because the chain epoch counter is sequential: a window the
 *  engine slept through still has to be computed and activated (possibly empty) for
 *  later windows to line up with `currentBoostEpoch`. Returns the epoch ids created. */
export async function ensureAnnounced(deps: EpochJobDeps): Promise<number[]> {
  const { db, clock, log } = deps;
  const now = deps.now();
  const current = clock.current(now);
  const last = current + 1;
  if (last < 0) return []; // more than a week before launch: nothing to announce yet

  const existing = await db
    .select({ epochId: boostEpochs.epochId })
    .from(boostEpochs)
    .where(and(gte(boostEpochs.epochId, 0), lte(boostEpochs.epochId, last)));
  const have = new Set(existing.map((r) => r.epochId));
  const missing: number[] = [];
  for (let e = 0; e <= last; e++) if (!have.has(e)) missing.push(e);

  if (missing.length > 0) {
    const values = missing.map((epochId) => {
      const window = clock.windowOf(epochId);
      return {
        epochId,
        chainEpoch: epochId + 1,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        floorPlayed: floorPlayedForEpoch(epochId),
        status: epochId === current ? EPOCH_STATUS.Active : EPOCH_STATUS.Announced,
      };
    });
    await db.insert(boostEpochs).values(values).onConflictDoNothing();
    for (const v of values) {
      log.info(
        { epochId: v.epochId, chainEpoch: v.chainEpoch, startsAt: v.startsAt, endsAt: v.endsAt, floorPlayed: v.floorPlayed, status: v.status },
        'boost_epoch_announced',
      );
    }
    if (missing.length > BACKFILL_WARN_THRESHOLD) {
      log.warn({ count: missing.length, from: missing[0], to: missing[missing.length - 1], current }, 'boost_epoch_backfill');
    }
  }

  // Promote the current window's pre-announced row. Status only — never the floor.
  if (current >= 0) {
    await db
      .update(boostEpochs)
      .set({ status: EPOCH_STATUS.Active, updatedAt: now })
      .where(and(eq(boostEpochs.epochId, current), eq(boostEpochs.status, EPOCH_STATUS.Announced)));
  }
  return missing;
}

// ──────────── computeEpoch ────────────

export interface ComputeResult {
  status: 'computed' | 'skipped' | 'missing';
  ratedCount?: number;
  qualifiedCount?: number;
  lapsedCount?: number;
  avgBoostBps?: number | null;
  batches?: number;
}

/** Close window `epochId`: rank the qualified teams, decay everyone else, and write the
 *  ladder as team_boosts rows for chain epoch `epochId + 1`. One transaction, and
 *  idempotent at every layer — the row lock serialises concurrent runs, a row already
 *  at `computed` or later is a no-op, idle decay is unique per (team, epoch) via the
 *  partial index behind `applyIdleDecay`, and the ladder insert is ON CONFLICT DO NOTHING. */
export async function computeEpoch(deps: EpochJobDeps, epochId: number): Promise<ComputeResult> {
  const { db, log } = deps;
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(boostEpochs).where(eq(boostEpochs.epochId, epochId)).for('update');
    if (!row) {
      log.error({ epochId }, 'boost_epoch_row_missing');
      return { status: 'missing' };
    }
    if (!COMPUTABLE.has(row.status)) return { status: 'skipped' };

    const chainEpoch = row.chainEpoch;
    const now = deps.now();
    await tx
      .update(boostEpochs)
      .set({ status: EPOCH_STATUS.Closing, updatedAt: now })
      .where(eq(boostEpochs.epochId, epochId));

    // Every rated team that still exists. Disbanded teams keep their rating row as a
    // lineage parent but neither qualify nor decay.
    const rated = await tx
      .select({
        teamId: teamRatings.teamId,
        owner: teamRatings.owner,
        rating: teamRatings.rating,
        power: teamRatings.power,
        cacheEpochId: teamRatings.epochId,
        cachePlayed: teamRatings.gamesPlayedEpoch,
      })
      .from(teamRatings)
      .innerJoin(teams, eq(teams.teamId, teamRatings.teamId))
      .where(isNull(teams.disbandedAt));

    // The participation ledger is authoritative for "played"; the counter on
    // team_ratings is only a cache and is cross-checked below.
    const playedRows = await tx
      .select({ teamId: battleParticipation.teamId, played: count() })
      .from(battleParticipation)
      .where(eq(battleParticipation.epochId, epochId))
      .groupBy(battleParticipation.teamId);
    const played = new Map<string, number>();
    for (const p of playedRows) played.set(String(p.teamId), Number(p.played));

    type Rated = (typeof rated)[number] & { played: number };
    const qualified: Rated[] = [];
    const others: Rated[] = [];
    const mismatches: EpochFlags['playedCacheMismatches'] = [];
    for (const r of rated) {
      const n = played.get(String(r.teamId)) ?? 0;
      const cacheRefersToThisEpoch = r.cacheEpochId === epochId;
      if ((cacheRefersToThisEpoch && r.cachePlayed !== n) || (r.cacheEpochId < epochId && n > 0)) {
        mismatches.push({ teamId: String(r.teamId), cached: cacheRefersToThisEpoch ? r.cachePlayed : 0, ledger: n });
      }
      const eligible = n >= row.floorPlayed && r.power >= 3 && r.power <= 9;
      (eligible ? qualified : others).push({ ...r, played: n });
    }
    if (mismatches.length > 0) {
      log.warn({ epochId, count: mismatches.length, teams: mismatches }, 'played_cache_mismatch');
    }

    // Lapse: rating persists but regresses toward baseline. The partial unique index
    // on rating_events makes a second pass over the same (team, epoch) a no-op.
    let decayed = 0;
    for (const t of others) {
      if (await applyIdleDecay(tx, t.teamId, epochId, t.rating, idleDecay(t.rating))) decayed++;
    }

    // One global ladder; batchIndex follows ladder order so batch 0 is the top 200.
    const ladder = rankQualified(qualified.map((q) => ({ teamId: q.teamId, rating: q.rating })));
    const byId = new Map(qualified.map((q) => [String(q.teamId), q]));
    const boostRows = ladder.map((l, i) => {
      const q = byId.get(String(l.teamId))!;
      return {
        epochId: chainEpoch,
        teamId: l.teamId,
        earnedEpochId: epochId,
        rating: l.rating,
        rank: l.rank,
        percentile: l.percentile.toFixed(6),
        boostBps: l.boostBps,
        power: q.power,
        gamesPlayed: q.played,
        batchIndex: Math.floor(i / BOOST_ENTRIES_PER_TX),
      };
    });
    for (const chunk of batchLadder(boostRows, TEAM_BOOST_INSERT_CHUNK)) {
      await tx.insert(teamBoosts).values(chunk).onConflictDoNothing();
    }
    const batches = boostRows.length === 0 ? 0 : Math.floor((boostRows.length - 1) / BOOST_ENTRIES_PER_TX) + 1;

    // Lapsed = on the table that was live during this window (chain epoch == epochId)
    // but not on the new one.
    const previous = await tx.select({ teamId: teamBoosts.teamId }).from(teamBoosts).where(eq(teamBoosts.epochId, epochId));
    const newIds = new Set(ladder.map((l) => String(l.teamId)));
    const lapsedCount = previous.filter((p) => !newIds.has(String(p.teamId))).length;

    const flags = await winTradingFlags(tx, epochId, mismatches);
    for (const p of flags.repeatedPairs) log.warn({ epochId, ...p }, 'boost_win_trading_flag');

    const avgBoostBps = ladder.length === 0 ? null : Math.round(ladder.reduce((s, l) => s + l.boostBps, 0) / ladder.length);
    await tx
      .update(boostEpochs)
      .set({
        status: EPOCH_STATUS.Computed,
        ratedCount: rated.length,
        qualifiedCount: ladder.length,
        lapsedCount,
        avgBoostBps,
        flags,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(boostEpochs.epochId, epochId));

    log.info(
      {
        epochId,
        chainEpoch,
        floorPlayed: row.floorPlayed,
        ratedCount: rated.length,
        qualifiedCount: ladder.length,
        lapsedCount,
        decayed,
        avgBoostBps,
        batches,
        repeatedPairs: flags.repeatedPairs.length,
        sameOwnerPairs: flags.sameOwnerPairs.length,
      },
      'boost_epoch_computed',
    );
    return { status: 'computed', ratedCount: rated.length, qualifiedCount: ladder.length, lapsedCount, avgBoostBps, batches };
  });
}

/** Pairs that met REPEATED_PAIR_THRESHOLD+ times this window, and which of those share
 *  an owner. Telemetry only — nothing is withheld automatically in S1. */
async function winTradingFlags(
  tx: DbExecutor,
  epochId: number,
  playedCacheMismatches: EpochFlags['playedCacheMismatches'],
): Promise<EpochFlags> {
  // Both participants write a row per battle, so count distinct battles, not rows.
  const low = sql<string>`LEAST(${battleParticipation.teamId}, ${battleParticipation.opponentTeamId})`;
  const high = sql<string>`GREATEST(${battleParticipation.teamId}, ${battleParticipation.opponentTeamId})`;
  const pairRows = await tx
    .select({ teamA: low, teamB: high, battles: countDistinct(battleParticipation.battleId) })
    .from(battleParticipation)
    .where(and(eq(battleParticipation.epochId, epochId), isNotNull(battleParticipation.opponentTeamId)))
    .groupBy(low, high)
    .having(sql`COUNT(DISTINCT ${battleParticipation.battleId}) >= ${REPEATED_PAIR_THRESHOLD}`);
  if (pairRows.length === 0) return { repeatedPairs: [], sameOwnerPairs: [], playedCacheMismatches };

  const ids = [...new Set(pairRows.flatMap((p) => [String(p.teamA), String(p.teamB)]))].map((s) => BigInt(s));
  const owners = await tx
    .select({ teamId: teamRatings.teamId, owner: teamRatings.owner })
    .from(teamRatings)
    .where(inArray(teamRatings.teamId, ids));
  const ownerOf = new Map(owners.map((o) => [String(o.teamId), o.owner]));

  const repeatedPairs = pairRows.map((p) => {
    const teamA = String(p.teamA);
    const teamB = String(p.teamB);
    const a = ownerOf.get(teamA);
    return { teamA, teamB, battles: Number(p.battles), sameOwner: a !== undefined && a === ownerOf.get(teamB) };
  });
  const sameOwnerPairs = repeatedPairs
    .filter((p) => p.sameOwner)
    .map((p) => ({ teamA: p.teamA, teamB: p.teamB, battles: p.battles, owner: ownerOf.get(p.teamA)! }));
  return { repeatedPairs, sameOwnerPairs, playedCacheMismatches };
}

// ──────────── stageEpoch ────────────

export type StageResult = 'staged' | 'activated' | 'failed' | 'skipped' | 'missing';

/** Enqueue one `set_team_boosts` outbox job per 200-entry batch of the computed
 *  ladder. Guarded by the chain first: if `currentBoostEpoch` already reached this
 *  chain epoch someone else activated it (mark activated); if it is anywhere but
 *  chainEpoch - 1 the numbering has drifted and posting would either revert or land
 *  on the wrong epoch, so the row fails for an operator instead. */
export async function stageEpoch(deps: EpochJobDeps, epochId: number): Promise<StageResult> {
  const { db, chain, log } = deps;
  const row = await loadEpoch(db, epochId);
  if (!row) {
    log.error({ epochId }, 'boost_epoch_row_missing');
    return 'missing';
  }
  if (row.status !== EPOCH_STATUS.Computed) return 'skipped';
  const chainEpoch = row.chainEpoch;

  const current = await chain.currentBoostEpoch();
  if (current >= chainEpoch) {
    const now = deps.now();
    await db
      .update(boostEpochs)
      .set({ status: EPOCH_STATUS.Activated, activatedAt: now, lastError: null, updatedAt: now })
      .where(eq(boostEpochs.epochId, epochId));
    log.warn({ epochId, chainEpoch, currentBoostEpoch: current }, 'boost_epoch_already_activated');
    return 'activated';
  }
  if (current !== chainEpoch - 1) {
    await markFailed(deps, epochId, `chain_out_of_sync: currentBoostEpoch=${current} expected=${chainEpoch - 1}`, {
      chainEpoch,
      currentBoostEpoch: current,
    });
    return 'failed';
  }

  const rows = await db
    .select({
      teamId: teamBoosts.teamId,
      boostBps: teamBoosts.boostBps,
      power: teamBoosts.power,
      batchIndex: teamBoosts.batchIndex,
      rank: teamBoosts.rank,
    })
    .from(teamBoosts)
    .where(eq(teamBoosts.epochId, chainEpoch))
    .orderBy(asc(teamBoosts.batchIndex), asc(teamBoosts.rank), asc(teamBoosts.teamId));

  const batches = new Map<number, typeof rows>();
  for (const r of rows) {
    const list = batches.get(r.batchIndex) ?? [];
    list.push(r);
    batches.set(r.batchIndex, list);
  }

  const jobIds: string[] = [];
  for (const batchIndex of [...batches.keys()].sort((a, b) => a - b)) {
    const entries = batches.get(batchIndex)!.map((r) => ({ teamId: String(r.teamId), bps: r.boostBps, power: r.power }));
    if (entries.length > BOOST_ENTRIES_PER_TX) {
      throw new Error(`boost batch ${batchIndex} for chain epoch ${chainEpoch} has ${entries.length} entries (max ${BOOST_ENTRIES_PER_TX})`);
    }
    const payload: SetTeamBoostsPayload = { epoch: chainEpoch, entries };
    const jobId = await enqueueJob(db, SET_TEAM_BOOSTS_JOB, `boost:set:${chainEpoch}:${batchIndex}`, payload);
    jobIds.push(jobId.toString());
  }

  await db
    .update(boostEpochs)
    .set({ status: EPOCH_STATUS.Staged, setJobIds: jobIds, lastError: null, updatedAt: deps.now() })
    .where(eq(boostEpochs.epochId, epochId));
  log.info({ epochId, chainEpoch, entries: rows.length, batches: jobIds.length, setJobIds: jobIds }, 'boost_epoch_staged');
  return 'staged';
}

// ──────────── activateEpoch ────────────

export type ActivateResult = 'activated' | 'waiting' | 'failed' | 'skipped' | 'missing';

/** Once every set job succeeded, enqueue the `activate_boost_epoch` job; once that
 *  succeeded, mark the row activated. Any dead job fails the row for an operator.
 *  Returns 'waiting' whenever a job is still in flight — the next tick re-checks. */
export async function activateEpoch(deps: EpochJobDeps, epochId: number): Promise<ActivateResult> {
  const { db, log } = deps;
  const row = await loadEpoch(db, epochId);
  if (!row) {
    log.error({ epochId }, 'boost_epoch_row_missing');
    return 'missing';
  }
  if (row.status !== EPOCH_STATUS.Staged) return 'skipped';
  const chainEpoch = row.chainEpoch;

  const setJobIds = parseJobIds(row.setJobIds);
  if (setJobIds.length > 0) {
    const jobs = await db
      .select({ id: operatorJobs.id, status: operatorJobs.status, txHash: operatorJobs.txHash, lastError: operatorJobs.lastError })
      .from(operatorJobs)
      .where(inArray(operatorJobs.id, setJobIds));
    const byId = new Map(jobs.map((j) => [j.id.toString(), j]));

    const missing = setJobIds.filter((id) => !byId.has(id.toString()));
    if (missing.length > 0) {
      await markFailed(deps, epochId, `set_job_missing: ${missing.join(',')}`, { chainEpoch });
      return 'failed';
    }
    const dead = jobs.filter((j) => j.status === JobStatus.Dead);
    if (dead.length > 0) {
      const detail = dead.map((j) => `${j.id}:${j.lastError ?? 'unknown'}`).join('; ');
      await markFailed(deps, epochId, `set_job_dead: ${detail}`, { chainEpoch, deadJobIds: dead.map((j) => j.id.toString()) });
      return 'failed';
    }
    const pending = jobs.filter((j) => j.status !== JobStatus.Succeeded);
    if (pending.length > 0) {
      log.debug({ epochId, chainEpoch, pending: pending.map((j) => j.id.toString()) }, 'boost_epoch_set_jobs_pending');
      return 'waiting';
    }

    // Audit trail: stamp each batch's rows with the tx that posted it (once).
    for (let batchIndex = 0; batchIndex < setJobIds.length; batchIndex++) {
      const job = byId.get(setJobIds[batchIndex].toString())!;
      if (!job.txHash) continue;
      await db
        .update(teamBoosts)
        .set({ txHash: job.txHash })
        .where(and(eq(teamBoosts.epochId, chainEpoch), eq(teamBoosts.batchIndex, batchIndex), isNull(teamBoosts.txHash)));
    }
  }

  if (row.activateJobId === null) {
    const payload: ActivateBoostEpochPayload = { epoch: chainEpoch };
    const activateJobId = await enqueueJob(db, ACTIVATE_BOOST_EPOCH_JOB, `boost:activate:${chainEpoch}`, payload);
    await db.update(boostEpochs).set({ activateJobId, updatedAt: deps.now() }).where(eq(boostEpochs.epochId, epochId));
    log.info({ epochId, chainEpoch, activateJobId: activateJobId.toString() }, 'boost_epoch_activate_enqueued');
    return 'waiting';
  }

  const [job] = await db
    .select({ id: operatorJobs.id, status: operatorJobs.status, txHash: operatorJobs.txHash, lastError: operatorJobs.lastError })
    .from(operatorJobs)
    .where(eq(operatorJobs.id, row.activateJobId))
    .limit(1);
  if (!job) {
    await markFailed(deps, epochId, `activate_job_missing: ${row.activateJobId}`, { chainEpoch });
    return 'failed';
  }
  if (job.status === JobStatus.Dead) {
    await markFailed(deps, epochId, `activate_job_dead: ${job.lastError ?? 'unknown'}`, { chainEpoch, activateJobId: job.id.toString() });
    return 'failed';
  }
  if (job.status !== JobStatus.Succeeded) return 'waiting';

  const now = deps.now();
  await db
    .update(boostEpochs)
    .set({ status: EPOCH_STATUS.Activated, activatedAt: now, activateTxHash: job.txHash, lastError: null, updatedAt: now })
    .where(eq(boostEpochs.epochId, epochId));
  log.info({ epochId, chainEpoch, activateTxHash: job.txHash, activateJobId: job.id.toString() }, 'boost_epoch_activated');
  return 'activated';
}

// ──────────── runEpochJob ────────────

/** One tick: announce rows, then drive every ended window through the pipeline in
 *  order, stopping at the first one that is not activated yet (or has failed) so the
 *  chain epoch counter is never asked to skip. Finishes with the overdue alarm. */
export async function runEpochJob(deps: EpochJobDeps): Promise<void> {
  const { db, log } = deps;
  await ensureAnnounced(deps);

  const due = await db
    .select()
    .from(boostEpochs)
    .where(and(lte(boostEpochs.endsAt, deps.now()), ne(boostEpochs.status, EPOCH_STATUS.Activated)))
    .orderBy(asc(boostEpochs.epochId));

  for (const row of due) {
    let status: string = row.status;
    if (status === EPOCH_STATUS.Failed) {
      log.warn({ epochId: row.epochId, chainEpoch: row.chainEpoch, lastError: row.lastError }, 'boost_epoch_blocked');
      break;
    }
    if (COMPUTABLE.has(status)) {
      const r = await computeEpoch(deps, row.epochId);
      if (r.status !== 'computed') break;
      status = EPOCH_STATUS.Computed;
    }
    if (status === EPOCH_STATUS.Computed) {
      const r = await stageEpoch(deps, row.epochId);
      if (r === 'activated') continue;
      if (r !== 'staged') break;
      status = EPOCH_STATUS.Staged;
    }
    if (status === EPOCH_STATUS.Staged) {
      const r = await activateEpoch(deps, row.epochId);
      if (r !== 'activated') break;
      continue;
    }
    // Unknown status (hand-edited row): do not guess, and do not skip past it.
    log.error({ epochId: row.epochId, status }, 'boost_epoch_unknown_status');
    break;
  }

  await checkOverdue(deps);
}

/** Alarm well inside the contract's 10-day TTL: if the newest activation (or, before
 *  any, the anchor) is older than BOOST_EPOCH_OVERDUE_MS, log an error every tick. */
export async function checkOverdue(deps: EpochJobDeps): Promise<boolean> {
  const { db, clock, log } = deps;
  const now = deps.now();
  const [latest] = await db
    .select({ epochId: boostEpochs.epochId, activatedAt: boostEpochs.activatedAt })
    .from(boostEpochs)
    .where(and(eq(boostEpochs.status, EPOCH_STATUS.Activated), isNotNull(boostEpochs.activatedAt)))
    .orderBy(desc(boostEpochs.activatedAt))
    .limit(1);
  const since = latest?.activatedAt ?? new Date(clock.anchorMs);
  const ageMs = now.getTime() - since.getTime();
  if (ageMs <= BOOST_EPOCH_OVERDUE_MS) return false;
  log.error(
    {
      lastActivatedEpochId: latest?.epochId ?? null,
      lastActivatedAt: latest?.activatedAt ?? null,
      ageDays: Number((ageMs / 86_400_000).toFixed(2)),
      ttlDays: BOOST_EPOCH_TTL_SECONDS / 86_400,
    },
    'boost_epoch_overdue',
  );
  return true;
}

// ──────────── helpers ────────────

async function loadEpoch(db: Database, epochId: number): Promise<EpochRow | undefined> {
  const [row] = await db.select().from(boostEpochs).where(eq(boostEpochs.epochId, epochId)).limit(1);
  return row;
}

async function markFailed(deps: EpochJobDeps, epochId: number, error: string, extra: Record<string, unknown>): Promise<void> {
  await deps.db
    .update(boostEpochs)
    .set({ status: EPOCH_STATUS.Failed, lastError: error, updatedAt: deps.now() })
    .where(eq(boostEpochs.epochId, epochId));
  deps.log.error({ epochId, error, ...extra }, 'boost_epoch_failed');
}

/** Insert an outbox row, or return the id of the one already holding the key. */
async function enqueueJob(db: Database, jobType: string, idempotencyKey: string, payload: unknown): Promise<bigint> {
  const inserted = await db
    .insert(operatorJobs)
    .values({ jobType, idempotencyKey, payload })
    .onConflictDoNothing({ target: operatorJobs.idempotencyKey })
    .returning({ id: operatorJobs.id });
  if (inserted.length === 1) return inserted[0].id;
  const [existing] = await db
    .select({ id: operatorJobs.id })
    .from(operatorJobs)
    .where(eq(operatorJobs.idempotencyKey, idempotencyKey))
    .limit(1);
  if (!existing) throw new Error(`operator_jobs row ${idempotencyKey} was neither inserted nor found`);
  return existing.id;
}

/** set_job_ids is jsonb written by stageEpoch as decimal strings. */
function parseJobIds(raw: unknown): bigint[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => BigInt(typeof v === 'string' || typeof v === 'number' ? v : String(v)));
}
