/**
 * ELO-based matchmaking within stake brackets.
 *
 * Agents join a queue with their team and desired stake bracket.
 * The matchmaker pairs agents with similar ELO ratings within
 * the same bracket, then creates the battle on-chain.
 *
 * S1 brackets: Low (2,500), Mid (10,000), High (50,000) $CLAW
 */
import { eq, and } from 'drizzle-orm';
import {
  STAKE_BRACKETS,
  DAMAGE_THRESHOLD,
  EvolutionTier,
} from '@clawbada/game-logic';
import {
  getPublicClient,
  getOperatorClient,
  getBattleArena,
  addresses,
  BattleArenaAbi,
} from '@clawbada/chain';
import { db, matchmakingQueue, battles, agents } from '@clawbada/db';
import { BattlePhase } from '@clawbada/game-logic';

interface QueueEntry {
  address: string;
  teamId: bigint;
  stakeBracket: number;
  elo: number;
  queuedAt: Date;
}

const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
const BASE_ELO_RANGE = 200;
const ELO_EXPAND_RATE = 10; // ELO range expands 10 per second

export class MatchmakingQueue {
  private matchInterval: Timer | null = null;
  private onMatch: ((battleId: bigint, playerA: string, playerB: string, stakeAmount: bigint) => void) | null = null;

  /** Register a callback for when a match is found. */
  setMatchHandler(fn: (battleId: bigint, playerA: string, playerB: string, stakeAmount: bigint) => void): void {
    this.onMatch = fn;
  }

  /**
   * Start the matchmaking loop. Checks for matches every 2 seconds.
   */
  start(): void {
    this.matchInterval = setInterval(() => {
      this.scanAllBrackets().catch((err) =>
        console.error('Matchmaking scan error:', err),
      );
    }, 2000);
    console.log('Matchmaking queue started');
  }

  stop(): void {
    if (this.matchInterval) {
      clearInterval(this.matchInterval);
      this.matchInterval = null;
    }
  }

  /**
   * Add an agent to the matchmaking queue.
   * Validation (team ownership, tier, damage) is done in the API layer.
   */
  async enqueue(entry: QueueEntry): Promise<void> {
    // Check agent isn't already in queue
    const existing = await db
      .select()
      .from(matchmakingQueue)
      .where(eq(matchmakingQueue.address, entry.address.toLowerCase()))
      .limit(1);

    if (existing.length > 0) {
      throw new Error('Already in matchmaking queue');
    }

    await db.insert(matchmakingQueue).values({
      address: entry.address.toLowerCase(),
      teamId: entry.teamId,
      stakeBracket: entry.stakeBracket,
      elo: entry.elo,
    });
  }

  /**
   * Remove an agent from the queue.
   */
  async dequeue(address: string): Promise<void> {
    await db
      .delete(matchmakingQueue)
      .where(eq(matchmakingQueue.address, address.toLowerCase()));
  }

  /**
   * Scan all brackets for matchable pairs.
   */
  private async scanAllBrackets(): Promise<void> {
    for (let bracket = 0; bracket < STAKE_BRACKETS.length; bracket++) {
      await this.tryMatchBracket(bracket);
    }
  }

  /**
   * Attempt to match two agents in a bracket.
   * Pairs agents within ELO range that expands over time.
   */
  private async tryMatchBracket(bracket: number): Promise<void> {
    const candidates = await db
      .select()
      .from(matchmakingQueue)
      .where(eq(matchmakingQueue.stakeBracket, bracket))
      .orderBy(matchmakingQueue.enqueuedAt)
      .limit(50);

    if (candidates.length < 2) return;

    const now = Date.now();

    // Try to find the best pair
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i];
        const b = candidates[j];

        // Calculate dynamic ELO range based on wait time
        const waitA = (now - a.enqueuedAt.getTime()) / 1000;
        const waitB = (now - b.enqueuedAt.getTime()) / 1000;
        const maxWait = Math.max(waitA, waitB);
        const eloRange = BASE_ELO_RANGE + Math.floor(maxWait * ELO_EXPAND_RATE);

        if (Math.abs(a.elo - b.elo) <= eloRange) {
          // Match found — create battle
          await this.createMatch(a.address, b.address, bracket);
          return; // One match per tick per bracket
        }
      }
    }
  }

  /**
   * Create a battle on-chain and remove both players from queue.
   */
  private async createMatch(playerA: string, playerB: string, bracket: number): Promise<void> {
    const stakeAmount = STAKE_BRACKETS[bracket];

    // Remove both from queue first
    await db.delete(matchmakingQueue).where(eq(matchmakingQueue.address, playerA));
    await db.delete(matchmakingQueue).where(eq(matchmakingQueue.address, playerB));

    try {
      const walletClient = getOperatorClient(isTestnet);
      const publicClient = getPublicClient(isTestnet) as any;

      const hash = await walletClient.writeContract({
        address: addresses.battleArena,
        abi: BattleArenaAbi as any,
        functionName: 'createBattle',
        args: [playerA as `0x${string}`, playerB as `0x${string}`, stakeAmount],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Parse battleId from event logs
      const battleCreatedLog = receipt.logs?.find((log: any) => log.topics?.length > 0);
      const battleId = battleCreatedLog
        ? BigInt(battleCreatedLog.topics[1] ?? '0')
        : 0n;

      // Store in DB
      await db.insert(battles).values({
        battleId,
        playerA,
        playerB,
        teamA: 0n, // Filled after team reveal
        teamB: 0n,
        stakeBracket: bracket,
        stakeAmount: stakeAmount.toString(),
        phase: BattlePhase.StakeDeposit,
      });

      // Notify state machine
      if (this.onMatch) {
        this.onMatch(battleId, playerA, playerB, stakeAmount);
      }

      console.log(`Match created: ${playerA} vs ${playerB}, battle #${battleId}, bracket ${bracket}`);
    } catch (err) {
      console.error('Failed to create battle on-chain:', err);
      // Put both back in queue
      const agentA = await db.select().from(agents).where(eq(agents.address, playerA)).limit(1);
      const agentB = await db.select().from(agents).where(eq(agents.address, playerB)).limit(1);

      await db.insert(matchmakingQueue).values({
        address: playerA,
        teamId: 0n,
        stakeBracket: bracket,
        elo: agentA[0]?.elo ?? 1200,
      });
      await db.insert(matchmakingQueue).values({
        address: playerB,
        teamId: 0n,
        stakeBracket: bracket,
        elo: agentB[0]?.elo ?? 1200,
      });
    }
  }
}
