/**
 * Boost epoch service — the periodic driver for `runEpochJob` (SeasonManager template:
 * setInterval + try/catch, never throws out of a tick).
 *
 * The epoch clock is resolved lazily: the anchor comes from BOOST_EPOCH_ANCHOR_TS or the
 * indexed season-1 start, and on a fresh deploy the latter may not exist yet. A missing
 * anchor is a warning and a retry on the next tick, not an engine crash.
 */
import { log as baseLog } from '../logger';
import type { EpochClock } from './epoch-clock';
import { runEpochJob, type BoostChain, type EpochJobLog } from './epoch-job';
import type { Database } from '@clawbada/db';

export const BOOST_EPOCH_TICK_MS = 60_000;

export interface BoostEpochServiceDeps {
  db: Database;
  chain: BoostChain;
  /** Resolves the clock; called every tick until it succeeds, then cached. */
  clockFactory: () => Promise<EpochClock>;
  now?: () => Date;
  log?: EpochJobLog;
}

export class BoostEpochService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private clock: EpochClock | null = null;
  /** A tick that outlives the interval (slow RPC, big ladder) must not overlap the next. */
  private inFlight = false;
  private readonly log: EpochJobLog;
  private readonly now: () => Date;

  constructor(private readonly deps: BoostEpochServiceDeps) {
    this.log = deps.log ?? baseLog.child({ module: 'boost-epoch' });
    this.now = deps.now ?? (() => new Date());
  }

  /** Run once immediately (announce rows at boot), then every `intervalMs`. */
  start(intervalMs: number = BOOST_EPOCH_TICK_MS): void {
    if (this.timer !== null) {
      this.log.warn({}, 'boost_epoch_service_already_started');
      return;
    }
    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
    void this.runOnce();
    this.log.info({ intervalMs }, 'boost_epoch_service_started');
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    this.log.info({}, 'boost_epoch_service_stopped');
  }

  /** One tick. Returns true when the job ran to completion. */
  async runOnce(): Promise<boolean> {
    if (this.inFlight) return false;
    this.inFlight = true;
    try {
      if (this.clock === null) {
        try {
          this.clock = await this.deps.clockFactory();
          this.log.info({ anchorMs: this.clock.anchorMs, anchor: new Date(this.clock.anchorMs) }, 'boost_epoch_clock_ready');
        } catch (err) {
          this.log.warn({ err }, 'boost_epoch_anchor_unavailable');
          return false;
        }
      }
      await runEpochJob({ db: this.deps.db, clock: this.clock, chain: this.deps.chain, now: this.now, log: this.log });
      return true;
    } catch (err) {
      this.log.error({ err }, 'boost_epoch_tick_failed');
      return false;
    } finally {
      this.inFlight = false;
    }
  }
}
