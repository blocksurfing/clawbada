/**
 * Settle reconciler (audit 2026-09, D-28).
 *
 * When a real battle ends, the API marks its session 'settling' and enqueues a
 * `settle_battle` job; the operator worker submits `BattleArena.settle`. Two things could
 * silently break that hand-off, and both ended the same way — the battle stays Active
 * on-chain until ACTIVE_WINDOW (3 h after reveal), then anyone, including the LOSER, calls
 * `handleTimeout` for a mutual full refund, and a late `settle` reverts PhaseTimedOut. The
 * winner loses a battle they won; the protocol loses its fee.
 *
 *   1. The job was never written. (The API now writes both in one transaction, so this is
 *      belt-and-braces — it also covers rows from before that fix and manual DB repairs.)
 *   2. The job DIED. Transient failures (RPC down, gas spike) run a 5 s / 30 s / 5 min / 1 h
 *      ladder — about 65 minutes — and then the worker stops for good, with nearly two hours
 *      of the settle window still open.
 *
 * Each tick, for every session that has been 'settling' longer than a grace period while
 * its battle is still Active on-chain with time left:
 *   - no job          → rebuild the payload from the session row and enqueue it;
 *   - job Dead from exhausted retries → put it back to Pending with a fresh ladder;
 *   - job Dead for a PERMANENT reason (a contract revert that retrying cannot fix) → never
 *     revived; raised as an alarm, because only a human can resolve it;
 *   - anything still unsettled after `alarmAfterMs` → an error-level `settle_overdue` log
 *     with the seconds left, well inside the 3 h window.
 *
 * Chain time (latest block timestamp) — not the server clock — is compared with
 * `phaseDeadline`, because the contract judges by block.timestamp. This class writes only
 * to `operator_jobs`; the indexer flips the session to 'settled' when BattleSettled lands.
 */
import { and, eq, lt } from 'drizzle-orm';
import { v3 } from '@clawbada/game-logic';
import { log as baseLog } from '../logger';
import { JobStatus } from './types';

const DEFAULT_POLL_MS = 30_000;
/** Leave the normal path alone for this long after the battle ended. */
const DEFAULT_GRACE_MS = 60_000;
/** A real battle unsettled this long after it ended is an incident. */
const DEFAULT_ALARM_AFTER_MS = 20 * 60_000;
/** Do not repeat the same battle's alarm more often than this. */
const ALARM_REPEAT_MS = 10 * 60_000;
/** Below this many seconds left a settle cannot realistically land; do not start one. */
const MIN_SECONDS_LEFT = 60n;

/** BattleArena.BattlePhase.Active (contract enum). */
const PHASE_ACTIVE = 4;

/** `lastError` prefixes of jobs that died WITHOUT a permanent verdict. `max_attempts_exceeded`
 *  is the worker's marker for an exhausted transient ladder. `tx_hash_persist_failed` means a
 *  submitted tx's hash could not be saved; the handler re-checks the chain phase before it
 *  submits anything, so running it again is safe whether or not that tx landed. */
const REVIVABLE_PREFIXES = ['max_attempts_exceeded:', 'tx_hash_persist_failed:'] as const;

export function isRevivable(lastError: string | null | undefined): boolean {
  if (!lastError) return false;
  const e = lastError.startsWith('revived: ') ? lastError.slice('revived: '.length) : lastError;
  return REVIVABLE_PREFIXES.some((p) => e.startsWith(p));
}

interface SettlingRow {
  id: string;
  playerA: string;
  playerB: string;
  winner: string | null;
  finalStateHash: string | null;
  turnLogHash: string | null;
  stateJson: string;
  updatedAt: Date;
}

interface JobRow {
  id: bigint;
  status: number;
  lastError: string | null;
}

export interface SettlePayload {
  battleId: string;
  winner: string;
  finalStateHash: string;
  turnLogHash: string;
  damageA: [number, number, number];
  damageB: [number, number, number];
}

/** Rebuild exactly what the API's manager would have enqueued, from the persisted session. */
export function payloadFromSession(row: SettlingRow): SettlePayload {
  if (!row.finalStateHash || !row.turnLogHash || !row.winner) {
    throw new Error(`session ${row.id} is 'settling' but has no result hashes`);
  }
  const damage = v3.repairDamage(v3.deserializeState(row.stateJson));
  return {
    battleId: row.id,
    winner: row.winner === 'draw' ? 'draw' : row.winner === 'A' ? row.playerA : row.playerB,
    finalStateHash: row.finalStateHash,
    turnLogHash: row.turnLogHash,
    damageA: damage.damageA,
    damageB: damage.damageB,
  };
}

export interface SettleReconcilerDeps {
  /** drizzle db + the two tables (select/insert/update). */
  db: any;
  battleSessions: any;
  operatorJobs: any;
  publicClient: { getBlock(args: { blockTag: 'latest' }): Promise<{ timestamp: bigint }> };
  arena: { read: { getBattle(args: [bigint]): Promise<{ phase: number | bigint; phaseDeadline: bigint }> } };
  log?: typeof baseLog;
  pollMs?: number;
  graceMs?: number;
  alarmAfterMs?: number;
  /** Server clock, for the grace/alarm ages only (never for the on-chain deadline). */
  now?: () => number;
}

