/**
 * H-01 finalize watcher.
 *
 * `BattleArena.settle` only PROPOSES a result: the payout waits behind a per-bracket dispute
 * window (`payoutDeadline`). `finalizeBattle` is permissionless but nothing else calls it, so
 * without this watcher a settled battle sits in AwaitingFinalize and the winner is never paid.
 *
 * Each tick: battles the indexer shows in AwaitingFinalize (phase 5, not yet settled) →
 * re-read on-chain → if still phase 5, undisputed, and the CHAIN clock is past
 * `payoutDeadline`, simulate + submit `finalizeBattle`. The indexer mirrors `BattleSettled`
 * (phase 6, winner, payouts) — this watcher writes nothing to the DB.
 *
 * Chain time (latest block timestamp), not the server's wall clock, decides "past the
 * deadline": the contract judges by block.timestamp, and the two diverge on a local chain
 * with time travel. Disputed battles are left to `adminResolveDispute`.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { BattlePhase } from '@clawbada/game-logic';
import { log as baseLog } from '../logger';

const DEFAULT_POLL_MS = 10_000;
const AWAITING_FINALIZE = BattlePhase.AwaitingFinalize;

export interface FinalizeWatcherDeps {
  /** drizzle db (select on `battles`). */
  db: any;
  battles: any;
  publicClient: {
    getBlock(args: { blockTag: 'latest' }): Promise<{ timestamp: bigint }>;
    waitForTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ status: string }>;
  };
  arena: {
    read: { getBattle(args: [bigint]): Promise<{ phase: number | bigint; payoutDeadline: bigint; disputed: boolean }> };
    simulate: { finalizeBattle(args: [bigint], opts: { account: unknown }): Promise<{ request: unknown }> };
  };
  walletClient: { account: { address: `0x${string}` }; writeContract(request: any): Promise<`0x${string}`> };
  log?: typeof baseLog;
  pollMs?: number;
}

export class FinalizeWatcher {
  private interval: ReturnType<typeof setInterval> | null = null;
  private inFlight = new Set<string>();
  private readonly log;
  private readonly pollMs: number;

  constructor(private readonly deps: FinalizeWatcherDeps) {
    this.log = (deps.log ?? baseLog).child({ module: 'finalize-watcher' });
    this.pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  }

  /** Production wiring: real db + chain clients; `finalizeBattle` is permissionless, so the operator key signs. */
  static fromEnv(): FinalizeWatcher {
    // Lazy requires keep the class importable in tests without touching the real db/chain.
    const chain = require('@clawbada/chain');
    const dbMod = require('@clawbada/db');
    const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
    const publicClient = chain.getPublicClient(isTestnet);
    const pollRaw = Number(process.env.FINALIZE_POLL_MS);
    return new FinalizeWatcher({
      db: dbMod.db,
      battles: dbMod.battles,
      publicClient,
      arena: chain.getBattleArena(publicClient),
      walletClient: chain.getOperatorClient(isTestnet),
      pollMs: Number.isFinite(pollRaw) && pollRaw > 0 ? pollRaw : DEFAULT_POLL_MS,
    });
  }

  start(): void {
    this.interval = setInterval(() => {
      this.tick().catch((err) => this.log.error({ err }, 'finalize watcher tick failed'));
    }, this.pollMs);
    this.log.info({ pollMs: this.pollMs }, 'Finalize watcher started');
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** One pass over proposed-but-unsettled battles. Never throws. */
  async tick(): Promise<void> {
    const { db, battles } = this.deps;
    const rows: Array<{ battleId: bigint }> = await db
      .select({ battleId: battles.battleId })
      .from(battles)
      .where(and(eq(battles.phase, AWAITING_FINALIZE), isNull(battles.settledAt)));
    if (rows.length === 0) return;

    for (const row of rows) {
      const key = row.battleId.toString();
      if (this.inFlight.has(key)) continue;
      this.inFlight.add(key);
      try {
        await this.finalize(row.battleId);
      } catch (err) {
        this.log.error({ err, battleId: key }, 'finalizeBattle failed — will retry next tick');
      } finally {
        this.inFlight.delete(key);
      }
    }
  }

  private async finalize(battleId: bigint): Promise<void> {
    const { arena, publicClient, walletClient } = this.deps;
    const onChain = await arena.read.getBattle([battleId]);
    const phase = Number(onChain.phase);
    if (phase !== AWAITING_FINALIZE) {
      this.log.debug({ battleId: battleId.toString(), phase }, 'not awaiting finalize on-chain — skipping (indexer will catch up)');
      return;
    }
    if (onChain.disputed) {
      this.log.warn({ battleId: battleId.toString() }, 'battle is disputed — waiting for adminResolveDispute');
      return;
    }
    const now = (await publicClient.getBlock({ blockTag: 'latest' })).timestamp;
    if (now <= onChain.payoutDeadline) {
      this.log.debug({ battleId: battleId.toString(), secondsRemaining: Number(onChain.payoutDeadline - now) }, 'dispute window still open');
      return;
    }

    let request: unknown;
    try {
      ({ request } = await arena.simulate.finalizeBattle([battleId], { account: walletClient.account }));
    } catch (err) {
      // Someone else finalized, or the clock edge moved: not an error worth retry-spam.
      if (isBenignRevert(err)) {
        this.log.debug({ battleId: battleId.toString(), err: String(err).slice(0, 120) }, 'finalize simulation reverted benignly');
        return;
      }
      throw err;
    }
    const hash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    this.log.info({ battleId: battleId.toString(), tx: hash }, 'finalizeBattle submitted — payout executed');
  }
}

function isBenignRevert(err: unknown): boolean {
  const s = String((err as any)?.message ?? err);
  return /DisputeWindowOpen|InvalidBattlePhase|BattleIsDisputed|DisputedBattleRequiresAdmin/.test(s);
}
