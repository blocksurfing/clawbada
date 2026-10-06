/**
 * The battle WATCHDOG (owner decision 2026-10-01: player disputes removed).
 *
 * `BattleArena.settle` records a result, applies the repair damage and releases both teams at
 * once; only the money waits, for a per-bracket review window (`payoutDeadline`: 5 min Low /
 * 30 min Mid / 1 h High). This watcher is what makes that window mean something:
 *
 * 1. IN REVIEW (phase 5). For every result it re-plays the battle from this server's own
 *    session record (`v3.reproduceSession`: fresh state from roster + seed + layout + rules,
 *    every logged turn re-executed against its recorded hash) and checks that the chain was told
 *    exactly that battle: winner, forfeiter, both damage arrays, `finalStateHash`, `turnLogHash`.
 *    It also runs `judgeProposal` (no session at all, or a session still being played, means the
 *    honest settle job cannot have produced the result).
 *      - Anything it cannot reproduce → `freeze(battleId)` with the GUARDIAN key, before the
 *        deadline, and an error log `battle_frozen` (alerting keys off the message).
 *      - Clean → after the deadline (CHAIN time), the permissionless `finalizeBattle`.
 * 2. FROZEN (phase 8). The Safe decides (`resolveFrozen`). The watcher pages
 *    `battle_frozen_awaiting_safe` periodically and `battle_freeze_long_stop_due` as
 *    `frozenAt + 72 h` approaches; once the long-stop has passed and nobody has acted, it calls
 *    the permissionless `expireFrozen` itself (stakes burned, both players paid back from the
 *    refund reserve — or the held stakes returned if the reserve is short).
 * 3. LAPSED (phases 1, 3, 4). A deposit nobody completed, a reveal that never came, an Active
 *    battle the resolver did not settle inside ACTIVE_WINDOW: once `phaseDeadline` has passed the
 *    watcher calls the permissionless `handleTimeout` so the refunds (and a D-14 slash) happen
 *    without waiting for a player to click (L3).
 *
 * The safety net must not fail open quietly (review 2026-10-03, section C):
 *   - Two sources of work: the indexer's mirror (`battles.phase`) AND the chain's own
 *     `BattleProposed` / `BattleFrozen` logs over the last LOG_LOOKBACK_BLOCKS, merged by id — a
 *     stalled indexer cannot hide a result from review (M4). Every tick logs `watchdog_heartbeat`.
 *   - A freeze that cannot be sent (no key, no role, no gas, RPC down) is a FATAL
 *     `battle_freeze_failed` on every attempt (M3); the guardian key is preflighted at boot and
 *     hourly (`guardian_preflight_failed`): GUARDIAN_ROLE held, ETH for gas.
 *   - A judge that throws is a verdict (`judge_threw`, → freeze), never a silent retry (M2b).
 *   - Results are judged earliest deadline first, the whole freeze pass runs before any payout,
 *     and no receipt is awaited inline — a slow transaction never delays the next freeze (C-L1).
 *   - `finalize_overdue` / `expire_failed` page when the permissionless calls keep not landing;
 *     a frozen battle keeps paging past its long-stop (C-L2).
 *
 * Chain time (latest block timestamp), not the server's wall clock, decides every deadline:
 * the contract judges by block.timestamp, and the two diverge on a local chain with time travel.
 * The indexer mirrors the resulting events; this watcher writes nothing to the DB.
 */
import { and, inArray, isNull, eq } from 'drizzle-orm';
import { zeroAddress, keccak256, stringToBytes, formatEther } from 'viem';
import { BattlePhase, v3 } from '@clawbada/game-logic';
import { judgeProposal, isRogueVerdict, type SessionResult } from '@clawbada/db/src/queries/proposal-verdict';
import { log as baseLog } from '../logger';

const DEFAULT_POLL_MS = 10_000;
const IN_REVIEW = BattlePhase.AwaitingFinalize;
const FROZEN = BattlePhase.Frozen;
/** Phases whose `phaseDeadline` `handleTimeout` enforces (L3 sweep). */
const LAPSABLE = [BattlePhase.Deposit, BattlePhase.TeamReveal, BattlePhase.Active] as const;

