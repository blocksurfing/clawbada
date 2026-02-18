/**
 * Watches Marketplace events and syncs listing state to DB.
 *
 * Events: LobsterListed, LobsterSold, ListingCancelled, ListingPriceUpdated
 */
import type { Log } from 'viem';
import { eq } from 'drizzle-orm';
import { MarketplaceAbi, addresses } from '@clawbada/chain';
import { db, listings, priceHistory } from '@clawbada/db';
import { EventWatcher, type WatcherConfig } from '../lib/event-processor';

export class MarketplaceWatcher extends EventWatcher {
  readonly config: WatcherConfig = {
    contractName: 'Marketplace',
    abi: MarketplaceAbi as any,
    address: addresses.marketplace,
    events: ['LobsterListed', 'LobsterSold', 'ListingCancelled', 'ListingPriceUpdated'],
  };

  async handleEvent(log: Log): Promise<void> {
    const event = log as any;
    const name = event.eventName;
    const args = event.args ?? {};

    switch (name) {
      case 'LobsterListed': {
        const listingId = BigInt(args.listingId);
        await db.insert(listings).values({
          listingId,
          tokenId: BigInt(args.tokenId),
          seller: (args.seller as string).toLowerCase(),
          price: BigInt(args.price).toString(),
          active: true,
        });
        break;
      }

      case 'LobsterSold': {
        const listingId = BigInt(args.listingId);
        const buyer = (args.buyer as string).toLowerCase();

        await db
          .update(listings)
          .set({ active: false, buyer, soldAt: new Date() })
          .where(eq(listings.listingId, listingId));

        // Record in price history
        const listing = await db
          .select()
          .from(listings)
          .where(eq(listings.listingId, listingId))
          .limit(1);

        if (listing.length > 0) {
          await db.insert(priceHistory).values({
            tokenId: listing[0].tokenId,
            price: listing[0].price,
            seller: listing[0].seller,
            buyer,
            txHash: log.transactionHash ?? '',
          });
        }
        break;
      }

      case 'ListingCancelled': {
        const listingId = BigInt(args.listingId);
        await db
          .update(listings)
          .set({ active: false, cancelledAt: new Date() })
          .where(eq(listings.listingId, listingId));
        break;
      }

      case 'ListingPriceUpdated': {
        const listingId = BigInt(args.listingId);
        const newPrice = BigInt(args.newPrice);
        await db
          .update(listings)
          .set({ price: newPrice.toString() })
          .where(eq(listings.listingId, listingId));
        break;
      }
    }
  }
}
