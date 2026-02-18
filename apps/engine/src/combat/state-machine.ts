/**
 * Manages the off-chain lifecycle of battles.
 * Coordinates with BattleArena.sol on-chain state.
 *
 * Flow:
 * 1. Matchmaker creates battle on-chain → engine tracks it
 * 2. Both players deposit → engine starts team commit phase
 * 3. Both teams committed + revealed → engine starts combat rounds
 * 4. Each round: commit moves → reveal moves → off-chain resolution
 * 5. After max rounds or team eliminated → settle on-chain
 */
import { eq } from 'drizzle-orm';
import {
  MAX_ROUNDS,
  BATTLE_PROTOCOL_FEE_BPS,
  STAKE_BRACKETS,
  type BattleState,
  type BattleMove,
  type Lobster,
} from '@clawbada/game-logic';
import {
  getPublicClient,
  getOperatorClient,
  getBattleArena,
  getLobsterNFT,
  addresses,
  BattleArenaAbi,
} from '@clawbada/chain';
import { db, battles, battleRounds, agents } from '@clawbada/db';
import { CombatResolver, toLobster } from './resolver';
import { DrandClient } from '../vrf/drand';
import { calculateNewElo } from '../matchmaking/elo';

export type BattleEvent =
  | { type: 'deposit'; player: string }
  | { type: 'team_commit'; player: string; commitHash: string }
  | { type: 'team_reveal'; player: string; teamId: bigint }
  | { type: 'move_commit'; player: string; commitHash: string }
  | { type: 'move_reveal'; player: string; moves: BattleMove[] }
  | { type: 'timeout'; player: string };

interface ActiveBattle {
  battleId: bigint;
  playerA: string;
  playerB: string;
  stakeAmount: bigint;
  state: BattleState | null;
  teamALobsters: Lobster[] | null;
  teamBLobsters: Lobster[] | null;
  depositsA: boolean;
  depositsB: boolean;
  teamCommitA: boolean;
  teamCommitB: boolean;
  teamRevealedA: boolean;
  teamRevealedB: boolean;
  moveCommitA: boolean;
  moveCommitB: boolean;
  moveRevealA: BattleMove[] | null;
  moveRevealB: BattleMove[] | null;
  timeoutCountA: number;
  timeoutCountB: number;
}

const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
const AUTO_FORFEIT_TIMEOUTS = 3;

export class BattleStateMachine {
  private activeBattles: Map<string, ActiveBattle> = new Map();
  private resolver: CombatResolver;
  private drand: DrandClient;
  private onBroadcast: ((battleId: string, event: string, data: unknown) => void) | null = null;

  constructor(resolver: CombatResolver, drand: DrandClient) {
    this.resolver = resolver;
    this.drand = drand;
  }

  /** Register a broadcast callback for WebSocket notifications. */
  setBroadcast(fn: (battleId: string, event: string, data: unknown) => void): void {
    this.onBroadcast = fn;
  }

  /** Track a newly created battle. */
  trackBattle(battleId: bigint, playerA: string, playerB: string, stakeAmount: bigint): void {
    this.activeBattles.set(battleId.toString(), {
      battleId,
      playerA: playerA.toLowerCase(),
      playerB: playerB.toLowerCase(),
      stakeAmount,
      state: null,
      teamALobsters: null,
      teamBLobsters: null,
      depositsA: false,
      depositsB: false,
      teamCommitA: false,
      teamCommitB: false,
      teamRevealedA: false,
      teamRevealedB: false,
      moveCommitA: false,
      moveCommitB: false,
      moveRevealA: null,
      moveRevealB: null,
      timeoutCountA: 0,
      timeoutCountB: 0,
    });
  }

  /** Process a battle event and advance state. */
  async processEvent(battleId: bigint, event: BattleEvent): Promise<void> {
    const key = battleId.toString();
    const battle = this.activeBattles.get(key);
    if (!battle) return;

    const isPlayerA = event.type !== 'timeout'
      ? event.player.toLowerCase() === battle.playerA
      : event.player.toLowerCase() === battle.playerA;

    switch (event.type) {
      case 'deposit':
        if (isPlayerA) battle.depositsA = true;
        else battle.depositsB = true;
        if (battle.depositsA && battle.depositsB) {
          this.broadcast(key, 'deposits_confirmed', { battleId: key });
        }
        break;

      case 'team_commit':
        if (isPlayerA) battle.teamCommitA = true;
        else battle.teamCommitB = true;
        break;

      case 'team_reveal':
        await this.handleTeamReveal(battle, isPlayerA, event.teamId);
        break;

      case 'move_commit':
        if (isPlayerA) battle.moveCommitA = true;
        else battle.moveCommitB = true;
        break;

      case 'move_reveal':
        if (isPlayerA) battle.moveRevealA = event.moves;
        else battle.moveRevealB = event.moves;
        if (battle.moveRevealA && battle.moveRevealB) {
          await this.resolveCurrentRound(battle);
        }
        break;

      case 'timeout':
        await this.handleTimeout(battle, isPlayerA);
        break;
    }
  }