/** BattleArena.FREEZE_LONG_STOP. */
export const FREEZE_LONG_STOP_SEC = 72n * 3600n;
/** Start paging `battle_freeze_long_stop_due` this long before the long-stop. */
export const LONG_STOP_WARN_SEC = 12n * 3600n;
/** Re-page a frozen battle at most this often (ms). */
export const FROZEN_ALARM_REPEAT_MS = 60 * 60_000;
/** BattleArena.GUARDIAN_ROLE. */
export const GUARDIAN_ROLE: `0x${string}` = keccak256(stringToBytes('GUARDIAN_ROLE'));
/** PauseSwitch.PAUSER_ROLE — the same guardian key is the protocol's emergency stop (PAUSE-I1). */
export const PAUSER_ROLE: `0x${string}` = keccak256(stringToBytes('PAUSER_ROLE'));
/** The guardian key must hold at least this much ETH, or a freeze will fail for gas (M3). */
export const MIN_GUARDIAN_BALANCE_WEI = 2_000_000_000_000_000n; // 0.002 ether
/** Re-check the guardian key this often after boot. */
export const PREFLIGHT_INTERVAL_MS = 60 * 60_000;
/** Second source (M4): BattleProposed / BattleFrozen logs over this many trailing blocks (~70 min on Base). */
export const LOG_LOOKBACK_BLOCKS = 2_000n;
/** C-L2: a clean battle still unfinalized (or a frozen one still unexpired) this many ticks past its deadline is paged. */
export const OVERDUE_TICKS = 6;
/** A session read that fails with less than this long left in the window fails CLOSED (freeze). */
export const JUDGE_GRACE_SEC = 60n;
/** Chain reads in flight at once. */
const READ_CONCURRENCY = 4;

/** The session row the watchdog needs (`battle_sessions`). */
export interface WatchdogSession extends SessionResult {
  id: string;
  tier: string;
  roster: unknown;
  stateJson: string;
}

/** The parts of `getBattle` the watchdog reads. */
export interface OnChainResult {
  phase: number | bigint;
  playerA: string;
  playerB: string;
  proposedWinner: string;
  proposedForfeiter: string;
  proposedDamageA: readonly (number | bigint)[];
  proposedDamageB: readonly (number | bigint)[];
  finalStateHash: string;
  turnLogHash: string;
  /** Deposit / reveal / Active deadline (phases 1, 3, 4). */
  phaseDeadline: bigint;
  payoutDeadline: bigint;
  frozenAt: number | bigint;
}

export type SettlementJudgement = { clean: true } | { clean: false; reason: string };

/**
 * Pure: is the result on-chain the battle this server ran, re-played from scratch? Every
 * "cannot tell" is NOT clean, on purpose — a false freeze costs the Safe one look; a missed one
 * pays a thief the pot, irreversibly.
 */
