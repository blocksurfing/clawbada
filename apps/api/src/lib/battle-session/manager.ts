/**
 * BattleSessionManager — owns every live BattleSession in this API process.
 *
 *   - real battles: a 2 s poller picks up `battles` rows the indexer mirrored to
 *     Active (phase 4) with no session yet, claims each by inserting its
 *     `battle_sessions` row (PK = chain id, so two replicas cannot both start it),
 *     loads the two revealed teams from chain, rolls one drand beacon as the VRF
 *     seed, and starts the loop. On finish it enqueues `settle_battle` for the
 *     engine's operator worker.
 *   - practice battles: created on demand by the API route; off-chain only.
 *   - resume(): on boot, every 'active' row is deserialized and its clock re-armed.
 *
 * Follows the boost service template: setInterval + inFlight guard + try/catch
 * that never throws out of a tick; every external dependency is injected.
 */
import { randomUUID, getRandomValues } from 'node:crypto';
import { v3, deriveRandom, type EvolutionTier, type LobsterClass } from '@clawbada/game-logic';
import { ShotClock } from './clock';
import type { BattleSnapshot, RosterEntry, SessionEventName, Side } from './protocol';
import { BattleSession, endReason, type SessionRecord } from './session';
import type { SessionRow, SessionStore, SettleJobPayload } from './store';

export interface ManagerChain {
  readTeam(teamId: bigint): Promise<{ owner: string; lobsterIds: readonly bigint[] }>;
  readLobster(tokenId: bigint): Promise<{ tokenId: bigint; owner: string; dna: bigint; evolutionTier: number; purity: number }>;
  /** Optional: used on resume to drop sessions whose battle is no longer Active on chain. */
  readBattlePhase?(battleId: bigint): Promise<number>;
}

export interface ManagerLog {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface ManagerDeps {
  store: SessionStore;
  emit: (sessionId: string, event: SessionEventName, data: unknown) => void;
  chain: ManagerChain;
  drand: { fetchLatest(): Promise<{ round: number; randomness: string }>; toBigInt(randomness: string): bigint };
  log: ManagerLog;
  clock?: ShotClock;
  shotClockMs?: number;
  botThinkMs?: number;
  pollMs?: number;
  /** Test hook: deterministic practice seeds. */
  randomSeed?: () => bigint;
  layoutById?: (id: string) => v3.ArenaLayout | undefined;
}

export interface PracticeLobster {
  input: v3.LobsterInput;
  tokenId?: string;
  partClassIds?: number[];
}

export interface StartPracticeOptions {
  owner: string;
  lobsters: PracticeLobster[];
  bot: v3.BotName;
  opponent: 'mirror' | 'random';
  layoutId?: string;
}

export const DEFAULT_SHOT_CLOCK_MS = 60_000;
export const DEFAULT_BOT_THINK_MS = 800;
export const DEFAULT_POLL_MS = 2_000;
/** A resumed human turn always gets at least this long, even if its deadline had passed. */
export const RESUME_MIN_CLOCK_MS = 5_000;

const TIER_NAMES: Record<number, v3.ArenaLayout['tier']> = { 0: 'evolved', 1: 'evolved', 2: 'elite', 3: 'apex' };

export function arenaTierFor(inputs: v3.LobsterInput[]): v3.ArenaLayout['tier'] {
  const min = Math.min(...inputs.map((l) => Number(l.tier)));
  return TIER_NAMES[min] ?? 'evolved';
}

function rosterInputs(roster: RosterEntry[]): v3.LobsterInput[] {
  return roster.map((r) => ({ id: r.id, class: r.classId as LobsterClass, tier: r.tier as EvolutionTier, purity: r.purity, legend: r.legend }));
}

function randomSeed(): bigint {
  const bytes = getRandomValues(new Uint8Array(32));
  return BigInt('0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''));
}

export class BattleSessionManager {
  private readonly sessions = new Map<string, BattleSession>();
  private readonly clock: ShotClock;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private readonly shotClockMs: number;
  private readonly botThinkMs: number;
  private readonly pollMs: number;

  constructor(private readonly deps: ManagerDeps) {
    this.clock = deps.clock ?? new ShotClock();
    this.shotClockMs = deps.shotClockMs ?? DEFAULT_SHOT_CLOCK_MS;
    this.botThinkMs = deps.botThinkMs ?? DEFAULT_BOT_THINK_MS;
    this.pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  }

  /** Resume persisted sessions, then poll for newly Active real battles. */
  async start(): Promise<void> {
    try {
      const n = await this.resume();
      this.deps.log.info({ resumed: n }, 'battle_sessions_resumed');
    } catch (err) {
      this.deps.log.error({ err }, 'battle_sessions_resume_failed');
    }
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.pollOnce(), this.pollMs);
    this.deps.log.info({ pollMs: this.pollMs, shotClockMs: this.shotClockMs, botThinkMs: this.botThinkMs }, 'battle_session_manager_started');
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const s of this.sessions.values()) s.stop();
    this.clock.clearAll();
  }

