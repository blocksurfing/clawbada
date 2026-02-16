import type { Log } from 'viem';
import { EventWatcher, type WatcherConfig } from '../lib/event-processor';

/**
 * Watches BattleArena events and syncs battle state to DB.
 *
 * Events: BattleCreated, StakeDeposited, TeamCommitted, TeamRevealed,
 *         RoundStarted, MoveCommitted, MoveRevealed, BattleSettled,
 *         BattleCancelled, DamageApplied, AntiGriefSlashed
 */
export class BattleWatcher extends EventWatcher {
  readonly config: WatcherConfig = {
    contractName: 'BattleArena',
    abi: [], // TODO: Import from @clawbada/chain
    address: (process.env.BATTLE_ARENA_ADDRESS ?? '0x') as `0x${string}`,
    events: [
      'BattleCreated',
      'StakeDeposited',
      'TeamCommitted',
      'TeamRevealed',
      'RoundStarted',
      'MoveCommitted',
      'MoveRevealed',
      'BattleSettled',
      'BattleCancelled',
      'DamageApplied',
      'AntiGriefSlashed',
    ],
  };

  async handleEvent(_log: Log): Promise<void> {
    // TODO: Decode event, update battles/battle_rounds tables
  }
}
