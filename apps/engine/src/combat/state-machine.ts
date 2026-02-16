import type { CombatResolver } from './resolver';

export enum EnginePhase {
  WaitingForDeposits = 'waiting_for_deposits',
  WaitingForTeamCommits = 'waiting_for_team_commits',
  WaitingForTeamReveals = 'waiting_for_team_reveals',
  WaitingForMoveCommits = 'waiting_for_move_commits',
  WaitingForMoveReveals = 'waiting_for_move_reveals',
  ResolvingRound = 'resolving_round',
  Settling = 'settling',
  Complete = 'complete',
}

/**
 * Manages the off-chain lifecycle of a battle.
 * Coordinates with BattleArena.sol on-chain state.
 *
 * Flow:
 * 1. Matchmaker creates battle on-chain → engine tracks it
 * 2. Both players deposit → engine starts team commit phase
 * 3. Both teams committed + revealed → engine starts combat rounds
 * 4. Each round: commit moves → reveal moves → off-chain resolution
 * 5. After max rounds or team eliminated → settle on-chain
 */
export class BattleStateMachine {
  constructor(private resolver: CombatResolver) {}

  /**
   * Process a battle event and advance state.
   *
   * TODO: Implement state transitions:
   * - On deposit received: check if both deposited → advance to team commit
   * - On team committed: check if both committed → advance to team reveal
   * - On team revealed: check if both revealed → start round 1
   * - On move committed: check if both committed → advance to reveal
   * - On move revealed: check if both revealed → resolve round
   * - On round resolved: check win condition → next round or settle
   * - On timeout: handle forfeit/slash
   */
  async processEvent(_battleId: bigint, _event: string, _data: unknown): Promise<void> {
    // TODO: Implement event-driven state machine
    throw new Error('Not implemented');
  }
}
