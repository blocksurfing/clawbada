/** In-memory world for the boost epoch job tests: epoch rows, rated teams, the played
 *  ledger, previous boosts, win-trading pairs and the operator outbox, served through
 *  the fake drizzle chain. Writes mutate the same arrays so multi-step flows
 *  (compute -> stage -> activate) can be asserted on state, not just on captured SQL.
 *
 *  Import only AFTER `mock.module('@clawbada/db', ...)` — EpochClock pulls that module. */
import { BOOST_EPOCH_MS, floorPlayedForEpoch } from '@clawbada/game-logic';
import { EpochClock } from '../../boost/epoch-clock';
import type { EpochJobDeps, EpochJobLog } from '../../boost/epoch-job';
import { makeFakeDb, type FakeDb, type QueryRecord } from './fake-db';

/** Monday 2026-09-07 00:00 UTC. */
export const ANCHOR_MS = Date.UTC(2026, 8, 7, 0, 0, 0);
export const WEEK_MS = BOOST_EPOCH_MS;
export const DAY_MS = 86_400_000;

/** A moment inside window `epochId` (`fraction` of the way through). */
export function at(epochId: number, fraction = 0): Date {
  return new Date(ANCHOR_MS + (epochId + fraction) * WEEK_MS);
}

export interface EpochRow {
  epochId: number;
  chainEpoch: number;
  startsAt: Date;
  endsAt: Date;
  floorPlayed: number;
  status: string;
  ratedCount: number | null;
  qualifiedCount: number | null;
  lapsedCount: number | null;
  avgBoostBps: number | null;
  setJobIds: unknown;
  activateJobId: bigint | null;
  activateTxHash: string | null;
  activatedAt: Date | null;
  flags: unknown;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function epochRow(epochId: number, overrides: Partial<EpochRow> = {}): EpochRow {
  const clock = new EpochClock(ANCHOR_MS);
  const w = clock.windowOf(epochId);
  return {
    epochId,
    chainEpoch: epochId + 1,
    startsAt: w.startsAt,
    endsAt: w.endsAt,
    floorPlayed: floorPlayedForEpoch(epochId),
    status: 'active',
    ratedCount: null,
    qualifiedCount: null,
    lapsedCount: null,
    avgBoostBps: null,
    setJobIds: [],
    activateJobId: null,
    activateTxHash: null,
    activatedAt: null,
    flags: null,
    lastError: null,
    createdAt: w.startsAt,
    updatedAt: w.startsAt,
    ...overrides,
  };
}

export interface RatedTeam {
  teamId: bigint;
  owner: string;
  rating: number;
  power: number;
  cacheEpochId: number;
  cachePlayed: number;
}

export interface JobRow {
  id: bigint;
  jobType: string;
  payload: unknown;
  idempotencyKey: string;
  status: number;
  txHash: string | null;
  lastError: string | null;
}

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  obj: Record<string, unknown>;
  msg: string;
}

export class Scenario {
  epochRows: EpochRow[] = [];
  rated: RatedTeam[] = [];
  /** teamId (string) -> battles played in the window under test. */
  played = new Map<string, number>();
  /** team_boosts rows live during the window under test (chain epoch == epochId). */
  previousBoosts: bigint[] = [];
  pairs: { teamA: string; teamB: string; battles: number }[] = [];
  jobs: JobRow[] = [];
  insertedBoosts: Record<string, unknown>[] = [];
  teamBoostUpdates: QueryRecord[] = [];
  logs: LogEntry[] = [];
  /** What `chain.currentBoostEpoch()` answers. */
  chainEpoch = 0;
  chainReads = 0;
  now = new Date(ANCHOR_MS);
  /** Window under test (default cache epoch for `team()`). */
  epochId = 0;
  readonly clock = new EpochClock(ANCHOR_MS);
  readonly fake: FakeDb;
  private nextJobId = 1n;

  readonly log: EpochJobLog = {
    debug: (obj, msg) => this.logs.push({ level: 'debug', obj, msg }),
    info: (obj, msg) => this.logs.push({ level: 'info', obj, msg }),
    warn: (obj, msg) => this.logs.push({ level: 'warn', obj, msg }),
    error: (obj, msg) => this.logs.push({ level: 'error', obj, msg }),
  };

  constructor() {
    this.fake = makeFakeDb({
      select: (q) => this.select(q),
      insert: (q) => this.insert(q),
      update: (q) => this.update(q),
    });
  }

  deps(): EpochJobDeps {
    return {
      db: this.fake.db,
      clock: this.clock,
      chain: {
        currentBoostEpoch: async () => {
          this.chainReads++;
          return this.chainEpoch;
        },
      },
      now: () => this.now,
      log: this.log,
    };
  }

  row(epochId: number): EpochRow {
    const r = this.epochRows.find((x) => x.epochId === epochId);
    if (!r) throw new Error(`scenario has no epoch row ${epochId}`);
    return r;
  }

  logged(msg: string): LogEntry[] {
    return this.logs.filter((l) => l.msg === msg);
  }

