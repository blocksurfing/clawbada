/**
 * Housekeeping for the off-chain game: old practice and friend battles, their turns, and old invite rooms.
 *
 * Nothing used to delete them, so the tables only ever grew (about 25 KB per battle). Practice and friend battles
 * are just for fun — no stake, no rating — so nothing needs one once it is old: after OFFCHAIN_RETENTION_DAYS
 * (default 30, long enough to look into a player's report) a pass removes
 *   - `battle_sessions` of kind 'practice' / 'friend' that are over ('finished' / 'abandoned'), with their
 *     `battle_turns`;
 *   - `friend_rooms` nobody has touched since, unless the room's battle is somehow still live.
 * A REAL battle (kind 'real') is never touched here: its session and turn log are the evidence behind an on-chain
 * settlement. A battle that is still 'active' is never touched either, however old its row.
 *
 * The pass runs a few minutes after boot and then every few hours (a daily timer might never fire on a service
 * that is redeployed often). It works in small batches with a pause between them and stops at a cap, so a large
 * backlog is spread over several passes instead of holding the database (a pool of 5) for one long delete.
 *
 *   OFFCHAIN_RETENTION_DAYS   days to keep a finished off-chain battle and its room; 0 or "off" disables the pass.
 *
 * This file is the policy and the timer; the SQL is in retention-store.ts.
 */
import { log as baseLog } from '../logger';

const log = baseLog.child({ module: 'retention' });

export const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

/** Rows per batch (sessions, then rooms) and batches per pass: at most 10,000 of each per pass. */
const BATCH = 500;
const MAX_BATCHES = 20;
const BATCH_PAUSE_MS = 250;
/** First pass after boot — late enough that a rollout's old instance is gone — and the gap between passes. */
const FIRST_PASS_MS = 3 * 60_000;
const PASS_INTERVAL_MS = 6 * 60 * 60_000;

/** Days to keep, from the environment: 0 (or "off") = never delete; anything unreadable = the default. */
export function retentionDaysFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.OFFCHAIN_RETENTION_DAYS ?? '').trim().toLowerCase();
  if (raw === '') return DEFAULT_RETENTION_DAYS;
  if (raw === 'off') return 0;
  const days = Number(raw);
  return Number.isInteger(days) && days >= 0 ? days : DEFAULT_RETENTION_DAYS;
}

export interface RetentionStore {
  /** Delete up to `limit` finished off-chain battles last written before `olderThan`, each with its turns. */
  purgeSessions(olderThan: Date, limit: number): Promise<{ sessions: number; turns: number }>;
  /** Delete up to `limit` invite rooms last written before `olderThan`. */
  purgeRooms(olderThan: Date, limit: number): Promise<number>;
}

export interface RetentionPass {
  sessions: number;
  turns: number;
  rooms: number;
  /** True when the pass stopped at its cap with more left: the next pass carries on. */
  capped: boolean;
}

export interface RetentionOptions {
  days: number;
  now?: Date;
  batch?: number;
  maxBatches?: number;
  /** Wait between batches; tests pass a no-op. */
  pause?: () => Promise<void>;
  /** Asked before every batch: true ends the pass early (shutdown), leaving the rest for the next one. */
  stopped?: () => boolean;
}

/** One pass: battles (with turns) first, then rooms, each in batches until a short batch or the cap. */
export async function purgeOnce(store: RetentionStore, opts: RetentionOptions): Promise<RetentionPass> {
  const pass: RetentionPass = { sessions: 0, turns: 0, rooms: 0, capped: false };
  if (opts.days <= 0) return pass;
  const olderThan = new Date((opts.now ?? new Date()).getTime() - opts.days * DAY_MS);
  const batch = opts.batch ?? BATCH;
  const maxBatches = opts.maxBatches ?? MAX_BATCHES;
  const pause = opts.pause ?? (() => new Promise<void>((r) => setTimeout(r, BATCH_PAUSE_MS)));
  const stopped = opts.stopped ?? (() => false);

  const drain = async (step: () => Promise<number>): Promise<void> => {
    for (let i = 0; i < maxBatches; i++) {
      if (stopped() || (await step()) < batch) return;
      await pause();
    }
    pass.capped = true;
  };
  await drain(async () => {
    const n = await store.purgeSessions(olderThan, batch);
    pass.sessions += n.sessions;
    pass.turns += n.turns;
    return n.sessions;
  });
  await drain(async () => {
    const n = await store.purgeRooms(olderThan, batch);
    pass.rooms += n;
    return n;
  });
  return pass;
}

// ──────────── Ticker ────────────

let firstHandle: ReturnType<typeof setTimeout> | null = null;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
/** Set by stop(): a pass in flight ends after its current batch instead of querying a pool that is draining. */
let stopping = false;

async function runPass(store: RetentionStore, days: number): Promise<void> {
  if (inFlight || stopping) return;
  inFlight = true;
  const t0 = Date.now();
  try {
    const pass = await purgeOnce(store, { days, stopped: () => stopping });
    if (pass.sessions || pass.rooms || pass.capped) log.info({ ...pass, days, ms: Date.now() - t0 }, 'retention_purged');
  } catch (err) {
    log.warn({ err, days }, 'retention_failed');   // the next pass tries again
  } finally {
    inFlight = false;
  }
}

/** Start the housekeeping passes. Idempotent; does nothing when retention is switched off. */
export function startRetentionTicker(store: RetentionStore, days = retentionDaysFromEnv()): void {
  if (firstHandle !== null || intervalHandle !== null) return;
  if (days <= 0) {
    log.info('retention off (OFFCHAIN_RETENTION_DAYS)');
    return;
  }
  stopping = false;
  log.info({ days, firstPassMs: FIRST_PASS_MS, intervalMs: PASS_INTERVAL_MS }, 'retention ticker started');
  firstHandle = setTimeout(() => void runPass(store, days), FIRST_PASS_MS);
  intervalHandle = setInterval(() => void runPass(store, days), PASS_INTERVAL_MS);
}

/** Stop the passes. Used by tests and graceful shutdown; a batch already running commits or rolls back whole. */
export function stopRetentionTicker(): void {
  if (firstHandle !== null) clearTimeout(firstHandle);
  if (intervalHandle !== null) clearInterval(intervalHandle);
  firstHandle = null;
  intervalHandle = null;
  stopping = true;
}
