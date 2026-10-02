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
 *
 * Chain time (latest block timestamp), not the server's wall clock, decides every deadline:
 * the contract judges by block.timestamp, and the two diverge on a local chain with time travel.
 * The indexer mirrors the resulting events; this watcher writes nothing to the DB.
 */
import { and, inArray, isNull, eq } from 'drizzle-orm';
import { zeroAddress } from 'viem';
import { BattlePhase, v3 } from '@clawbada/game-logic';
import { judgeProposal, isRogueVerdict, type SessionResult } from '@clawbada/db/src/queries/proposal-verdict';
import { log as baseLog } from '../logger';

const DEFAULT_POLL_MS = 10_000;
const IN_REVIEW = BattlePhase.AwaitingFinalize;
const FROZEN = BattlePhase.Frozen;

/** BattleArena.FREEZE_LONG_STOP. */
export const FREEZE_LONG_STOP_SEC = 72n * 3600n;
/** Start paging `battle_freeze_long_stop_due` this long before the long-stop. */
export const LONG_STOP_WARN_SEC = 12n * 3600n;
/** Re-page a frozen battle at most this often (ms). */
export const FROZEN_ALARM_REPEAT_MS = 60 * 60_000;

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
interface Signer { account: { address: `0x${string}` }; writeContract(request: any): Promise<`0x${string}`> }

export interface FinalizeWatcherDeps {
  /** drizzle db (select on `battles`). */
  db: any;
  battles: any;
  publicClient: {
    getBlock(args: { blockTag: 'latest' }): Promise<{ timestamp: bigint }>;
    waitForTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ status: string }>;
  };
  /** This server's own record of the battle (the `battle_sessions` row), or null. */
  readSession(battleId: bigint): Promise<WatchdogSession | null>;
  arena: {
    read: { getBattle(args: [bigint]): Promise<OnChainResult> };
    simulate: { finalizeBattle: Simulate; freeze: Simulate; expireFrozen: Simulate };
  };
  /** Permissionless calls (finalizeBattle, expireFrozen): the operator key. */
  walletClient: Signer;
  /** GUARDIAN_ROLE signer for `freeze`. A function so a missing GUARDIAN_PRIVATE_KEY fails the
   *  freeze loudly instead of taking the engine down at boot. */
  guardianClient: () => Signer;
  log?: typeof baseLog;
  pollMs?: number;
  now?: () => number;
}

