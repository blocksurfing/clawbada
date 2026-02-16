import { STAKE_BRACKETS } from '@clawbada/game-logic';

interface QueueEntry {
  address: string;
  teamId: bigint;
  stakeBracket: number;
  elo: number;
  queuedAt: Date;
}

/**
 * ELO-based matchmaking within stake brackets.
 *
 * Agents join a queue with their team and desired stake bracket.
 * The matchmaker pairs agents with similar ELO ratings within
 * the same bracket.
 *
 * S1 brackets: Low (2,500), Mid (10,000), High (50,000) $CLAW
 */
export class MatchmakingQueue {
  private queues: Map<number, QueueEntry[]> = new Map();

  constructor() {
    // Initialize a queue per stake bracket
    for (let i = 0; i < STAKE_BRACKETS.length; i++) {
      this.queues.set(i, []);
    }
  }

  /**
   * Add an agent to the matchmaking queue.
   *
   * TODO: Implement:
   * 1. Validate team exists and meets battle requirements (Evolved+, damage < 80)
   * 2. Check agent isn't already in queue
   * 3. Add to appropriate bracket queue
   * 4. Persist to matchmaking_queue DB table
   * 5. Attempt immediate match
   */
  async enqueue(_entry: QueueEntry): Promise<void> {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  /**
   * Remove an agent from the queue.
   */
  async dequeue(_address: string): Promise<void> {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  /**
   * Attempt to match two agents in a bracket.
   * Pairs agents within ELO range (e.g., ±200 expanding over time).
   *
   * TODO: Implement:
   * 1. Sort bracket queue by ELO
   * 2. Find closest ELO pair within acceptable range
   * 3. Range expands the longer agents wait (10 ELO/second)
   * 4. On match: create battle on-chain via BattleArena.createBattle()
   * 5. Remove both from queue, notify via WebSocket
   */
  async tryMatch(_bracket: number): Promise<void> {
    // TODO: Implement
    throw new Error('Not implemented');
  }
}
