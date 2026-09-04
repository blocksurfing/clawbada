import { Hono } from 'hono';
import { desc, lt, inArray, sql } from 'drizzle-orm';
import { db, onChainEvents } from '@clawbada/db';
import { catchErrors } from '../lib/errors';
import { serializeBigInts } from '../lib/chain';

export const activityRoutes = new Hono();

/** Event types we surface in the activity feed. */
const ACTIVITY_EVENT_NAMES = [
  'BattleSettled',
  'LobsterBred',
  'LobsterEvolved',
  'ListingSold',
  'ExpeditionClaimed',
  'LobsterMinted',
  'ListingCreated',
] as const;

/** Map contract event names to friendly activity types. */
function mapEventType(eventName: string): string {
  switch (eventName) {
    case 'BattleSettled': return 'battle_settled';
    case 'LobsterBred': return 'lobster_bred';
    case 'LobsterEvolved': return 'lobster_evolved';
    case 'ListingSold': return 'listing_sold';
    case 'ExpeditionClaimed': return 'expedition_claimed';
    case 'LobsterMinted': return 'lobster_minted';
    case 'ListingCreated': return 'listing_created';
    default: return eventName.toLowerCase();
  }
}

/**
 * GET /api/activity/recent
 *
 * Returns recent on-chain activity events with cursor-based pagination.
 *
 * Query params:
 *   limit  — max events to return (default 30, max 100)
 *   cursor — event ID to paginate from (exclusive, returns older events)
 *   type   — filter by activity type (e.g. "battle_settled", "lobster_bred")
 */
activityRoutes.get(
  '/recent',
  catchErrors(async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? '30'), 100);
    const cursor = c.req.query('cursor');
    const typeFilter = c.req.query('type');

    // Build conditions
    const conditions = [];

    // Only show interesting events
    conditions.push(inArray(onChainEvents.eventName, [...ACTIVITY_EVENT_NAMES]));

    // Cursor pagination (older events)
    if (cursor) {
      conditions.push(lt(onChainEvents.id, BigInt(cursor)));
    }

    // Type filter — map friendly name back to event name
    if (typeFilter) {
      const eventNameMap: Record<string, string> = {
        battle_settled: 'BattleSettled',
        lobster_bred: 'LobsterBred',
        lobster_evolved: 'LobsterEvolved',
        listing_sold: 'ListingSold',
        expedition_claimed: 'ExpeditionClaimed',
        lobster_minted: 'LobsterMinted',
        listing_created: 'ListingCreated',
      };
      const eventName = eventNameMap[typeFilter];
      if (eventName) {
        conditions.push(sql`${onChainEvents.eventName} = ${eventName}`);
      }
    }

    const rows = await db
      .select()
      .from(onChainEvents)
      .where(sql.join(conditions, sql` AND `))
      .orderBy(desc(onChainEvents.id))
      .limit(limit + 1); // Fetch one extra to detect if there's more

    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit);

    return c.json(serializeBigInts({
      events: events.map((row) => ({
        id: row.id.toString(),
        type: mapEventType(row.eventName),
        contract: row.contractName,
        txHash: row.txHash,
        blockNumber: row.blockNumber,
        timestamp: row.createdAt.getTime(),
        data: row.args,
      })),
      nextCursor: hasMore && events.length > 0
        ? events[events.length - 1].id.toString()
        : null,
    }));
  }),
);
