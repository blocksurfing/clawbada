/**
 * Watches LobsterNFT events and syncs lobster state to DB.
 *
 * Events: LobsterMinted, LobsterBurned, LobsterEvolved,
 *         LobsterDamageUpdated, LobsterLocked, LobsterBred
 */
import type { Log } from 'viem';
import { eq } from 'drizzle-orm';
import { LobsterNFTAbi, addresses } from '@clawbada/chain';
import { decodeDNA } from '@clawbada/game-logic';
import { db, lobsters } from '@clawbada/db';
import { EventWatcher, type WatcherConfig } from '../lib/event-processor';

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
}