  /** Add a rated, live team and its played count for the window under test. */
  team(
    teamId: bigint,
    rating: number,
    played: number,
    opts: { power?: number; owner?: string; cacheEpochId?: number; cachePlayed?: number } = {},
  ): RatedTeam {
    const t: RatedTeam = {
      teamId,
      owner: opts.owner ?? `0xowner${teamId}`,
      rating,
      power: opts.power ?? 5,
      cacheEpochId: opts.cacheEpochId ?? this.epochId,
      cachePlayed: opts.cachePlayed ?? played,
    };
    this.rated.push(t);
    if (played > 0) this.played.set(String(teamId), played);
    return t;
  }

  job(id: bigint): JobRow {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) throw new Error(`scenario has no job ${id}`);
    return j;
  }

  private select(q: QueryRecord): unknown[] {
    switch (q.table) {
      case 'boost_epochs': {
        if (q.projection && 'activatedAt' in q.projection && q.has('limit')) {
          return this.epochRows
            .filter((r) => r.status === 'activated' && r.activatedAt !== null)
            .sort((a, b) => b.activatedAt!.getTime() - a.activatedAt!.getTime())
            .slice(0, 1)
            .map((r) => ({ epochId: r.epochId, activatedAt: r.activatedAt }));
        }
        if (q.projection && Object.keys(q.projection).length === 1 && 'epochId' in q.projection) {
          return this.epochRows.map((r) => ({ epochId: r.epochId }));
        }
        if (!q.projection && q.has('orderBy')) {
          return this.epochRows
            .filter((r) => r.endsAt.getTime() <= this.now.getTime() && r.status !== 'activated')
            .sort((a, b) => a.epochId - b.epochId)
            .map((r) => ({ ...r }));
        }
        const id = q.whereValue('boost_epochs.epochId');
        return this.epochRows.filter((r) => r.epochId === id).map((r) => ({ ...r }));
      }
      case 'team_ratings': {
        if (q.has('innerJoin')) return this.rated.map((r) => ({ ...r }));
        return this.rated.map((r) => ({ teamId: r.teamId, owner: r.owner }));
      }
      case 'battle_participation': {
        if (q.has('having')) return this.pairs.map((p) => ({ ...p }));
        return [...this.played.entries()].map(([teamId, played]) => ({ teamId: BigInt(teamId), played }));
      }
      case 'team_boosts': {
        if (q.projection && 'boostBps' in q.projection) {
          return this.insertedBoosts
            .map((b) => ({
              teamId: b.teamId as bigint,
              boostBps: b.boostBps as number,
              power: b.power as number,
              batchIndex: b.batchIndex as number,
              rank: b.rank as number,
            }))
            .sort((a, b) => a.batchIndex - b.batchIndex || a.rank - b.rank || (a.teamId < b.teamId ? -1 : 1));
        }
        return this.previousBoosts.map((teamId) => ({ teamId }));
      }
      case 'operator_jobs': {
        if (q.projection && 'status' in q.projection) {
          const id = q.whereValue('operator_jobs.id');
          if (q.has('limit') && id !== undefined) return this.jobs.filter((j) => j.id === id).map((j) => ({ ...j }));
          return this.jobs.map((j) => ({ ...j }));
        }
        const key = q.whereValue('operator_jobs.idempotencyKey');
        return this.jobs.filter((j) => j.idempotencyKey === key).map((j) => ({ id: j.id }));
      }
      default:
        return [];
    }
  }

  private insert(q: QueryRecord): unknown[] {
    switch (q.table) {
      case 'boost_epochs': {
        for (const v of q.values as Partial<EpochRow>[]) {
          if (this.epochRows.some((r) => r.epochId === v.epochId)) continue; // ON CONFLICT DO NOTHING
          this.epochRows.push(epochRow(v.epochId!, v));
        }
        return [];
      }
      case 'team_boosts': {
        for (const v of q.values as Record<string, unknown>[]) {
          if (this.insertedBoosts.some((b) => b.epochId === v.epochId && b.teamId === v.teamId)) continue;
          this.insertedBoosts.push(v);
        }
        return [];
      }
      case 'operator_jobs': {
        const v = q.values as { jobType: string; payload: unknown; idempotencyKey: string };
        if (this.jobs.some((j) => j.idempotencyKey === v.idempotencyKey)) return [];
        // Identity column: never collide with ids a test seeded by hand.
        for (const j of this.jobs) if (j.id >= this.nextJobId) this.nextJobId = j.id + 1n;
        const job: JobRow = {
          id: this.nextJobId++,
          jobType: v.jobType,
          payload: v.payload,
          idempotencyKey: v.idempotencyKey,
          status: 0,
          txHash: null,
          lastError: null,
        };
        this.jobs.push(job);
        return [{ id: job.id }];
      }
      default:
        return [];
    }
  }

  private update(q: QueryRecord): unknown[] {
    if (q.table === 'boost_epochs') {
      const filter = q.wherePairs('boost_epochs.');
      for (const r of this.epochRows) {
        const matches = Object.entries(filter).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v);
        if (matches) Object.assign(r, q.set);
      }
    }
    if (q.table === 'team_boosts') this.teamBoostUpdates.push(q);
    return [];
  }
}