export class FinalizeWatcher {
  private interval: ReturnType<typeof setInterval> | null = null;
  private inFlight = new Set<string>();
  /** battleId:turnLogHash → judgement, so a battle is re-played once, not every tick. */
  private judged = new Map<string, SettlementJudgement>();
  /** Battles whose missed freeze was already paged. */
  private missed = new Set<string>();
  /** `${battleId}:${msg}` → last page (ms). */
  private lastAlarm = new Map<string, number>();
  private readonly log;
  private readonly pollMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: FinalizeWatcherDeps) {
    this.log = (deps.log ?? baseLog).child({ module: 'battle-watchdog' });
    this.pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
    this.now = deps.now ?? Date.now;
  }

  /** Production wiring. `finalizeBattle` / `expireFrozen` are permissionless (operator key);
   *  `freeze` needs GUARDIAN_ROLE (GUARDIAN_PRIVATE_KEY; off mainnet it falls back to the operator key). */
  static fromEnv(): FinalizeWatcher {
    // Lazy requires keep the class importable in tests without touching the real db/chain.
    const chain = require('@clawbada/chain');
    const dbMod = require('@clawbada/db');
    const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
    const publicClient = chain.getPublicClient(isTestnet);
    const pollRaw = Number(process.env.FINALIZE_POLL_MS);
    let guardian: Signer | null = null;
    return new FinalizeWatcher({
      db: dbMod.db,
      battles: dbMod.battles,
      readSession: async (battleId: bigint) =>
        (await dbMod.db.query.battleSessions.findFirst({ where: eq(dbMod.battleSessions.id, battleId.toString()) })) ?? null,
      publicClient,
      arena: chain.getBattleArena(publicClient),
      walletClient: chain.getOperatorClient(isTestnet),
      guardianClient: () => (guardian ??= chain.getGuardianClient(isTestnet)),
      pollMs: Number.isFinite(pollRaw) && pollRaw > 0 ? pollRaw : DEFAULT_POLL_MS,
    });
  }

  start(): void {
    this.interval = setInterval(() => {
      this.tick().catch((err) => this.log.error({ err }, 'watchdog tick failed'));
    }, this.pollMs);
    this.log.info({ pollMs: this.pollMs }, 'Battle watchdog started');
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** One pass over battles in review or frozen. Never throws. */
  async tick(): Promise<void> {
    const { db, battles } = this.deps;
    const rows: Array<{ battleId: bigint }> = await db
      .select({ battleId: battles.battleId })
      .from(battles)
      .where(and(inArray(battles.phase, [IN_REVIEW, FROZEN]), isNull(battles.settledAt)));
    if (rows.length === 0) return;

    for (const row of rows) {
      const key = row.battleId.toString();
      if (this.inFlight.has(key)) continue;
      this.inFlight.add(key);
      try {
        await this.process(row.battleId);
      } catch (err) {
        this.log.error({ err, battleId: key }, 'watchdog step failed — will retry next tick');
      } finally {
        this.inFlight.delete(key);
      }
    }
  }

  private async process(battleId: bigint): Promise<void> {
    const onChain = await this.deps.arena.read.getBattle([battleId]);
    const phase = Number(onChain.phase);
    if (phase === IN_REVIEW) return this.review(battleId, onChain);
    if (phase === FROZEN) return this.frozen(battleId, onChain);
    this.log.debug({ battleId: battleId.toString(), phase }, 'not in review or frozen on-chain — skipping (indexer will catch up)');
  }

  private async review(battleId: bigint, onChain: OnChainResult): Promise<void> {
    const { publicClient } = this.deps;
    const id = battleId.toString();
    const cacheKey = `${id}:${String(onChain.turnLogHash).toLowerCase()}`;
    let judgement = this.judged.get(cacheKey);
    if (!judgement) {
      judgement = judgeSettlement(await this.deps.readSession(battleId), onChain);
      // Only a clean verdict is cached: an unclean one is acted on (frozen) at once, and if that
      // send fails the next tick judges afresh.
      if (judgement.clean) this.judged.set(cacheKey, judgement);
    }
    const now = (await publicClient.getBlock({ blockTag: 'latest' })).timestamp;

    if (!judgement.clean) {
      if (now > onChain.payoutDeadline) {
        if (!this.missed.has(id)) {
          this.missed.add(id);
          this.log.error(
            { battleId: id, reason: judgement.reason, payoutDeadline: onChain.payoutDeadline.toString() },
            'battle_freeze_missed — a result the watchdog cannot reproduce left its review window unfrozen; it will pay out as submitted',
          );
        }
        return; // never finalize a result we could not reproduce; anyone else still can
      }
      await this.freeze(battleId, onChain, judgement.reason);
      return;
    }

    if (now <= onChain.payoutDeadline) {
      this.log.debug({ battleId: id, secondsRemaining: Number(onChain.payoutDeadline - now) }, 'review window still open');
      return;
    }
    await this.send('finalizeBattle', battleId, this.deps.walletClient, 'finalizeBattle submitted — payout executed');
  }

  private async freeze(battleId: bigint, onChain: OnChainResult, reason: string): Promise<void> {
    let guardian: Signer;
    try {
      guardian = this.deps.guardianClient();
    } catch (err) {
      this.log.fatal({ err, battleId: battleId.toString(), reason }, 'battle_freeze_failed — no guardian signer (GUARDIAN_PRIVATE_KEY): freeze it from the Safe NOW');
      return;
    }
    const hash = await this.send('freeze', battleId, guardian, null);
    if (!hash) {
      // Benign revert: frozen by someone else (the Safe) — fine — or the window just closed.
      const now = await this.deps.arena.read.getBattle([battleId]);
      if (Number(now.phase) !== FROZEN && !this.missed.has(battleId.toString())) {
        this.missed.add(battleId.toString());
        this.log.error({ battleId: battleId.toString(), reason, phase: Number(now.phase) }, 'battle_freeze_missed — freeze reverted at the edge of the review window');
      }
      return;
    }
    this.log.error(
      {
        battleId: battleId.toString(),
        reason,
        proposedWinner: onChain.proposedWinner,
        payoutDeadline: onChain.payoutDeadline.toString(),
        tx: hash,
      },
      'battle_frozen',
    );
  }

  private async frozen(battleId: bigint, onChain: OnChainResult): Promise<void> {
    const id = battleId.toString();
    const frozenAt = BigInt(onChain.frozenAt);
    const longStopAt = frozenAt + FREEZE_LONG_STOP_SEC;
    const now = (await this.deps.publicClient.getBlock({ blockTag: 'latest' })).timestamp;

    if (now > longStopAt) {
      const hash = await this.send('expireFrozen', battleId, this.deps.walletClient, null);
      if (hash) {
        this.log.warn({ battleId: id, frozenAt: frozenAt.toString(), tx: hash }, 'frozen_battle_expired — the Safe did not act within 72 h; stakes burned and players paid back from the reserve (or refunded directly)');
      }
      return;
    }
    const fields = { battleId: id, frozenAt: frozenAt.toString(), longStopAt: longStopAt.toString(), secondsToLongStop: Number(longStopAt - now) };
    if (longStopAt - now <= LONG_STOP_WARN_SEC) {
      this.alarm(id, 'battle_freeze_long_stop_due', fields);
    } else {
      this.alarm(id, 'battle_frozen_awaiting_safe', fields);
    }
  }

  /** Simulate + send one permissioned or permissionless call. Returns the tx hash, or null on a benign revert. */
  private async send(
    fn: 'finalizeBattle' | 'freeze' | 'expireFrozen',
    battleId: bigint,
    signer: Signer,
    successMsg: string | null,
  ): Promise<`0x${string}` | null> {
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
    await this.deps.publicClient.waitForTransactionReceipt({ hash });
    if (successMsg) this.log.info({ battleId: battleId.toString(), tx: hash }, successMsg);
    return hash;
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
  return /ReviewWindowOpen|ReviewWindowClosed|LongStopNotReached|InvalidBattlePhase/.test(s);
}