  private async handleTeamReveal(battle: ActiveBattle, isPlayerA: boolean, teamId: bigint): Promise<void> {
    if (isPlayerA) battle.teamRevealedA = true;
    else battle.teamRevealedB = true;

    // Load team lobsters from chain
    const lobsters = await this.loadTeamLobsters(teamId);
    if (isPlayerA) battle.teamALobsters = lobsters;
    else battle.teamBLobsters = lobsters;

    // If both revealed, initialize battle state
    if (battle.teamRevealedA && battle.teamRevealedB && battle.teamALobsters && battle.teamBLobsters) {
      const beacon = await this.drand.fetchLatest();
      const vrfSeed = this.drand.toBigInt(beacon.randomness);
      battle.state = this.resolver.initBattle(battle.teamALobsters, battle.teamBLobsters, vrfSeed);

      // Submit beacon on-chain for verification
      try {
        await this.drand.submitToChain(beacon.round, beacon.randomness);
      } catch (err) {
        console.error(`Failed to submit VRF beacon for battle ${battle.battleId}:`, err);
      }

      this.broadcast(battle.battleId.toString(), 'battle_started', {
        battleId: battle.battleId.toString(),
        round: 1,
      });
    }
  }

  private async resolveCurrentRound(battle: ActiveBattle): Promise<void> {
    if (!battle.state || !battle.moveRevealA || !battle.moveRevealB) return;

    const roundResult = this.resolver.resolveRound(battle.state, battle.moveRevealA, battle.moveRevealB);

    // Store round result in DB
    await db.insert(battleRounds).values({
      battleId: battle.battleId,
      round: roundResult.round,
      actions: roundResult.actions as any,
      teamAHp: roundResult.teamAHp.map(String) as any,
      teamBHp: roundResult.teamBHp.map(String) as any,
      vrfSeed: battle.state.vrfSeed.toString(),
    });

    this.broadcast(battle.battleId.toString(), 'round_result', {
      battleId: battle.battleId.toString(),
      round: roundResult.round,
      actions: roundResult.actions,
      teamAHp: roundResult.teamAHp.map(String),
      teamBHp: roundResult.teamBHp.map(String),
    });

    // Reset move state for next round
    battle.moveCommitA = false;
    battle.moveCommitB = false;
    battle.moveRevealA = null;
    battle.moveRevealB = null;

    // Check if battle is over
    if (this.resolver.isFinished(battle.state)) {
      await this.settleBattle(battle);
    } else {
      // Advance round on-chain
      try {
        await this.advanceRoundOnChain(battle.battleId);
      } catch (err) {
        console.error(`Failed to advance round on-chain for battle ${battle.battleId}:`, err);
      }
    }
  }

  private async settleBattle(battle: ActiveBattle): Promise<void> {
    if (!battle.state) return;

    const winner = this.resolver.getWinner(battle.state);
    const winnerAddress = winner === 'A' ? battle.playerA : winner === 'B' ? battle.playerB : battle.playerA; // draw → playerA
    const loserAddress = winnerAddress === battle.playerA ? battle.playerB : battle.playerA;

    // Calculate payouts
    const combinedPot = battle.stakeAmount * 2n;
    const protocolFee = (combinedPot * BATTLE_PROTOCOL_FEE_BPS) / 10000n;
    const winnerPayout = combinedPot - protocolFee;

    // Update DB
    await db
      .update(battles)
      .set({
        winner: winnerAddress,
        protocolFee: protocolFee.toString(),
        winnerPayout: winnerPayout.toString(),
        totalRounds: battle.state.round,
        settledAt: new Date(),
      })
      .where(eq(battles.battleId, battle.battleId));

    // Update ELO
    const agentA = await db.select().from(agents).where(eq(agents.address, battle.playerA)).limit(1);
    const agentB = await db.select().from(agents).where(eq(agents.address, battle.playerB)).limit(1);
    const eloA = agentA.length > 0 ? agentA[0].elo : 1200;
    const eloB = agentB.length > 0 ? agentB[0].elo : 1200;

    const isWinnerA = winnerAddress === battle.playerA;
    const { newWinnerElo, newLoserElo } = calculateNewElo(
      isWinnerA ? eloA : eloB,
      isWinnerA ? eloB : eloA,
    );

    await db
      .update(agents)
      .set({
        elo: isWinnerA ? newWinnerElo : newLoserElo,
        wins: isWinnerA ? (agentA[0]?.wins ?? 0) + 1 : agentA[0]?.wins ?? 0,
        losses: isWinnerA ? agentA[0]?.losses ?? 0 : (agentA[0]?.losses ?? 0) + 1,
        totalBattles: (agentA[0]?.totalBattles ?? 0) + 1,
      })
      .where(eq(agents.address, battle.playerA));

    await db
      .update(agents)
      .set({
        elo: isWinnerA ? newLoserElo : newWinnerElo,
        wins: isWinnerA ? agentB[0]?.wins ?? 0 : (agentB[0]?.wins ?? 0) + 1,
        losses: isWinnerA ? (agentB[0]?.losses ?? 0) + 1 : agentB[0]?.losses ?? 0,
        totalBattles: (agentB[0]?.totalBattles ?? 0) + 1,
      })
      .where(eq(agents.address, battle.playerB));

    // Settle on-chain via operator
    try {
      await this.settleOnChain(
        battle.battleId,
        winnerAddress as `0x${string}`,
        [0, 0, 0] as [number, number, number], // Damage applied separately via RepairShop
        [0, 0, 0] as [number, number, number],
      );
    } catch (err) {
      console.error(`Failed to settle battle ${battle.battleId} on-chain:`, err);
    }

    this.broadcast(battle.battleId.toString(), 'battle_settled', {
      battleId: battle.battleId.toString(),
      winner: winnerAddress,
      winnerPayout: winnerPayout.toString(),
      protocolFee: protocolFee.toString(),
      totalRounds: battle.state.round,
    });

    // Cleanup
    this.activeBattles.delete(battle.battleId.toString());
  }

