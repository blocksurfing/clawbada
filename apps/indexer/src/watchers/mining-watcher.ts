/**
 * Watches MiningPool events and syncs expedition/season state to DB.
 *
 * Events: SeasonStarted, ExpeditionStarted, ExpeditionClaimed, BaseRewardUpdated
 */
import type { Log } from 'viem';
import { eq } from 'drizzle-orm';
import { MiningPoolAbi, addresses } from '@clawbada/chain';
import { db, expeditions, seasons } from '@clawbada/db';
import { EventWatcher, type WatcherConfig } from '../lib/event-processor';

export class MiningWatcher extends EventWatcher {
  readonly config: WatcherConfig = {
    contractName: 'MiningPool',
    abi: MiningPoolAbi as any,
    address: addresses.miningPool,
    events: ['SeasonStarted', 'ExpeditionStarted', 'ExpeditionClaimed', 'BaseRewardUpdated'],
  };

  async handleEvent(log: Log): Promise<void> {
    const event = log as any;
    const name = event.eventName;
    const args = event.args ?? {};

    switch (name) {
      case 'SeasonStarted': {
        const season = Number(args.season);
        await db.insert(seasons).values({
          season,
          totalEmission: BigInt(args.totalEmission).toString(),
          baseReward: BigInt(args.baseReward).toString(),
          totalMinted: '0',
          startTime: new Date(Number(args.startTime) * 1000),
        });
        break;
      }

      case 'ExpeditionStarted': {
        const expeditionId = BigInt(args.expeditionId);
        await db.insert(expeditions).values({
          expeditionId,
          teamId: BigInt(args.teamId),
          owner: (args.owner as string).toLowerCase(),
          season: Number(args.season),
          mineTier: Number(args.mineTier),
          startTime: BigInt(args.startTime),
          reward: BigInt(args.reward).toString(),
          claimed: false,
        });
        break;
      }

      case 'ExpeditionClaimed': {
        const expeditionId = BigInt(args.expeditionId);
        await db
          .update(expeditions)
          .set({ claimed: true, claimedAt: new Date() })
          .where(eq(expeditions.expeditionId, expeditionId));

        // Update season totalMinted
        const exp = await db
          .select()
          .from(expeditions)
          .where(eq(expeditions.expeditionId, expeditionId))
          .limit(1);

        if (exp.length > 0) {
          const seasonData = await db
            .select()
            .from(seasons)
            .where(eq(seasons.season, exp[0].season))
            .limit(1);

          if (seasonData.length > 0) {
            const newMinted = BigInt(seasonData[0].totalMinted) + BigInt(exp[0].reward);
            await db
              .update(seasons)
              .set({ totalMinted: newMinted.toString() })
              .where(eq(seasons.season, exp[0].season));
          }
        }
        break;
      }

      case 'BaseRewardUpdated': {
        const season = Number(args.season);
        const newBaseReward = BigInt(args.newBaseReward);
        await db
          .update(seasons)
          .set({ baseReward: newBaseReward.toString() })
          .where(eq(seasons.season, season));
        break;
      }
    }
  }
}