  get(id: string): BattleSession | undefined {
    return this.sessions.get(id);
  }

  liveCount(): number {
    return this.sessions.size;
  }

  snapshotFor(id: string): BattleSnapshot | null {
    return this.sessions.get(id)?.snapshot() ?? null;
  }

  /** Participant check that also works for sessions not held in memory (finished / other replica). */
  async isParticipant(id: string, address: string): Promise<boolean> {
    const a = address.toLowerCase();
    const live = this.sessions.get(id);
    if (live) return live.sideOf(a) !== null;
    const row = await this.deps.store.get(id);
    return !!row && (row.playerA === a || row.playerB === a);
  }

  /** Route a player's command. Untrusted `rawCmd` is parsed here. */
  submit(id: string, address: string, turn: number, rawCmd: unknown): ReturnType<BattleSession['submit']> {
    const session = this.sessions.get(id);
    if (!session) return { ok: false, code: 'session_not_found', message: 'No live battle with that id' };
    const side = session.sideOf(address);
    if (!side) return { ok: false, code: 'not_participant', message: 'You are not a participant in this battle' };
    const cmd = v3.parseTurnCommand(rawCmd);
    if (!cmd) return { ok: false, code: 'bad_command', message: 'Malformed turn command' };
    return session.submit(side, turn, cmd);
  }

  // ── practice ──

  async startPractice(opts: StartPracticeOptions): Promise<BattleSession> {
    const owner = opts.owner.toLowerCase();
    if (opts.lobsters.length !== 3) throw new Error('practice needs exactly 3 lobsters');
    const existing = await this.deps.store.activePracticeFor(owner);
    if (existing) throw new PracticeConflictError(existing.id);

    const id = `p_${randomUUID()}`;
    const vrfSeed = (this.deps.randomSeed ?? randomSeed)();
    const teamA = opts.lobsters.map((l) => ({ ...l.input }));
    const tier = arenaTierFor(teamA);
    const teamB: v3.LobsterInput[] = teamA.map((l, i) => ({ id: `bot-${i}`, class: l.class, tier: l.tier, purity: l.purity, legend: false }));
    if (opts.opponent === 'random') {
      for (let i = 0; i < 3; i++) teamB[i].class = Number(deriveClass(vrfSeed, i)) as LobsterClass;
    }
    const layout = opts.layoutId ? this.deps.layoutById?.(opts.layoutId) : undefined;
    if (opts.layoutId && !layout) throw new Error(`unknown layout ${opts.layoutId}`);
    const state = v3.createBattle({ battleId: id, vrfSeed, tier, teamA, teamB, layout });

    const roster: RosterEntry[] = [
      ...opts.lobsters.map((l, i) => ({ id: l.input.id, side: 'A' as Side, slot: i, classId: l.input.class, tier: l.input.tier, purity: l.input.purity, legend: !!l.input.legend, owner, ...(l.partClassIds ? { partClassIds: l.partClassIds } : {}), ...(l.tokenId ? { tokenId: l.tokenId } : {}) })),
      ...teamB.map((l, i) => ({ id: l.id, side: 'B' as Side, slot: i, classId: l.class, tier: l.tier, purity: l.purity, legend: false, owner: `bot:${opts.bot}` })),
    ];
    const record: SessionRecord = { id, kind: 'practice', tier, playerA: owner, playerB: `bot:${opts.bot}`, bot: opts.bot, vrfRound: null, roster, createdAt: new Date() };
    const inserted = await this.deps.store.insertSession({
      id, kind: 'practice', playerA: owner, playerB: record.playerB, bot: opts.bot, tier, vrfRound: null, roster,
      stateJson: v3.serializeState(state), turn: 0, deadline: null, timeouts: { A: 0, B: 0 }, status: 'active',
    });
    if (!inserted) throw new Error('practice id collision');
    return this.launch(record, state, { botSide: 'B', botPolicy: v3.botPolicy(opts.bot) });
  }