  private async handleTimeout(battle: ActiveBattle, isPlayerA: boolean): Promise<void> {
    if (isPlayerA) battle.timeoutCountA++;
    else battle.timeoutCountB++;

    const count = isPlayerA ? battle.timeoutCountA : battle.timeoutCountB;
    if (count >= AUTO_FORFEIT_TIMEOUTS) {
      // Force forfeit — the other player wins
      const forfeiter = isPlayerA ? battle.playerA : battle.playerB;
      const winnerAddress = isPlayerA ? battle.playerB : battle.playerA;

      await db
        .update(battles)
        .set({
          winner: winnerAddress,
          totalRounds: battle.state?.round ?? 0,
          settledAt: new Date(),
        })
        .where(eq(battles.battleId, battle.battleId));

      this.broadcast(battle.battleId.toString(), 'battle_forfeit', {
        battleId: battle.battleId.toString(),
        forfeiter,
        winner: winnerAddress,
      });

      this.activeBattles.delete(battle.battleId.toString());
    }
  }

  private async loadTeamLobsters(teamId: bigint): Promise<Lobster[]> {
    const publicClient = getPublicClient(isTestnet) as any;
    const nft = getLobsterNFT(publicClient);

    // Get team from TeamManager
    const { getTeamManager } = await import('@clawbada/chain');
    const tm = getTeamManager(publicClient);
    const teamData = await tm.read.getTeam([teamId]);
    const lobsterIds = teamData.lobsterIds as unknown as bigint[];

    const lobsters: Lobster[] = [];
    for (const id of lobsterIds) {
      const [data, owner, purity] = await Promise.all([
        nft.read.getLobster([id]),
        nft.read.ownerOf([id]),
        nft.read.getPurity([id]),
      ]);
      lobsters.push(
        toLobster({
          tokenId: id,
          owner: owner as string,
          dna: data.dna,
          evolutionTier: data.evolutionTier,
          damage: data.damage,
          breedCount: data.breedCount,
          generation: data.generation,
          soulbound: data.soulbound,
          locked: data.locked,
          purity: Number(purity),
        }),
      );
    }
    return lobsters;
  }

  private async settleOnChain(
    battleId: bigint,
    winner: `0x${string}`,
    winnerDamage: [number, number, number],
    loserDamage: [number, number, number],
  ): Promise<void> {
    const walletClient = getOperatorClient(isTestnet);
    const publicClient = getPublicClient(isTestnet) as any;

    const hash = await walletClient.writeContract({
      address: addresses.battleArena,
      abi: BattleArenaAbi as any,
      functionName: 'settle',
      args: [battleId, winner, winnerDamage, loserDamage],
    });

    await publicClient.waitForTransactionReceipt({ hash });
  }

  private async advanceRoundOnChain(battleId: bigint): Promise<void> {
    const walletClient = getOperatorClient(isTestnet);
    const publicClient = getPublicClient(isTestnet) as any;

    const hash = await walletClient.writeContract({
      address: addresses.battleArena,
      abi: BattleArenaAbi as any,
      functionName: 'advanceRound',
      args: [battleId],
    });

    await publicClient.waitForTransactionReceipt({ hash });
  }

  private broadcast(battleId: string, event: string, data: unknown): void {
    if (this.onBroadcast) {
      this.onBroadcast(battleId, event, data);
    }
  }
}