export function judgeSettlement(session: WatchdogSession | null | undefined, onChain: OnChainResult): SettlementJudgement {
  const verdict = judgeProposal(session, {
    proposedWinner: onChain.proposedWinner,
    proposedFinalStateHash: onChain.finalStateHash,
    proposedTurnLogHash: onChain.turnLogHash,
  });
  if (isRogueVerdict(verdict)) return { clean: false, reason: verdict };

  const repro = v3.reproduceSession({
    battleId: session!.id,
    tier: session!.tier,
    roster: session!.roster as v3.StoredRosterEntry[],
    stateJson: session!.stateJson,
  });
  if (!repro.ok) return { clean: false, reason: `replay_failed: ${repro.reason}` };

  const lc = (a: string | null | undefined) => (a ?? '').toLowerCase();
  const wallet = (side: 'A' | 'B' | null) => (side === 'A' ? lc(onChain.playerA) : side === 'B' ? lc(onChain.playerB) : zeroAddress);
  const winner = repro.winner === 'draw' ? zeroAddress : wallet(repro.winner);
  const sameDamage = (a: readonly (number | bigint)[], b: readonly number[]) => a.length === b.length && a.every((v, i) => Number(v) === b[i]);

  if (lc(onChain.proposedWinner) !== winner) return { clean: false, reason: `replay_mismatch: winner on-chain=${lc(onChain.proposedWinner)} replay=${winner}` };
  if (lc(onChain.proposedForfeiter || zeroAddress) !== wallet(repro.forfeiter)) {
    return { clean: false, reason: `replay_mismatch: forfeiter on-chain=${lc(onChain.proposedForfeiter)} replay=${wallet(repro.forfeiter)}` };
  }
  if (lc(onChain.finalStateHash) !== lc(repro.finalStateHash)) return { clean: false, reason: 'replay_mismatch: finalStateHash' };
  if (lc(onChain.turnLogHash) !== lc(repro.turnLogHash)) return { clean: false, reason: 'replay_mismatch: turnLogHash' };
  if (!sameDamage(onChain.proposedDamageA, repro.damageA)) return { clean: false, reason: 'replay_mismatch: damageA' };
  if (!sameDamage(onChain.proposedDamageB, repro.damageB)) return { clean: false, reason: 'replay_mismatch: damageB' };
  return { clean: true };
}

type Simulate = (args: [bigint], opts: { account: unknown }) => Promise<{ request: unknown }>;
type WatchdogCall = 'finalizeBattle' | 'freeze' | 'expireFrozen' | 'handleTimeout';
interface Signer { account: { address: `0x${string}` }; writeContract(request: any): Promise<`0x${string}`> }

export interface FinalizeWatcherDeps {
  /** drizzle db (select on `battles`). */
  db: any;
  battles: any;
  publicClient: {
    getBlock(args: { blockTag: 'latest' }): Promise<{ timestamp: bigint; number: bigint }>;
    getBalance(args: { address: `0x${string}` }): Promise<bigint>;
    waitForTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ status: string }>;
  };
  /** This server's own record of the battle (the `battle_sessions` row), or null. */
  readSession(battleId: bigint): Promise<WatchdogSession | null>;
  /** M4 second source: battle ids with a `BattleProposed` or `BattleFrozen` log in [fromBlock, toBlock]. */
  readRecentReviewLogs(fromBlock: bigint, toBlock: bigint): Promise<bigint[]>;
  arena: {
    read: {
      getBattle(args: [bigint]): Promise<OnChainResult>;
      hasRole(args: [`0x${string}`, `0x${string}`]): Promise<boolean>;
    };
    simulate: Record<WatchdogCall, Simulate>;
  };
  /** Permissionless calls (finalizeBattle, expireFrozen, handleTimeout): the operator key. */
  walletClient: Signer;
  /** GUARDIAN_ROLE signer for `freeze`. A function so a missing GUARDIAN_PRIVATE_KEY fails the
   *  freeze loudly instead of taking the engine down at boot. */
  guardianClient: () => Signer;
  /** PAUSE-I1: the PauseSwitch, when PAUSE_SWITCH_ADDRESS is set. The preflight warns if the guardian
   *  key cannot pause (it can still freeze; only the emergency stop would need the Safe). */
  pauseSwitch?: { read: { hasRole(args: [`0x${string}`, `0x${string}`]): Promise<boolean> } };
  log?: typeof baseLog;
  pollMs?: number;
  now?: () => number;
}

interface Candidate { battleId: bigint; onChain: OnChainResult }

