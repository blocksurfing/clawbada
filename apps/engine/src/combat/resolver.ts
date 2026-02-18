/**
 * Off-chain battle round resolver.
 *
 * Thin wrapper around @clawbada/game-logic battle simulation.
 * The game-logic package contains the full deterministic combat engine —
 * this module bridges it with the DB and chain data.
 */
import {
  initBattle,
  resolveRound as gameResolveRound,
  simulateBattle,
  type BattleState,
  type FullBattleResult,
  type Lobster,
  type BattleMove,
  type RoundResult,
  decodeDNA,
  LegendStatus,
} from '@clawbada/game-logic';

/**
 * Convert chain lobster data into the Lobster interface expected by game-logic.
 */
export function toLobster(chain: {
  tokenId: bigint;
  owner: string;
  dna: bigint;
  evolutionTier: number;
  damage: number;
  breedCount: number;
  generation: number;
  soulbound: boolean;
  locked: boolean;
  purity: number;
}): Lobster {
  const decoded = decodeDNA(chain.dna);
  return {
    tokenId: chain.tokenId,
    owner: chain.owner,
    dna: chain.dna,
    class: decoded.class,
    legend: decoded.legend,
    breedType: decoded.breedType,
    purity: chain.purity,
    evolutionTier: chain.evolutionTier,
    damage: chain.damage,
    breedCount: chain.breedCount,
    generation: chain.generation,
    soulbound: chain.soulbound,
    locked: chain.locked,
  };
}

export class CombatResolver {
  /**
   * Initialize a battle state for round-by-round resolution.
   */
  initBattle(teamA: Lobster[], teamB: Lobster[], vrfSeed: bigint): BattleState {
    return initBattle(teamA, teamB, vrfSeed);
  }

  /**
   * Resolve a single round within an active battle state.
   * Mutates the state in-place and returns the round result.
   */
  resolveRound(state: BattleState, movesA: BattleMove[], movesB: BattleMove[]): RoundResult {
    return gameResolveRound(state, movesA, movesB);
  }

  /**
   * Run a full battle simulation with all moves provided upfront.
   * Used for testing or when replaying battles.
   */
  simulateFull(
    teamA: Lobster[],
    teamB: Lobster[],
    allMoves: [BattleMove[], BattleMove[]][],
    vrfSeed: bigint,
  ): FullBattleResult {
    return simulateBattle(teamA, teamB, allMoves, vrfSeed);
  }

  /**
   * Check if a battle state has reached a win condition.
   */
  isFinished(state: BattleState): boolean {
    return state.finished;
  }

  /**
   * Get the winner from a finished battle state.
   */
  getWinner(state: BattleState): 'A' | 'B' | 'draw' | null {
    return state.winner;
  }
}
