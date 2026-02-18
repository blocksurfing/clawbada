/**
 * Watches BattleArena events and syncs battle state to DB.
 *
 * Events: BattleCreated, StakeDeposited, TeamCommitted, TeamRevealed,
 *         MoveCommitted, MoveRevealed, BattleSettled, BattleCancelled,
 *         DamageApplied, AntiGriefSlashed
 */
import type { Log } from 'viem';
import { eq } from 'drizzle-orm';
import { BattleArenaAbi, addresses } from '@clawbada/chain';
import { db, battles } from '@clawbada/db';
import { EventWatcher, type WatcherConfig } from '../lib/event-processor';

export class BattleWatcher extends EventWatcher {
  readonly config: WatcherConfig = {
    contractName: 'BattleArena',
    abi: BattleArenaAbi as any,
    address: addresses.battleArena,
    events: [
      'BattleCreated', 'StakeDeposited', 'TeamCommitted', 'TeamRevealed',
      'MoveCommitted', 'MoveRevealed', 'BattleSettled', 'BattleCancelled',
      'DamageApplied', 'AntiGriefSlashed',
    ],
  };

  async handleEvent(log: Log): Promise<void> {
    const event = log as any;
    const name = event.eventName;
    const args = event.args ?? {};

    switch (name) {
      case 'BattleCreated': {
        const battleId = BigInt(args.battleId);
        const existing = await db
          .select()
          .from(battles)
          .where(eq(battles.battleId, battleId))
          .limit(1);

        if (existing.length === 0) {
          await db.insert(battles).values({
            battleId,
            playerA: (args.playerA as string).toLowerCase(),
            playerB: (args.playerB as string).toLowerCase(),
            teamA: 0n,
            teamB: 0n,
            stakeBracket: 0,
            stakeAmount: BigInt(args.stakeAmount).toString(),
            phase: 1, // StakeDeposit
          });
        }
        break;
      }

      case 'StakeDeposited': {
        const battleId = BigInt(args.battleId);
        if (args.bothDeposited) {
          await db
            .update(battles)
            .set({ phase: 2 }) // TeamCommit
            .where(eq(battles.battleId, battleId));
        }
        break;
      }

      case 'TeamRevealed': {
        const battleId = BigInt(args.battleId);
        const player = (args.player as string).toLowerCase();
        const teamId = BigInt(args.teamId);

        const battle = await db
          .select()
          .from(battles)
          .where(eq(battles.battleId, battleId))
          .limit(1);

        if (battle.length > 0) {
          const isPlayerA = battle[0].playerA === player;
          await db
            .update(battles)
            .set(isPlayerA ? { teamA: teamId } : { teamB: teamId })
            .where(eq(battles.battleId, battleId));
        }
        break;
      }

      case 'BattleSettled': {
        const battleId = BigInt(args.battleId);
        await db
          .update(battles)
          .set({
            winner: (args.winner as string).toLowerCase(),
            phase: 7, // Completed
            settledAt: new Date(),
          })
          .where(eq(battles.battleId, battleId));
        break;
      }

      case 'BattleCancelled': {
        const battleId = BigInt(args.battleId);
        await db
          .update(battles)
          .set({ phase: 8 }) // Cancelled
          .where(eq(battles.battleId, battleId));
        break;
      }

      // Other events logged in on_chain_events via base class
      case 'TeamCommitted':
      case 'MoveCommitted':
      case 'MoveRevealed':
      case 'DamageApplied':
      case 'AntiGriefSlashed':
        break;
    }
  }
}