export class FinalizeWatcher {
  private interval: ReturnType<typeof setInterval> | null = null;
  private preflightInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private tickCount = 0;
  /** battleId → receipt wait of a transaction sent for it; the battle is skipped until it settles. */
  private pending = new Map<string, Promise<void>>();
  /** battleId:turnLogHash → judgement, so a battle is re-played once, not every tick. */
  private judged = new Map<string, SettlementJudgement>();
  /** Battles whose missed freeze was already paged. */
  private missed = new Set<string>();
  /** `${battleId}:${msg}` → last page (ms). */
  private lastAlarm = new Map<string, number>();
  /** C-L2: ticks a battle has been seen past its deadline without the permissionless call landing. */
  private overdue = new Map<string, number>();
  private readonly log;
  private readonly pollMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: FinalizeWatcherDeps) {
    this.log = (deps.log ?? baseLog).child({ module: 'battle-watchdog' });
    this.pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
    this.now = deps.now ?? Date.now;
  }

  /** Production wiring. `finalizeBattle` / `expireFrozen` / `handleTimeout` are permissionless (operator
   *  key); `freeze` needs GUARDIAN_ROLE (GUARDIAN_PRIVATE_KEY; off mainnet it falls back to the operator key). */
  static fromEnv(): FinalizeWatcher {
    // Lazy requires keep the class importable in tests without touching the real db/chain.
    const chain = require('@clawbada/chain');
    const dbMod = require('@clawbada/db');
    const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
    const publicClient = chain.getPublicClient(isTestnet);
    const pollRaw = Number(process.env.FINALIZE_POLL_MS);
    const reviewEvents = (chain.BattleArenaAbi as readonly any[]).filter(
      (item) => item.type === 'event' && (item.name === 'BattleProposed' || item.name === 'BattleFrozen'),
    );
    let guardian: Signer | null = null;
    return new FinalizeWatcher({
      db: dbMod.db,
      battles: dbMod.battles,
      readSession: async (battleId: bigint) =>
        (await dbMod.db.query.battleSessions.findFirst({ where: eq(dbMod.battleSessions.id, battleId.toString()) })) ?? null,
      readRecentReviewLogs: async (fromBlock: bigint, toBlock: bigint) => {
        const logs: any[] = await publicClient.getLogs({ address: chain.addresses.battleArena, events: reviewEvents, fromBlock, toBlock });
        return logs.map((l) => BigInt(l.args.battleId));
      },
      publicClient,
      arena: chain.getBattleArena(publicClient),
      walletClient: chain.getOperatorClient(isTestnet),
      guardianClient: () => (guardian ??= chain.getGuardianClient(isTestnet)),
      pauseSwitch: process.env.PAUSE_SWITCH_ADDRESS ? chain.getPauseSwitch(publicClient) : undefined,
      pollMs: Number.isFinite(pollRaw) && pollRaw > 0 ? pollRaw : DEFAULT_POLL_MS,
    });
  }

  start(): void {
    this.interval = setInterval(() => {
      this.tick().catch((err) => this.log.error({ err }, 'watchdog tick failed'));
    }, this.pollMs);
    // M3: find out NOW that the guardian cannot freeze, not when a bad result is in review.
    void this.preflight();
    this.preflightInterval = setInterval(() => void this.preflight(), PREFLIGHT_INTERVAL_MS);
    this.log.info({ pollMs: this.pollMs, preflightIntervalMs: PREFLIGHT_INTERVAL_MS }, 'Battle watchdog started');
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.preflightInterval) {
      clearInterval(this.preflightInterval);
      this.preflightInterval = null;
    }
  }

  /** Resolves once every transaction sent so far has its receipt (or gave up). Tests and shutdown. */
  async drain(): Promise<void> {
    await Promise.all([...this.pending.values()]);
  }

  /**
   * M3: can the guardian key actually freeze? Holds GUARDIAN_ROLE on BattleArena and has ETH for
   * gas. Never throws; every failure is a FATAL `guardian_preflight_failed`. Returns true when ok.
   */
  async preflight(): Promise<boolean> {
    let guardian: Signer;
    try {
      guardian = this.deps.guardianClient();
    } catch (err) {
      this.log.fatal({ err }, 'guardian_preflight_failed — no guardian signer (GUARDIAN_PRIVATE_KEY): the watchdog cannot freeze anything');
      return false;
    }
    const address = guardian.account.address;
    try {
      const [hasRole, balance] = await Promise.all([
        this.deps.arena.read.hasRole([GUARDIAN_ROLE, address]),
        this.deps.publicClient.getBalance({ address }),
      ]);
      const problems: string[] = [];
      if (!hasRole) problems.push('does not hold GUARDIAN_ROLE on BattleArena');
      if (balance < MIN_GUARDIAN_BALANCE_WEI) problems.push(`balance ${formatEther(balance)} ETH is below the ${formatEther(MIN_GUARDIAN_BALANCE_WEI)} ETH minimum`);
      if (problems.length > 0) {
        this.log.fatal(
          { guardian: address, hasRole, balanceWei: balance.toString(), problems },
          'guardian_preflight_failed — the guardian key cannot freeze: fix it before a bad result reaches review',
        );
        return false;
      }
      if (this.deps.pauseSwitch) {
        const canPause = await this.deps.pauseSwitch.read.hasRole([PAUSER_ROLE, address]);
        if (!canPause) this.log.warn({ guardian: address }, 'guardian_cannot_pause — the guardian key lacks PauseSwitch PAUSER_ROLE: the emergency stop would need the Safe');
      }
      this.log.info({ guardian: address, balanceWei: balance.toString() }, 'guardian_preflight_ok');
      return true;
    } catch (err) {
      this.log.fatal({ err, guardian: address }, 'guardian_preflight_failed — could not check the guardian key (RPC): the watchdog may be blind');
      return false;
    }
  }

  /** One pass over every battle the watchdog cares about. Never throws; never overlaps itself. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.pass();
    } finally {
      this.running = false;
    }
  }

  private async pass(): Promise<void> {
    const { db, battles, publicClient } = this.deps;
    const tick = ++this.tickCount;
    const head = await publicClient.getBlock({ blockTag: 'latest' });
    const now = head.timestamp;

    // Source 1: the indexer's mirror.
    const ids = new Map<string, bigint>();
    let dbRows = 0;
    try {
      const rows: Array<{ battleId: bigint }> = await db
        .select({ battleId: battles.battleId })
        .from(battles)
        .where(and(inArray(battles.phase, [...LAPSABLE, IN_REVIEW, FROZEN]), isNull(battles.settledAt)));
      dbRows = rows.length;
      for (const row of rows) ids.set(row.battleId.toString(), row.battleId);
    } catch (err) {
      this.log.error({ err, tick }, 'watchdog_db_source_failed — judging from the chain logs alone this tick');
    }
    // Source 2 (M4): the chain itself, so a stalled indexer cannot hide a result from review.
    let fromLogsOnly = 0;
    try {
      const fromBlock = head.number > LOG_LOOKBACK_BLOCKS ? head.number - LOG_LOOKBACK_BLOCKS : 0n;
      for (const id of await this.deps.readRecentReviewLogs(fromBlock, head.number)) {
        const key = id.toString();
        if (ids.has(key)) continue;
        ids.set(key, id);
        fromLogsOnly++;
      }
    } catch (err) {
      this.log.error({ err, tick }, 'watchdog_log_source_failed — judging from the indexer mirror alone this tick');
    }
    this.log.info(
      { tick, rows: ids.size, dbRows, fromLogsOnly, pendingTx: this.pending.size, block: head.number.toString(), chainNow: now.toString() },
      'watchdog_heartbeat',
    );
    if (ids.size === 0) return;

    // Where each battle really is. Bounded concurrency; a battle with a transaction in flight waits.
    const candidates = await mapLimit([...ids.values()].filter((id) => !this.pending.has(id.toString())), READ_CONCURRENCY, async (battleId) => {
      try {
        return { battleId, onChain: await this.deps.arena.read.getBattle([battleId]) } as Candidate;
      } catch (err) {
        this.log.error({ err, battleId: battleId.toString() }, 'watchdog step failed — getBattle; will retry next tick');
        return null;
      }
    });
    const byPhase = (p: number) => candidates.filter((c): c is Candidate => c !== null && Number(c.onChain.phase) === p);
    const inReview = byPhase(IN_REVIEW).sort((a, b) => (a.onChain.payoutDeadline < b.onChain.payoutDeadline ? -1 : a.onChain.payoutDeadline > b.onChain.payoutDeadline ? 1 : 0));
    const frozen = byPhase(FROZEN);
    const lapsable = LAPSABLE.flatMap(byPhase);
    for (const c of candidates) {
      if (c && ![...LAPSABLE, IN_REVIEW, FROZEN].includes(Number(c.onChain.phase))) {
        this.log.debug({ battleId: c.battleId.toString(), phase: Number(c.onChain.phase) }, 'nothing to do for this phase — skipping (indexer will catch up)');
      }
    }

    // Pass 1 (C-L1): judge every result in review, earliest deadline first, and freeze what cannot
    // be reproduced. Nothing else is sent until this pass is done.
    const clean: Candidate[] = [];
    for (const c of inReview) {
      await this.step(c, async () => {
        if (await this.judgeAndFreeze(c.battleId, c.onChain, now)) clean.push(c);
      });
    }
    // Pass 2: pay out the clean results whose window has closed.
    for (const c of clean) await this.step(c, () => this.finalize(c.battleId, c.onChain, now));
    // Pass 3: frozen battles — page, and expire past the long-stop.
    for (const c of frozen) await this.step(c, () => this.frozen(c.battleId, c.onChain, now));
    // Pass 4 (L3): lapsed deposits, reveals and Active battles.
    for (const c of lapsable) await this.step(c, () => this.sweep(c.battleId, c.onChain, now));
  }

  private async step(c: Candidate, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.log.error({ err, battleId: c.battleId.toString(), phase: Number(c.onChain.phase) }, 'watchdog step failed — will retry next tick');
    }
  }

  /** Pass 1 for one result. True when the result is clean (eligible for the finalize pass). */
  private async judgeAndFreeze(battleId: bigint, onChain: OnChainResult, now: bigint): Promise<boolean> {
    const id = battleId.toString();
    const cacheKey = `${id}:${String(onChain.turnLogHash).toLowerCase()}`;
    let judgement = this.judged.get(cacheKey);
    if (!judgement) {
      judgement = await this.judge(battleId, onChain, now);
      // Only a clean verdict is cached: an unclean one is acted on (frozen) at once, and if that
      // send fails the next tick judges afresh.
      if (judgement.clean) this.judged.set(cacheKey, judgement);
    }
    if (judgement.clean) return true;

    if (now > onChain.payoutDeadline) {
      if (!this.missed.has(id)) {
        this.missed.add(id);
        this.log.error(
          { battleId: id, reason: judgement.reason, payoutDeadline: onChain.payoutDeadline.toString() },
          'battle_freeze_missed — a result the watchdog cannot reproduce left its review window unfrozen; it will pay out as submitted',
        );
      }
      return false; // never finalize a result we could not reproduce; anyone else still can
    }
    await this.freeze(battleId, onChain, judgement.reason);
    return false;
  }

  /**
   * M2b: a judge that throws is a verdict, not a retry — `judge_threw` is NOT clean and is
   * frozen like any other mismatch. A session read that fails (the DB, not the replay) is retried
   * while the window has time, and fails closed in its last JUDGE_GRACE_SEC.
   */
  private async judge(battleId: bigint, onChain: OnChainResult, now: bigint): Promise<SettlementJudgement> {
    let session: WatchdogSession | null;
    try {
      session = await this.deps.readSession(battleId);
    } catch (err) {
      if (onChain.payoutDeadline - now > JUDGE_GRACE_SEC) throw err;
      return { clean: false, reason: `judge_threw: session read failed: ${errMessage(err)}` };
    }
    try {
      return judgeSettlement(session, onChain);
    } catch (err) {
      return { clean: false, reason: `judge_threw: ${errMessage(err)}` };
    }
  }

  private async freeze(battleId: bigint, onChain: OnChainResult, reason: string): Promise<void> {
    const id = battleId.toString();
    const fields = { battleId: id, reason, proposedWinner: onChain.proposedWinner, payoutDeadline: onChain.payoutDeadline.toString() };
    let guardian: Signer;
    try {
      guardian = this.deps.guardianClient();
    } catch (err) {
      this.log.fatal({ ...fields, err }, 'battle_freeze_failed — no guardian signer (GUARDIAN_PRIVATE_KEY): freeze it from the Safe NOW');
      return;
    }
    let hash: `0x${string}` | null;
    try {
      hash = await this.send('freeze', battleId, guardian);
    } catch (err) {
      // M3: a role revert (AccessControlUnauthorizedAccount), no gas, an RPC error — every one is
      // the safety net failing open, and is paged as such on every attempt. Retried next tick.
      this.log.fatal(
        { ...fields, guardian: guardian.account.address, err },
        'battle_freeze_failed — the guardian could not send freeze (role, gas or RPC): freeze it from the Safe NOW',
      );
      return;
    }
    if (!hash) {
      // Benign revert: frozen by someone else (the Safe) — fine — or the window just closed.
      const again = await this.deps.arena.read.getBattle([battleId]);
      if (Number(again.phase) !== FROZEN && !this.missed.has(id)) {
        this.missed.add(id);
        this.log.error({ ...fields, phase: Number(again.phase) }, 'battle_freeze_missed — freeze reverted at the edge of the review window');
      }
      return;
    }
    this.log.error({ ...fields, tx: hash }, 'battle_frozen');
  }

  /** Pass 2 for one clean result. */
  private async finalize(battleId: bigint, onChain: OnChainResult, now: bigint): Promise<void> {
    const id = battleId.toString();
    if (now <= onChain.payoutDeadline) {
      this.log.debug({ battleId: id, secondsRemaining: Number(onChain.payoutDeadline - now) }, 'review window still open');
      return;
    }
    const ticks = (this.overdue.get(id) ?? 0) + 1;
    this.overdue.set(id, ticks);
    if (ticks > OVERDUE_TICKS) {
      this.alarm(id, 'finalize_overdue', { battleId: id, ticksPastDeadline: ticks, payoutDeadline: onChain.payoutDeadline.toString(), chainNow: now.toString() });
    }
    const hash = await this.send('finalizeBattle', battleId, this.deps.walletClient);
    if (hash) this.log.info({ battleId: id, tx: hash }, 'finalizeBattle submitted — payout executed');
  }

  /** Pass 3 for one frozen battle. */
  private async frozen(battleId: bigint, onChain: OnChainResult, now: bigint): Promise<void> {
    const id = battleId.toString();
    const frozenAt = BigInt(onChain.frozenAt);
    const longStopAt = frozenAt + FREEZE_LONG_STOP_SEC;
    const fields = { battleId: id, frozenAt: frozenAt.toString(), longStopAt: longStopAt.toString(), secondsToLongStop: Number(longStopAt - now) };

    if (now > longStopAt) {
      const ticks = (this.overdue.get(id) ?? 0) + 1;
      this.overdue.set(id, ticks);
      let hash: `0x${string}` | null = null;
      try {
        hash = await this.send('expireFrozen', battleId, this.deps.walletClient);
      } catch (err) {
        this.log.error({ ...fields, err }, 'expireFrozen failed — will retry next tick');
      }
      if (hash) {
        this.log.warn({ ...fields, tx: hash }, 'frozen_battle_expired — the Safe did not act within 72 h; stakes burned and players paid back from the reserve (or refunded directly)');
        return;
      }
      // Not sent: somebody else expired it (fine), or it keeps failing. Still frozen?
      const again = await this.deps.arena.read.getBattle([battleId]);
      if (Number(again.phase) !== FROZEN) {
        this.overdue.delete(id);
        return;
      }
      if (ticks > OVERDUE_TICKS) this.alarm(id, 'expire_failed', { ...fields, ticksPastLongStop: ticks });
      // C-L2: a frozen battle keeps paging past its long-stop until it is gone.
      this.alarm(id, 'battle_freeze_long_stop_due', fields);
      return;
    }
    if (longStopAt - now <= LONG_STOP_WARN_SEC) {
      this.alarm(id, 'battle_freeze_long_stop_due', fields);
    } else {
      this.alarm(id, 'battle_frozen_awaiting_safe', fields);
    }
  }

  /** Pass 4 (L3) for one battle in Deposit / TeamReveal / Active: `handleTimeout` once its deadline has passed. */
  private async sweep(battleId: bigint, onChain: OnChainResult, now: bigint): Promise<void> {
    if (now <= onChain.phaseDeadline) return;
    const phase = Number(onChain.phase);
    const hash = await this.send('handleTimeout', battleId, this.deps.walletClient);
    if (!hash) return;
    const fields = { battleId: battleId.toString(), phase, phaseDeadline: onChain.phaseDeadline.toString(), chainNow: now.toString(), tx: hash };
    // A deposit nobody completed is routine (the match was declined); a lapsed reveal or an
    // Active battle nobody settled is a server-side failure worth a look.
    if (phase === BattlePhase.Deposit) this.log.info(fields, 'battle_timed_out_by_watchdog');
    else this.log.warn(fields, 'battle_timed_out_by_watchdog');
  }

  /**
   * Simulate + send one permissioned or permissionless call. Returns the tx hash, or null on a
   * benign revert. The receipt is NOT awaited here (C-L1): it is tracked in the background and the
   * battle is skipped until it lands, so a slow transaction never delays the next freeze.
   */
  private async send(fn: WatchdogCall, battleId: bigint, signer: Signer): Promise<`0x${string}` | null> {
    let request: unknown;
    try {
      ({ request } = await this.deps.arena.simulate[fn]([battleId], { account: signer.account }));
    } catch (err) {
      // Someone else got there first, or the clock edge moved: not worth retry-spam.
      if (isBenignRevert(err)) {
        this.log.debug({ battleId: battleId.toString(), fn, err: String(err).slice(0, 160) }, 'simulation reverted benignly');
        return null;
      }
      throw err;
    }
    const hash = await signer.writeContract(request);
    this.track(battleId, fn, hash);
    return hash;
  }

  private track(battleId: bigint, fn: WatchdogCall, hash: `0x${string}`): void {
    const id = battleId.toString();
    const fields = { battleId: id, fn, tx: hash };
    const wait = this.deps.publicClient
      .waitForTransactionReceipt({ hash })
      .then((receipt) => {
        if (receipt.status === 'success') {
          this.log.debug(fields, 'watchdog_tx_confirmed');
        } else if (fn === 'freeze') {
          this.log.fatal({ ...fields, status: receipt.status }, 'battle_freeze_failed — the freeze transaction reverted on-chain: freeze it from the Safe NOW');
        } else {
          this.log.error({ ...fields, status: receipt.status }, 'watchdog_tx_reverted — will re-check the battle next tick');
        }
      })
      .catch((err) => {
        // viem gives up after its receipt timeout; the next tick re-simulates (a landed tx reverts benignly).
        this.log.warn({ ...fields, err }, 'watchdog_receipt_wait_failed — will re-check the battle next tick');
      })
      .finally(() => this.pending.delete(id));
    this.pending.set(id, wait);
  }

  /** Error-level page, at most once per FROZEN_ALARM_REPEAT_MS per battle and message. */
  private alarm(battleId: string, msg: string, fields: Record<string, unknown>): void {
    const key = `${battleId}:${msg}`;
    const last = this.lastAlarm.get(key);
    if (last !== undefined && this.now() - last < FROZEN_ALARM_REPEAT_MS) return;
    this.lastAlarm.set(key, this.now());
    this.log.error(fields, msg);
  }
}

function isBenignRevert(err: unknown): boolean {
  const s = String((err as any)?.message ?? err);
  return /ReviewWindowOpen|ReviewWindowClosed|LongStopNotReached|InvalidBattlePhase|PhaseNotTimedOut|BattleDoesNotExist/.test(s);
}

function errMessage(err: unknown): string {
  return String((err as any)?.shortMessage ?? (err as any)?.message ?? err);
}

/** `Promise.all` with at most `limit` of `fn` running at once; results keep the input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