  // ── real battles ──

  async pollOnce(): Promise<number> {
    if (this.inFlight) return 0;
    this.inFlight = true;
    let started = 0;
    try {
      const pending = await this.deps.store.pendingRealBattles(10);
      for (const row of pending) {
        try {
          if (await this.startReal(row)) started++;
        } catch (err) {
          this.deps.log.error({ err, battleId: row.battleId.toString() }, 'battle_session_start_failed');
        }
      }
    } catch (err) {
      this.deps.log.error({ err }, 'battle_session_poll_failed');
    } finally {
      this.inFlight = false;
    }
    return started;
  }

  /** Claim + start one Active on-chain battle. Returns null when another replica claimed it. */
  async startReal(row: { battleId: bigint; playerA: string; playerB: string; teamA: bigint; teamB: bigint }): Promise<BattleSession | null> {
    const id = row.battleId.toString();
    if (this.sessions.has(id)) return null;
    if (row.teamA === 0n || row.teamB === 0n) {
      this.deps.log.warn({ battleId: id }, 'battle_active_without_team_ids');
      return null;
    }
    const playerA = row.playerA.toLowerCase();
    const playerB = row.playerB.toLowerCase();
    const claimed = await this.deps.store.insertSession({
      id, kind: 'real', playerA, playerB, bot: null, tier: 'evolved', vrfRound: null, roster: [],
      stateJson: '', turn: 0, deadline: null, timeouts: { A: 0, B: 0 }, status: 'active',
    });
    if (!claimed) return null;

    try {
      const [teamA, teamB] = await Promise.all([this.deps.chain.readTeam(row.teamA), this.deps.chain.readTeam(row.teamB)]);
      const load = async (ids: readonly bigint[], side: Side, owner: string) => {
        const lobs = await Promise.all(ids.map((tid) => this.deps.chain.readLobster(tid)));
        return lobs.map((l, slot) => {
          const input = v3.lobsterInputFromChain({ tokenId: l.tokenId, dna: l.dna, evolutionTier: l.evolutionTier, purity: l.purity });
          const entry: RosterEntry = { id: input.id, side, slot, classId: input.class, tier: input.tier, purity: input.purity, legend: !!input.legend, owner: owner.toLowerCase(), partClassIds: v3.partClassIds(l.dna), tokenId: l.tokenId.toString() };
          return { input, entry };
        });
      };
      const [a, b] = await Promise.all([load(teamA.lobsterIds, 'A', teamA.owner), load(teamB.lobsterIds, 'B', teamB.owner)]);
      const inputsA = a.map((x) => x.input);
      const inputsB = b.map((x) => x.input);
      const tier = arenaTierFor([...inputsA, ...inputsB]);
      const beacon = await this.deps.drand.fetchLatest();
      const vrfSeed = this.deps.drand.toBigInt(beacon.randomness);
      const state = v3.createBattle({ battleId: id, vrfSeed, tier, teamA: inputsA, teamB: inputsB });
      const roster = [...a.map((x) => x.entry), ...b.map((x) => x.entry)];
      await this.deps.store.initSession(id, { tier, roster, stateJson: v3.serializeState(state), vrfRound: beacon.round });
      const record: SessionRecord = { id, kind: 'real', tier, playerA, playerB, bot: null, vrfRound: beacon.round, roster, createdAt: new Date() };
      this.deps.log.info({ battleId: id, tier, vrfRound: beacon.round }, 'battle_session_started');
      return this.launch(record, state, { botSide: null, botPolicy: null });
    } catch (err) {
      // Release the claim so the next poll retries (chain/drand hiccups are transient).
      await this.deps.store.deleteSession(id).catch(() => undefined);
      throw err;
    }
  }

