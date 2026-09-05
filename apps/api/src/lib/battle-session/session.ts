/**
 * One live battle. Wraps the pure v3 engine + `reduceSession` reducer with the
 * runtime concerns: whose turn it is, the shot clock, bot think delay, event
 * emission, and per-turn persistence. Synchronous where the engine is
 * synchronous — a submit resolves the turn before it returns — while
 * persistence is queued in order and never blocks play.
 *
 * Turn numbering on the wire: the turn being played is `state.turn + 1`.
 */
import { v3 } from '@clawbada/game-logic';
import type { ShotClock } from './clock';
import {
  turnResultToWire,
  type BattleSnapshot,
  type CurrentTurn,
  type RosterEntry,
  type SessionEventName,
  type SessionKind,
  type Side,
  type SubmittedBy,
  type TurnResolvedPayload,
  type TurnStartedPayload,
  type WireTurnResult,
} from './protocol';

export interface SessionRecord {
  id: string;
  kind: SessionKind;
  tier: v3.ArenaLayout['tier'];
  /** Lowercase wallet. */
  playerA: string;
  /** Lowercase wallet, or `bot:<name>` for practice. */
  playerB: string;
  bot: v3.BotName | null;
  vrfRound: number | null;
  roster: RosterEntry[];
  createdAt: Date;
}

export interface PersistedTurn {
  turn: number;
  lobsterId: string;
  command: v3.TurnCommand | null;
  result: WireTurnResult;
  postStateHash: string;
  submittedBy: SubmittedBy;
}

export interface SnapshotWrite {
  stateJson: string;
  turn: number;
  deadline: Date | null;
  timeouts: Record<Side, number>;
}

export interface SessionHooks {
  emit(sessionId: string, event: SessionEventName, data: unknown): void;
  /** Called once per applied turn batch, after the next turn has been decided (so `snap.deadline` is final). */
  persist(session: BattleSession, turns: PersistedTurn[], snap: SnapshotWrite): Promise<void>;
  /** Called exactly once when the battle finishes (wipeout / cap / forfeit). */
  onFinished(session: BattleSession): Promise<void>;
  onError(err: unknown, ctx: Record<string, unknown>): void;
}

export interface SessionOptions {
  shotClockMs: number;
  botThinkMs: number;
  clock: ShotClock;
  hooks: SessionHooks;
  /** Side a bot controls (practice), or null. */
  botSide: Side | null;
  botPolicy: v3.Policy | null;
  /** Resume: clock for the FIRST human turn only (remaining time, floored). */
  firstTurnClockMs?: number;
}

export type SubmitResult =
  | { ok: true; result: WireTurnResult; duplicate: boolean }
  | { ok: false; code: string; message: string; turn?: number };

const RECENT_KEEP = 4;

export class BattleSession {
  status: 'active' | 'finished' = 'active';
  timeouts: v3.SessionClock;
  deadline: number | null = null;
  private stopped = false;
  private finishedHookFired = false;
  private readonly recent = new Map<number, WireTurnResult>();
  private pending: PersistedTurn[] = [];
  private persistQueue: Promise<void> = Promise.resolve();
  private firstTurnClockMs: number | undefined;

  constructor(
    public readonly record: SessionRecord,
    public readonly state: v3.AtbBattleState,
    private readonly opts: SessionOptions,
    resume?: { timeouts: Record<Side, number> },
  ) {
    this.timeouts = { timeouts: { A: resume?.timeouts.A ?? 0, B: resume?.timeouts.B ?? 0 } };
    this.firstTurnClockMs = opts.firstTurnClockMs;
    if (state.finished) this.status = 'finished';
  }

  private get key(): string {
    return `session:${this.record.id}`;
  }

  controllerOf(side: Side): string {
    if (this.opts.botSide === side) return 'bot';
    return side === 'A' ? this.record.playerA : this.record.playerB;
  }

  sideOf(address: string): Side | null {
    const a = address.toLowerCase();
    if (this.record.playerA === a) return 'A';
    if (this.record.playerB === a) return 'B';
    return null;
  }

  current(): CurrentTurn {
    if (this.state.finished) return { turn: 0, lobsterId: null, side: null, controller: null, deadline: null };
    const actor = v3.nextActor(this.state);
    if (!actor) return { turn: 0, lobsterId: null, side: null, controller: null, deadline: null };
    return {
      turn: this.state.turn + 1,
      lobsterId: actor.id,
      side: actor.team,
      controller: this.controllerOf(actor.team),
      deadline: this.opts.botSide === actor.team ? null : this.deadline,
    };
  }

