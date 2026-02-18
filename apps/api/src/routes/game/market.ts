import { Hono } from 'hono';
import { eq, desc, asc } from 'drizzle-orm';
import { MarketplaceAbi, ClawTokenAbi, LobsterNFTAbi, addresses } from '@clawbada/chain';
import { db, listings, priceHistory, lobsters } from '@clawbada/db';
import { walletAuth } from '../../middleware/auth';
import { catchErrors, ApiError } from '../../lib/errors';
import { readListing, readLobster, serializeBigInts } from '../../lib/chain';
import { buildCalldata, singleStep, multiStep } from '../../lib/calldata';

export const marketRoutes = new Hono();

// GET /api/game/market/listings — browse active listings (DB-backed for filtering)
marketRoutes.get(
  '/listings',
  catchErrors(async (c) => {
    const classFilter = c.req.query('class');
    const tier = c.req.query('tier');
    const minPurity = c.req.query('minPurity');
    const maxPrice = c.req.query('maxPrice');
    const minPrice = c.req.query('minPrice');
    const legend = c.req.query('legend');
    const sort = c.req.query('sort') ?? 'recent';
    const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
    const offset = Number(c.req.query('offset') ?? '0');

    // Determine sort expression
    const orderExpr =
      sort === 'price_asc' ? asc(listings.price)
      : sort === 'price_desc' ? desc(listings.price)
      : desc(listings.listedAt);

    // Join with lobsters table for filtering
    const results = await db
      .select({
        listingId: listings.listingId,
        tokenId: listings.tokenId,
        seller: listings.seller,
        price: listings.price,
        listedAt: listings.listedAt,
        class: lobsters.class,
        evolutionTier: lobsters.evolutionTier,
        purity: lobsters.purity,
        legend: lobsters.legend,
      })
      .from(listings)
      .innerJoin(lobsters, eq(listings.tokenId, lobsters.tokenId))
      .where(eq(listings.active, true))
      .orderBy(orderExpr)
      .limit(limit)
      .offset(offset);

    // Apply client-side filters that need parsed values
    let filtered = results;
    if (classFilter !== undefined) {
      filtered = filtered.filter((r) => r.class === Number(classFilter));
    }
    if (tier !== undefined) {
      filtered = filtered.filter((r) => r.evolutionTier === Number(tier));
    }
    if (minPurity !== undefined) {
      filtered = filtered.filter((r) => r.purity >= Number(minPurity));
    }
    if (legend === 'true') {
      filtered = filtered.filter((r) => r.legend === 1);
    }
    if (minPrice !== undefined) {
      filtered = filtered.filter((r) => BigInt(r.price) >= BigInt(minPrice));
    }
    if (maxPrice !== undefined) {
      filtered = filtered.filter((r) => BigInt(r.price) <= BigInt(maxPrice));
    }

    return c.json(serializeBigInts({
      count: filtered.length,
      listings: filtered,
    }));
  }),
);

// GET /api/game/market/listings/:listingId — get listing details
marketRoutes.get(
  '/listings/:listingId',
  catchErrors(async (c) => {
    const { listingId } = c.req.param();
    const listing = await readListing(BigInt(listingId));
    const lobster = await readLobster(listing.lobsterId);

    return c.json(serializeBigInts({
      ...listing,
      lobster: {
        tokenId: lobster.tokenId,
        class: lobster.decoded.class,
        legend: lobster.decoded.legend,
        purity: lobster.purity,
        evolutionTier: lobster.evolutionTier,
        damage: lobster.damage,
        stats: lobster.stats,
      },
    }));
  }),
);