export class SettleReconciler {
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly lastAlarm = new Map<string, number>();
  private readonly log;
  private readonly pollMs: number;
  private readonly graceMs: number;
  private readonly alarmAfterMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: SettleReconcilerDeps) {
    this.log = (deps.log ?? baseLog).child({ module: 'settle-reconciler' });
    this.pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
    this.graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
    this.alarmAfterMs = deps.alarmAfterMs ?? DEFAULT_ALARM_AFTER_MS;
    this.now = deps.now ?? Date.now;
  }

  /** Production wiring: real db + chain reads. Signs nothing — the operator worker does. */
  static fromEnv(): SettleReconciler {
    const chain = require('@clawbada/chain');
    const dbMod = require('@clawbada/db');
    const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
    const publicClient = chain.getPublicClient(isTestnet);
    const num = (name: string) => {
      const v = Number(process.env[name]);
      return Number.isFinite(v) && v > 0 ? v : undefined;
    };
    return new SettleReconciler({
      db: dbMod.db,
      battleSessions: dbMod.battleSessions,
      operatorJobs: dbMod.operatorJobs,
      publicClient,
      arena: chain.getBattleArena(publicClient),
      pollMs: num('SETTLE_RECONCILE_POLL_MS'),
      graceMs: num('SETTLE_RECONCILE_GRACE_MS'),
      alarmAfterMs: num('SETTLE_RECONCILE_ALARM_MS'),
    });
  }

  start(): void {
    this.interval = setInterval(() => {
      this.tick().catch((err) => this.log.error({ err }, 'settle reconciler tick failed'));
    }, this.pollMs);
    this.log.info({ pollMs: this.pollMs, graceMs: this.graceMs, alarmAfterMs: this.alarmAfterMs }, 'Settle reconciler started');
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** One pass over real sessions stuck in 'settling'. Never throws. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { db, battleSessions } = this.deps;
      const cutoff = new Date(this.now() - this.graceMs);
      const rows: SettlingRow[] = await db
        .select({
          id: battleSessions.id,
          playerA: battleSessions.playerA,
          playerB: battleSessions.playerB,
          winner: battleSessions.winner,
          finalStateHash: battleSessions.finalStateHash,
          turnLogHash: battleSessions.turnLogHash,
          stateJson: battleSessions.stateJson,
          updatedAt: battleSessions.updatedAt,
        })
        .from(battleSessions)
        .where(and(eq(battleSessions.status, 'settling'), eq(battleSessions.kind, 'real'), lt(battleSessions.updatedAt, cutoff)));

      for (const row of rows) {
        try {
          await this.reconcile(row);
        } catch (err) {
          this.log.error({ err, battleId: row.id }, 'settle reconcile failed for battle — will retry next tick');
        }
      }
      // Forget alarms for battles that are no longer stuck.
      const stuck = new Set(rows.map((r) => r.id));
      for (const id of this.lastAlarm.keys()) if (!stuck.has(id)) this.lastAlarm.delete(id);
    } finally {
      this.running = false;
    }
  }

  private async reconcile(row: SettlingRow): Promise<void> {
    const { db, operatorJobs, arena, publicClient } = this.deps;

    const onChain = await arena.read.getBattle([BigInt(row.id)]);
    if (Number(onChain.phase) !== PHASE_ACTIVE) return; // settled, proposed or cancelled — the indexer mirrors it

    const chainNow = (await publicClient.getBlock({ blockTag: 'latest' })).timestamp;
    const secondsLeft = onChain.phaseDeadline - chainNow;
    const ageMs = this.now() - row.updatedAt.getTime();

    if (secondsLeft < MIN_SECONDS_LEFT) {
      this.alarm(row.id, 'settle_window_missed', { secondsLeft: secondsLeft.toString(), ageMs });
      return;
    }

    const key = `settle_battle:${row.id}`;
    const found: JobRow[] = await db
      .select({ id: operatorJobs.id, status: operatorJobs.status, lastError: operatorJobs.lastError })
      .from(operatorJobs)
      .where(eq(operatorJobs.idempotencyKey, key))
      .limit(1);
    const job = found[0];

    if (!job) {
      const payload = payloadFromSession(row);
      await db.insert(operatorJobs).values({ jobType: 'settle_battle', payload, idempotencyKey: key }).onConflictDoNothing();
      this.log.warn({ battleId: row.id, secondsLeft: secondsLeft.toString() }, 'settle_job_recreated — a settling session had no settle job');
    } else if (job.status === JobStatus.Dead) {
      if (isRevivable(job.lastError)) {
        await db
          .update(operatorJobs)
          .set({ status: JobStatus.Pending, attempts: 0, nextAttemptAt: new Date(this.now()), completedAt: null, lastError: `revived: ${stripRevived(job.lastError)}` })
          .where(and(eq(operatorJobs.id, job.id), eq(operatorJobs.status, JobStatus.Dead)));
        this.log.warn({ battleId: row.id, jobId: job.id.toString(), lastError: job.lastError, secondsLeft: secondsLeft.toString() }, 'settle_job_revived — retries were exhausted with the settle window still open');
      } else {
        this.alarm(row.id, 'settle_job_dead_permanent', { jobId: job.id.toString(), lastError: job.lastError, secondsLeft: secondsLeft.toString() });
        return;
      }
    }

    if (ageMs >= this.alarmAfterMs) {
      this.alarm(row.id, 'settle_overdue', { ageMs, secondsLeft: secondsLeft.toString(), jobStatus: job?.status ?? 'recreated' });
    }
  }

  /** Error-level log, at most once per ALARM_REPEAT_MS per battle. Alerting keys off `msg`. */
  private alarm(battleId: string, msg: string, fields: Record<string, unknown>): void {
    const last = this.lastAlarm.get(battleId);
    if (last !== undefined && this.now() - last < ALARM_REPEAT_MS) return;
    this.lastAlarm.set(battleId, this.now());
    this.log.error({ battleId, ...fields }, msg);
  }
}

function stripRevived(lastError: string | null): string {
  if (!lastError) return '';
  return lastError.startsWith('revived: ') ? lastError.slice('revived: '.length) : lastError;
}