  snapshot(status?: BattleSnapshot['session']['status']): BattleSnapshot {
    return {
      session: {
        id: this.record.id,
        kind: this.record.kind,
        tier: this.record.tier,
        playerA: this.record.playerA,
        playerB: this.record.playerB,
        bot: this.record.bot,
        status: status ?? this.status,
        winner: this.state.winner,
        createdAt: this.record.createdAt.getTime(),
      },
      state: v3.clientView(this.state),
      current: this.current(),
      timeouts: { ...this.timeouts.timeouts },
      roster: this.record.roster,
    };
  }

  /** Begin (or resume) driving the loop: resolves stun skips, schedules the bot, or arms the human clock. */
  start(): void {
    this.advance();
  }

  stop(): void {
    this.stopped = true;
    this.opts.clock.cancel(this.key);
  }

  /** Player submission. Validates before touching anything; a rejected command changes nothing. */
  submit(side: Side, turn: number, cmd: v3.TurnCommand): SubmitResult {
    if (this.status !== 'active' || this.state.finished) return { ok: false, code: 'finished', message: 'Battle is over' };
    const cur = this.state.turn + 1;
    if (turn < cur) {
      const r = this.recent.get(turn);
      if (r && r.lobsterId === cmd.lobsterId) return { ok: true, result: r, duplicate: true };
      return { ok: false, code: 'turn_mismatch', message: `Turn ${turn} already resolved; current turn is ${cur}`, turn: cur };
    }
    if (turn > cur) return { ok: false, code: 'turn_mismatch', message: `Turn ${turn} is not yet playable; current turn is ${cur}`, turn: cur };
    const actor = v3.nextActor(this.state);
    if (!actor) return { ok: false, code: 'finished', message: 'No living lobster' };
    if (actor.team !== side) return { ok: false, code: 'not_your_turn', message: `It is ${actor.team}'s turn`, turn: cur };
    if (this.opts.botSide === side) return { ok: false, code: 'bot_controlled', message: 'That side is played by the bot', turn: cur };
    if (v3.hasStatus(actor, 'stun')) return { ok: false, code: 'stunned', message: `${actor.id} is stunned`, turn: cur };
    try {
      v3.validateTurn(this.state, cmd); // throws TurnError; nothing mutated yet
    } catch (err) {
      if (err instanceof v3.TurnError) return { ok: false, code: err.code, message: err.message, turn: cur };
      throw err;
    }
    this.opts.clock.cancel(this.key);
    const step = this.step({ type: 'command', cmd }, 'player', cmd);
    const result = this.recent.get(step.results[0].turn)!;
    this.advance();
    return { ok: true, result, duplicate: false };
  }

  // ── internals ──

  private advance(): void {
    for (;;) {
      if (this.stopped) return;
      if (this.state.finished) {
        this.finish();
        return;
      }
      const actor = v3.nextActor(this.state);
      if (!actor) {
        this.finish();
        return;
      }
      if (v3.hasStatus(actor, 'stun')) {
        this.step({ type: 'stun_skip' }, 'stun', null);
        continue;
      }
      if (this.opts.botSide === actor.team && this.opts.botPolicy) {
        this.scheduleBot(actor);
        return;
      }
      this.armHumanTurn(actor);
      return;
    }
  }

  private armHumanTurn(actor: v3.AtbLobster): void {
    const turn = this.state.turn + 1;
    const ms = this.firstTurnClockMs ?? this.opts.shotClockMs;
    this.firstTurnClockMs = undefined;
    this.deadline = this.opts.clock.arm(this.key, ms, () => this.onTimeout(turn));
    const payload: TurnStartedPayload = {
      turn,
      lobsterId: actor.id,
      side: actor.team,
      controller: this.controllerOf(actor.team),
      deadline: this.deadline,
      bar: v3.projectBar(this.state).map((b) => ({ lobsterId: b.lobsterId, tick: b.tick.toString() })),
    };
    this.flushPersist();
    this.opts.hooks.emit(this.record.id, 'turn_started', payload);
  }

  private scheduleBot(actor: v3.AtbLobster): void {
    const turn = this.state.turn + 1;
    this.deadline = null;
    this.opts.clock.arm(this.key, this.opts.botThinkMs, () => {
      if (this.stopped || this.state.finished || this.state.turn + 1 !== turn) return;
      let cmd: v3.TurnCommand;
      try {
        cmd = this.opts.botPolicy!(this.state, actor);
        v3.validateTurn(this.state, cmd);
      } catch (err) {
        this.opts.hooks.onError(err, { sessionId: this.record.id, turn, bot: this.record.bot, where: 'bot_policy' });
        cmd = { lobsterId: actor.id, action: 'defend' };
      }
      this.step({ type: 'command', cmd }, 'bot', cmd);
      this.advance();
    });
    this.flushPersist();
    this.opts.hooks.emit(this.record.id, 'turn_started', {
      turn,
      lobsterId: actor.id,
      side: actor.team,
      controller: 'bot',
      deadline: null,
      bar: v3.projectBar(this.state).map((b) => ({ lobsterId: b.lobsterId, tick: b.tick.toString() })),
    } satisfies TurnStartedPayload);
  }

