/**
 * Watches LobsterNFT events and syncs lobster state to DB.
 *
 * Events: LobsterMinted, LobsterBurned, LobsterEvolved,
 *         LobsterDamageUpdated, LobsterLocked, LobsterBred
 */
import type { Log } from 'viem';
import { and, eq, isNull, or } from 'drizzle-orm';
import { LobsterNFTAbi, addresses } from '@clawbada/chain';
import { decodeDNA } from '@clawbada/game-logic';
import { db, lobsters, teams, applyPowerChange, currentBoostEpochId } from '@clawbada/db';
import { EventWatcher, type WatcherConfig } from '../lib/event-processor';
import { loadTeamPower } from '../lib/roster';
// Aliased: `handleEvent(log: Log)` shadows the module-scope name.
import { log as pinoLog } from '../logger';

export class LobsterWatcher extends EventWatcher {
  readonly config: WatcherConfig = {
    contractName: 'LobsterNFT',
    abi: LobsterNFTAbi as any,
    address: addresses.lobsterNFT,
    events: ['LobsterMinted', 'LobsterBurned', 'LobsterEvolved', 'LobsterDamageUpdated', 'LobsterLocked', 'LobsterBred'],
  };

  async handleEvent(log: Log): Promise<void> {
    const event = log as any;
    const name = event.eventName;
    const args = event.args ?? {};

    switch (name) {
      case 'LobsterMinted': {
        const tokenId = BigInt(args.tokenId);
        const dna = BigInt(args.dna);
        const decoded = decodeDNA(dna);

        await db.insert(lobsters).values({
          tokenId,
          owner: (args.owner as string).toLowerCase(),
          dna: dna.toString(),
          class: decoded.class,
          legend: decoded.legend,
          breedType: decoded.breedType,
          purity: decoded.purity,
          evolutionTier: 0,
          damage: 0,
          breedCount: 0,
          generation: Number(args.generation ?? 0),
          soulbound: args.soulbound ?? false,
          locked: false,
        });
        break;
      }

      case 'LobsterBurned': {
        const tokenId = BigInt(args.tokenId);
        await db.delete(lobsters).where(eq(lobsters.tokenId, tokenId));
        break;
      }

      case 'LobsterEvolved': {
        const tokenId = BigInt(args.tokenId);
        const newTier = Number(args.newTier);
        await db
          .update(lobsters)
          .set({ evolutionTier: newTier, updatedAt: new Date() })
          .where(eq(lobsters.tokenId, tokenId));

        // Boost: TeamManager emits nothing when a member evolves, so the
        // team's Power change is derived here.
        await this.resetTeamPowerIfChanged(tokenId);
        break;
      }

      case 'LobsterDamageUpdated': {
        const tokenId = BigInt(args.tokenId);
        const damage = Number(args.newDamage);
        await db
          .update(lobsters)
          .set({ damage, updatedAt: new Date() })
          .where(eq(lobsters.tokenId, tokenId));
        break;
      }

      case 'LobsterLocked': {
        const tokenId = BigInt(args.tokenId);
        const locked = args.locked as boolean;
        await db
          .update(lobsters)
          .set({ locked, updatedAt: new Date() })
          .where(eq(lobsters.tokenId, tokenId));
        break;
      }

      case 'LobsterBred': {
        // Update parent breed count
        if (args.parentId) {
          await db
            .update(lobsters)
            .set({ breedCount: Number(args.parentBreedCount ?? 0), updatedAt: new Date() })
            .where(eq(lobsters.tokenId, BigInt(args.parentId)));
        }
        break;
      }
    }
  }

  /** Boost: a Power change forces a full re-qualification (`applyPowerChange`: rating
   *  back to baseline, played counter cleared). Unrated or still-Base rosters are no-ops,
   *  and the API's queue join re-checks power via ensureTeamRating, so failures are
   *  logged rather than thrown. On chain `teamBoostBps` already returns 0 on a power
   *  mismatch, so no mid-epoch amend tx is needed. */
  private async resetTeamPowerIfChanged(tokenId: bigint): Promise<void> {
    try {
      const [team] = await db
        .select({
          teamId: teams.teamId,
          lobster0: teams.lobster0,
          lobster1: teams.lobster1,
          lobster2: teams.lobster2,
        })
        .from(teams)
        .where(
          and(
            isNull(teams.disbandedAt),
            or(eq(teams.lobster0, tokenId), eq(teams.lobster1, tokenId), eq(teams.lobster2, tokenId)),
          ),
        )
        .limit(1);
      if (!team) return;

      const power = await loadTeamPower([team.lobster0, team.lobster1, team.lobster2]);
      if (power === null) return;

      const epochId = await currentBoostEpochId(db);
      const reset = await applyPowerChange(db, team.teamId, power, epochId);
      if (reset) {
        pinoLog.info(
          {
            teamId: team.teamId.toString(),
            tokenId: tokenId.toString(),
            power,
            epochId,
            module: 'lobster-watcher',
            op: 'LobsterEvolved',
          },
          'team power changed - rating reset to baseline',
        );
      }
    } catch (err) {
      pinoLog.error(
        { err, tokenId: tokenId.toString(), module: 'lobster-watcher', op: 'LobsterEvolved' },
        'failed to apply team power change; queue join re-checks power',
      );
    }
  }
}
