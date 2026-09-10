/**
 * F5-01 team-reveal watcher.
 *
 * In the atomic-reveal flow, players POST their team salt to the API (they no longer reveal
 * on-chain themselves). The API stores each committed teamId + salt on the battle row. This
 * watcher is the RESOLVER-side half: it polls for battles whose reveal is ready (both salts
 * present, still in the TeamReveal phase) and submits a single atomic
 * `revealTeams(battleId, teamIdA, saltA, teamIdB, saltB)` with the RESOLVER key
 * (`onlyRole(RESOLVER_ROLE)` on-chain) — so neither team's identity reaches the chain until
 * both are bound in one transaction.
 *
 * On success the salts are cleared (transient — a revealed team's salt is not retained).
 *
 * TIMING: BattleArena.TEAM_REVEAL_WINDOW bounds how long after both commits revealTeams can
 * land (it reverts PhaseTimedOut past the deadline). This poll is deliberately fast, but if
 * the window proves too tight for the API→DB→poll→tx→confirm path on mainnet, widen
 * TEAM_REVEAL_WINDOW (a costless, security-neutral change — timeout is still a full-refund
 * mutual cancel). See the F5-01 off-chain integration notes.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { BattlePhase } from '@clawbada/game-logic';
import { log as baseLog } from '../logger';

const POLL_MS = 2000; // fast — the on-chain team-reveal window is short

export interface RevealWatcherDeps {
  /** drizzle db (select/update on `battles`). */
  db: any;
  battles: any;
  publicClient: { waitForTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ status: string }> };
  arena: { read: { getBattle(args: [bigint]): Promise<{ phase: number | bigint }> } };
  /** RESOLVER-role signer (revealTeams is onlyRole(RESOLVER_ROLE)). */
  walletClient: { writeContract(request: any): Promise<`0x${string}`> };
  battleArenaAddress: `0x${string}`;
  abi: readonly unknown[];
  log?: typeof baseLog;
  pollMs?: number;
}

export class RevealWatcher {
  private interval: ReturnType<typeof setInterval> | null = null;
  private inFlight = new Set<string>(); // battleIds mid-submit, avoids double-send
  private readonly log;
  private readonly pollMs: number;

  constructor(private readonly deps: RevealWatcherDeps) {
    this.log = (deps.log ?? baseLog).child({ module: 'reveal-watcher' });
    this.pollMs = deps.pollMs ?? POLL_MS;
  }

  /** Production wiring. RESOLVER_PRIVATE_KEY falls back to the operator key when unset. */
  static fromEnv(): RevealWatcher {
    const chain = require('@clawbada/chain');
    const dbMod = require('@clawbada/db');
    const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
    const publicClient = chain.getPublicClient(isTestnet);
    return new RevealWatcher({
      db: dbMod.db,
      battles: dbMod.battles,
      publicClient,
      arena: chain.getBattleArena(publicClient),
      walletClient: chain.getResolverClient(isTestnet),
      battleArenaAddress: chain.addresses.battleArena,
      abi: chain.BattleArenaAbi,
    });
  }

  start(): void {
    this.interval = setInterval(() => {
      this.tick().catch((err) => this.log.error({ err }, 'reveal watcher tick failed'));
    }, this.pollMs);
    this.log.info('Reveal watcher started');
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** Find battles with both salts collected and submit the atomic reveal for each. */
  async tick(): Promise<void> {
    const { db, battles } = this.deps;
    // Only rows the indexer still shows in TeamReveal; the on-chain guard below clears salts
    // on anything that advanced or cancelled in the meantime.
    const ready: Array<any> = await db
      .select()
      .from(battles)
      .where(and(isNotNull(battles.revealSaltA), isNotNull(battles.revealSaltB), eq(battles.phase, BattlePhase.TeamReveal)));

    for (const row of ready) {
      const key = row.battleId.toString();
      if (this.inFlight.has(key)) continue;
      this.inFlight.add(key);
      try {
        await this.submitReveal(row);
      } catch (err) {
        this.log.error({ err, battleId: key }, 'revealTeams submission failed');
      } finally {
        this.inFlight.delete(key);
      }
    }
  }

  private async submitReveal(row: any): Promise<void> {
    const { arena, publicClient, walletClient, battleArenaAddress, abi } = this.deps;
    const battleId: bigint = row.battleId;

    // Guard against a stale row (already revealed / cancelled / timed out): only submit while
    // the battle is genuinely still in TeamReveal on-chain.
    const onChain = await arena.read.getBattle([battleId]);
    if (Number(onChain.phase) !== BattlePhase.TeamReveal) {
      this.log.warn({ battleId: battleId.toString(), phase: Number(onChain.phase) },
        'reveal ready in DB but battle not in TeamReveal — clearing stale salts');
      await this.clearSalts(battleId);
      return;
    }

    const hash = await walletClient.writeContract({
      address: battleArenaAddress,
      abi,
      functionName: 'revealTeams',
      args: [battleId, row.teamA, row.revealSaltA as `0x${string}`, row.teamB, row.revealSaltB as `0x${string}`],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    // Success — the teams are now bound + locked on-chain and the battle is Active. Drop the
    // transient salts.
    await this.clearSalts(battleId);
    this.log.info({ battleId: battleId.toString(), tx: hash }, 'revealTeams submitted — battle active');
  }

  private async clearSalts(battleId: bigint): Promise<void> {
    const { db, battles } = this.deps;
    await db
      .update(battles)
      .set({ revealSaltA: null, revealSaltB: null })
      .where(eq(battles.battleId, battleId));
  }
}