  private onTimeout(turn: number): void {
    if (this.stopped || this.state.finished || this.state.turn + 1 !== turn) return;
    try {
      this.step({ type: 'timeout' }, 'timeout', null);
    } catch (err) {
      this.opts.hooks.onError(err, { sessionId: this.record.id, turn, where: 'timeout' });
      return;
    }
    this.advance();
  }

  /** Apply one session event, emit its results, queue them for persistence. */
  private step(ev: v3.SessionEvent, by: SubmittedBy, command: v3.TurnCommand | null): v3.SessionStep {
    const logBefore = this.state.log.length;
    const step = v3.reduceSession(this.state, this.timeouts, ev);
    this.timeouts = step.clock;
    step.results.forEach((r, i) => {
      const isForfeit = r.lobsterId === '' && r.finished; // forfeit terminator (no scheduled turn)
      const turnNo = isForfeit ? this.state.turn + 1 : r.turn;
      const wire = turnResultToWire(r);
      const submittedBy: SubmittedBy = isForfeit ? 'forfeit' : by;
      this.recent.set(turnNo, wire);
      if (this.recent.size > RECENT_KEEP) this.recent.delete(Math.min(...this.recent.keys()));
      // One log entry per result (a timeout that trips the forfeit appends two).
      const postStateHash = this.state.log[logBefore + i]?.postStateHash ?? v3.hashState(this.state);
      this.opts.hooks.emit(this.record.id, 'turn_committed', { turn: turnNo, lobsterId: r.lobsterId, by: submittedBy });
      const resolved: TurnResolvedPayload = {
        turn: turnNo,
        result: wire,
        submittedBy,
        postStateHash,
        deaths: r.damage.filter((d) => d.killed).map((d) => d.targetId),
        hp: Object.fromEntries(this.state.lobsters.map((l) => [l.id, { hp: l.hp.toString(), maxHp: l.maxHp.toString(), alive: l.alive }])),
        nextActorId: this.state.finished ? null : v3.nextActor(this.state)?.id ?? null,
      };
      this.opts.hooks.emit(this.record.id, 'turn_resolved', resolved);
      if (!this.state.finished) this.opts.hooks.emit(this.record.id, 'bar_updated', { turn: turnNo, bar: wire.bar });
      this.pending.push({ turn: turnNo, lobsterId: r.lobsterId, command: i === 0 ? command : null, result: wire, postStateHash, submittedBy });
    });
    return step;
  }

  private flushPersist(): void {
    if (this.pending.length === 0 && this.deadline === null && this.state.turn === 0) return;
    const turns = this.pending;
    this.pending = [];
    const snap: SnapshotWrite = {
      stateJson: v3.serializeState(this.state),
      turn: this.state.turn,
      deadline: this.deadline !== null && !this.state.finished ? new Date(this.deadline) : null,
      timeouts: { ...this.timeouts.timeouts },
    };
    this.persistQueue = this.persistQueue
      .then(() => this.opts.hooks.persist(this, turns, snap))
      .catch((err) => this.opts.hooks.onError(err, { sessionId: this.record.id, where: 'persist', turns: turns.map((t) => t.turn) }));
  }

  /** Await everything queued so far (tests / shutdown). */
  async flushed(): Promise<void> {
    await this.persistQueue;
  }

  private finish(): void {
    if (this.finishedHookFired) return;
    this.finishedHookFired = true;
    this.status = 'finished';
    this.deadline = null;
    this.opts.clock.cancel(this.key);
    this.flushPersist();
    this.persistQueue = this.persistQueue
      .then(() => this.opts.hooks.onFinished(this))
      .catch((err) => this.opts.hooks.onError(err, { sessionId: this.record.id, where: 'onFinished' }));
  }
}

/** Why the battle ended, from the final state + log. */
export function endReason(state: v3.AtbBattleState): 'wipeout' | 'turn_cap' | 'forfeit' {
  const last = state.log[state.log.length - 1];
  if (last?.action === 'forfeit') return 'forfeit';
  const aAlive = state.lobsters.some((l) => l.team === 'A' && l.alive);
  const bAlive = state.lobsters.some((l) => l.team === 'B' && l.alive);
  if (!aAlive || !bAlive) return 'wipeout';
  return 'turn_cap';
}