// POST /api/game/market/list — list a lobster for sale
marketRoutes.post(
  '/list',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;
    const body = await c.req.json<{ lobsterId: string; price: string }>();

    if (!body.lobsterId || !body.price) {
      throw new ApiError('INVALID_INPUT', 'lobsterId and price required');
    }

    const lobsterId = BigInt(body.lobsterId);
    const price = BigInt(body.price);

    if (price <= 0n) {
      throw new ApiError('INVALID_INPUT', 'Price must be > 0');
    }

    const lobster = await readLobster(lobsterId);
    if (lobster.owner.toLowerCase() !== address.toLowerCase()) {
      throw new ApiError('INVALID_INPUT', 'Not the lobster owner');
    }
    if (lobster.locked) {
      throw new ApiError('LOBSTER_LOCKED', 'Lobster is locked (in team, mining, or battle)');
    }
    if (lobster.soulbound) {
      throw new ApiError('INVALID_INPUT', 'Soulbound lobsters cannot be sold');
    }

    const approveCalldata = buildCalldata(
      addresses.lobsterNFT,
      LobsterNFTAbi as any,
      'setApprovalForAll',
      [addresses.marketplace, true],
    );

    const listCalldata = buildCalldata(
      addresses.marketplace,
      MarketplaceAbi as any,
      'listLobster',
      [lobsterId, price],
    );

    return c.json(multiStep(
      { description: 'Approve marketplace to transfer lobsters (if not already)', calldata: approveCalldata, optional: true },
      { description: `List lobster #${lobsterId} for ${price} $CLAW`, calldata: listCalldata },
    ));
  }),
);

// POST /api/game/market/listings/:listingId/buy — buy a listing
marketRoutes.post(
  '/listings/:listingId/buy',
  walletAuth,
  catchErrors(async (c) => {
    const { listingId } = c.req.param();
    const listing = await readListing(BigInt(listingId));

    if (!listing.active) {
      throw new ApiError('NOT_FOUND', 'Listing is no longer active');
    }

    const approveCalldata = buildCalldata(
      addresses.clawToken,
      ClawTokenAbi as any,
      'approve',
      [addresses.marketplace, listing.price],
    );

    const buyCalldata = buildCalldata(
      addresses.marketplace,
      MarketplaceAbi as any,
      'buyLobster',
      [BigInt(listingId)],
    );

    return c.json({
      ...multiStep(
        { description: `Approve ${listing.price} $CLAW for purchase`, calldata: approveCalldata },
        { description: `Buy lobster #${listing.lobsterId}`, calldata: buyCalldata },
      ),
      listing: serializeBigInts(listing),
    });
  }),
);

// DELETE /api/game/market/listings/:listingId — cancel a listing
marketRoutes.delete(
  '/listings/:listingId',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;
    const { listingId } = c.req.param();
    const listing = await readListing(BigInt(listingId));

    if (listing.seller.toLowerCase() !== address.toLowerCase()) {
      throw new ApiError('INVALID_INPUT', 'Not the listing seller');
    }
    if (!listing.active) {
      throw new ApiError('INVALID_INPUT', 'Listing already inactive');
    }

    const calldata = buildCalldata(
      addresses.marketplace,
      MarketplaceAbi as any,
      'cancelListing',
      [BigInt(listingId)],
    );

    return c.json(singleStep('Cancel marketplace listing', calldata));
  }),
);

// PATCH /api/game/market/listings/:listingId/price — update listing price
marketRoutes.patch(
  '/listings/:listingId/price',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;
    const { listingId } = c.req.param();
    const body = await c.req.json<{ price: string }>();

    if (!body.price) {
      throw new ApiError('INVALID_INPUT', 'price required');
    }

    const listing = await readListing(BigInt(listingId));
    if (listing.seller.toLowerCase() !== address.toLowerCase()) {
      throw new ApiError('INVALID_INPUT', 'Not the listing seller');
    }
    if (!listing.active) {
      throw new ApiError('INVALID_INPUT', 'Listing is not active');
    }

    const newPrice = BigInt(body.price);
    if (newPrice <= 0n) {
      throw new ApiError('INVALID_INPUT', 'Price must be > 0');
    }

    const calldata = buildCalldata(
      addresses.marketplace,
      MarketplaceAbi as any,
      'updatePrice',
      [BigInt(listingId), newPrice],
    );

    return c.json(singleStep(`Update listing price to ${newPrice} $CLAW`, calldata));
  }),
);

// GET /api/game/market/price-history/:lobsterId — price history for a lobster
marketRoutes.get(
  '/price-history/:lobsterId',
  catchErrors(async (c) => {
    const { lobsterId } = c.req.param();

    const history = await db
      .select()
      .from(priceHistory)
      .where(eq(priceHistory.tokenId, BigInt(lobsterId)))
      .orderBy(desc(priceHistory.timestamp))
      .limit(50);

    return c.json(serializeBigInts({
      lobsterId,
      count: history.length,
      history,
    }));
  }),
);
