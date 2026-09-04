/**
 * F5-01 team-reveal watcher.
 *
 * In the atomic-reveal flow, players POST their team salt to the API (they no longer reveal
 * on-chain themselves). The API stores each committed teamId + salt on the battle row. This
 * watcher is the RESOLVER-side half: it polls for battles whose reveal is ready (both salts
 * present, still in the TeamReveal phase) and submits a single atomic
 * `revealTeams(battleId, teamIdA, saltA, teamIdB, saltB)` via the operator key — so neither
 * team's identity reaches the chain until both are bound in one transaction.
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
import {
  addresses,
  getOperatorClient,
  getPublicClient,
  getBattleArena,
  BattleArenaAbi,
} from '@clawbada/chain';
import { db, battles } from '@clawbada/db';
import { log as baseLog } from '../logger';

const log = baseLog.child({ module: 'reveal-watcher' });
const isTestnet = process.env.CHAIN_ENV !== 'mainnet';

const POLL_MS = 2000; // fast — the on-chain team-reveal window is short

export class RevealWatcher {
  private interval: ReturnType<typeof setInterval> | null = null;
  private inFlight = new Set<string>(); // battleIds mid-submit, avoids double-send

  start(): void {
    this.interval = setInterval(() => {
      this.tick().catch((err) => log.error({ err }, 'reveal watcher tick failed'));
    }, POLL_MS);
    log.info('Reveal watcher started');
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** Find battles with both salts collected and submit the atomic reveal for each. */
  async tick(): Promise<void> {
    const ready = await db
      .select()
      .from(battles)
      .where(and(isNotNull(battles.revealSaltA), isNotNull(battles.revealSaltB)));

    for (const row of ready) {
      const key = row.battleId.toString();
      if (this.inFlight.has(key)) continue;
      this.inFlight.add(key);
      try {
        await this.submitReveal(row);
      } catch (err) {
        log.error({ err, battleId: key }, 'revealTeams submission failed');
      } finally {
        this.inFlight.delete(key);
      }
    }
  }

  private async submitReveal(row: typeof battles.$inferSelect): Promise<void> {
    const battleId = row.battleId;
    const publicClient = getPublicClient(isTestnet) as any;

    // Guard against a stale row (already revealed / cancelled / timed out): only submit while
    // the battle is genuinely still in TeamReveal on-chain.
    const arena = getBattleArena(publicClient);
    const onChain = await arena.read.getBattle([battleId]);
    if (Number(onChain.phase) !== BattlePhase.TeamReveal) {
      log.warn({ battleId: battleId.toString(), phase: Number(onChain.phase) },
        'reveal ready in DB but battle not in TeamReveal — clearing stale salts');
      await this.clearSalts(battleId);
      return;
    }

    const walletClient = getOperatorClient(isTestnet);
    const hash = await walletClient.writeContract({
      address: addresses.battleArena,
      abi: BattleArenaAbi as any,
      functionName: 'revealTeams',
      args: [battleId, row.teamA, row.revealSaltA as `0x${string}`, row.teamB, row.revealSaltB as `0x${string}`],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    // Success — the teams are now bound + locked on-chain and the battle is Active. Drop the
    // transient salts.
    await this.clearSalts(battleId);
    log.info({ battleId: battleId.toString(), tx: hash }, 'revealTeams submitted — battle active');
  }

  private async clearSalts(battleId: bigint): Promise<void> {
    await db
      .update(battles)
      .set({ revealSaltA: null, revealSaltB: null })
      .where(eq(battles.battleId, battleId));
  }
}