  /** Rebuild every 'active' row after a restart. */
  async resume(): Promise<number> {
    const rows = await this.deps.store.loadActive();
    let n = 0;
    for (const row of rows) {
      try {
        if (!row.stateJson) {
          // A claim whose chain load never completed: let the poller retry it.
          await this.deps.store.deleteSession(row.id);
          continue;
        }
        if (row.kind === 'real' && this.deps.chain.readBattlePhase) {
          const phase = await this.deps.chain.readBattlePhase(BigInt(row.id));
          if (phase !== 4) {
            await this.deps.store.markStatus(row.id, 'abandoned');
            this.deps.log.warn({ battleId: row.id, phase }, 'battle_session_abandoned_on_resume');
            continue;
          }
        }
        const state = v3.deserializeState(row.stateJson);
        const record = this.recordFromRow(row);
        const timeouts = (row.timeouts as Record<Side, number>) ?? { A: 0, B: 0 };
        const remaining = row.deadline ? row.deadline.getTime() - this.clock.now() : null;
        const bot = row.kind === 'practice' && row.bot && v3.isBotName(row.bot) ? { botSide: 'B' as Side, botPolicy: v3.botPolicy(row.bot) } : { botSide: null, botPolicy: null };
        this.launch(record, state, bot, { timeouts, firstTurnClockMs: remaining === null ? undefined : Math.max(remaining, RESUME_MIN_CLOCK_MS) });
        n++;
      } catch (err) {
        this.deps.log.error({ err, sessionId: row.id }, 'battle_session_resume_failed');
      }
    }
    return n;
  }

  // ── internals ──

  private recordFromRow(row: SessionRow): SessionRecord {
    return {
      id: row.id,
      kind: row.kind as SessionRecord['kind'],
      tier: row.tier as v3.ArenaLayout['tier'],
      playerA: row.playerA,
      playerB: row.playerB,
      bot: row.bot && v3.isBotName(row.bot) ? row.bot : null,
      vrfRound: row.vrfRound,
      roster: row.roster as RosterEntry[],
      createdAt: row.createdAt,
    };
  }

  private launch(record: SessionRecord, state: v3.AtbBattleState, bot: { botSide: Side | null; botPolicy: v3.Policy | null }, resume?: { timeouts: Record<Side, number>; firstTurnClockMs?: number }): BattleSession {
    const session = new BattleSession(
      record,
      state,
      {
        shotClockMs: this.shotClockMs,
        botThinkMs: this.botThinkMs,
        clock: this.clock,
        botSide: bot.botSide,
        botPolicy: bot.botPolicy,
        firstTurnClockMs: resume?.firstTurnClockMs,
        hooks: {
          emit: this.deps.emit,
          persist: (s, turns, snap) => this.deps.store.writeTurns(s.record.id, turns, snap),
          onFinished: (s) => this.onFinished(s),
          onError: (err, ctx) => this.deps.log.error({ err, ...ctx }, 'battle_session_error'),
        },
      },
      resume ? { timeouts: resume.timeouts } : undefined,
    );
    this.sessions.set(record.id, session);
    session.start();
    return session;
  }

  private async onFinished(session: BattleSession): Promise<void> {
    const { state, record } = session;
    const winner = state.winner ?? 'draw';
    const finalStateHash = v3.hashState(state);
    const turnLogHash = v3.turnLogHash(state, rosterInputs(record.roster));
    const reason = endReason(state);
    const isReal = record.kind === 'real';
    let damage: ReturnType<typeof v3.repairDamage> | undefined;
    if (isReal) {
      damage = v3.repairDamage(state);
      const payload: SettleJobPayload = {
        battleId: record.id,
        winner: winner === 'draw' ? 'draw' : winner === 'A' ? record.playerA : record.playerB,
        finalStateHash,
        turnLogHash,
        damageA: damage.damageA,
        damageB: damage.damageB,
      };
      await this.deps.store.markFinished(record.id, { status: 'settling', winner, finalStateHash, turnLogHash, stateJson: v3.serializeState(state), turn: state.turn });
      await this.deps.store.enqueueSettle(payload);
    } else {
      await this.deps.store.markFinished(record.id, { status: 'finished', winner, finalStateHash, turnLogHash, stateJson: v3.serializeState(state), turn: state.turn });
    }
    this.deps.emit(record.id, 'battle_ended', { winner, reason, finalStateHash, turnLogHash, ...(damage ? { damage } : {}), settle: isReal ? 'queued' : 'n/a' });
    this.deps.log.info({ sessionId: record.id, kind: record.kind, winner, reason, turns: state.turn }, 'battle_session_finished');
    this.sessions.delete(record.id);
  }
}

export class PracticeConflictError extends Error {
  constructor(public readonly existingId: string) {
    super(`an active practice battle already exists: ${existingId}`);
    this.name = 'PracticeConflictError';
  }
}

/** Seeded random class for 'random' practice opponents (0–9). */
function deriveClass(seed: bigint, slot: number): bigint {
  return deriveRandom(seed, `practice_bot_${slot}`) % 10n;
}
