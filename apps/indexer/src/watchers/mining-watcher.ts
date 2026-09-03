/**
 * Watches MiningPool events and syncs expedition/season state to DB.
 *
 * Events: SeasonStarted, ExpeditionStarted, ExpeditionClaimed, BaseRewardUpdated
 */
import type { Log } from 'viem';
import { desc, eq } from 'drizzle-orm';
import { MiningPoolAbi, addresses, getPublicClient } from '@clawbada/chain';
import { db, expeditions, seasons } from '@clawbada/db';
import { EventWatcher, type WatcherConfig } from '../lib/event-processor';
// Aliased: `handleEvent(log: Log)` shadows the module-scope name.
import { log as pinoLog } from '../logger';

const isTestnet = process.env.CHAIN_ENV !== 'mainnet';

/** Lazy module-scope client (same pattern as battle-watcher's getArena): one viem
 *  client for every block read instead of one per event. */
let cachedClient: any = null;
function getClient() {
  if (!cachedClient) cachedClient = getPublicClient(isTestnet);
  return cachedClient;
}

/** ExpeditionStarted carries no timestamp, but MiningPool stores
 *  `startTime = block.timestamp`, so the event's block is the exact value. Falls back
 *  to wall-clock (with a warning) if the read fails: a row with an approximate start
 *  beats a missing row, because ExpeditionClaimed accounting needs it. */
async function readBlockTimestamp(blockNumber: bigint | null | undefined, expeditionId: bigint): Promise<bigint> {
  if (blockNumber != null) {
    try {
      const block = await getClient().getBlock({ blockNumber });
      return BigInt(block.timestamp);
    } catch (err) {
      pinoLog.warn(
        { err, expeditionId: expeditionId.toString(), blockNumber: blockNumber.toString(), module: 'mining-watcher', op: 'ExpeditionStarted' },
        'getBlock failed - expedition startTime approximated with wall-clock',
      );
    }
  } else {
    pinoLog.warn(
      { expeditionId: expeditionId.toString(), module: 'mining-watcher', op: 'ExpeditionStarted' },
      'log has no blockNumber - expedition startTime approximated with wall-clock',
    );
  }
  return BigInt(Math.floor(Date.now() / 1000));
}

/** The event carries no season either; MiningPool stamps `currentSeason`, which is the
 *  latest SeasonStarted this watcher has mirrored (logs are processed in block order, so
 *  a later season's row cannot exist yet). 1 before the first SeasonStarted lands. */
async function latestSeasonNumber(): Promise<number> {
  const [row] = await db
    .select({ season: seasons.season })
    .from(seasons)
    .orderBy(desc(seasons.season))
    .limit(1);
  return row?.season ?? 1;
}

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
        // Event: (expeditionId, teamId, owner, mineTier, reward, boostBps).
        // This handler used to read `args.season` / `args.startTime`, which
        // the event never carried (NaN season, BigInt(undefined) throw).
        const expeditionId = BigInt(args.expeditionId);
        const startTime = await readBlockTimestamp(log.blockNumber, expeditionId);
        const season = await latestSeasonNumber();
        await db.insert(expeditions).values({
          expeditionId,
          teamId: BigInt(args.teamId),
          owner: (args.owner as string).toLowerCase(),
          season,
          mineTier: Number(args.mineTier),
          startTime,
          reward: BigInt(args.reward).toString(),
          // Boost telemetry: bps applied at start (0 when no boost was live).
          boostBps: Number(args.boostBps ?? 0),
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
