/**
 * GET endpoints for battle data — chain reads + DB enrichment.
 *
 * GET /api/game/combat/history          — past battles for a wallet
 * GET /api/game/combat/:battleId        — full battle state (chain + db)
 * GET /api/game/combat/:battleId/rounds — DEPRECATED (V2). Always empty; use /:battleId/turns
 */

import { Hono } from 'hono';
import { desc, eq, or } from 'drizzle-orm';
import { db, battles } from '@clawbada/db';
import { catchErrors, ApiError } from '../../../lib/errors';
import { readBattle, serializeBigInts } from '../../../lib/chain';
import { walletAuth } from '../../../middleware/auth';

export const battleReadRoutes = new Hono();

/** A2 (May 2026 audit): the `queuedTeamA/queuedTeamB` columns are
 *  participant-private — exposing either to a non-participant or the
 *  opponent before reveal would break commit-reveal secrecy. Strip both
 *  before any public-facing response. The authenticated /:battleId/my-team
 *  endpoint is the only path that reveals the caller's own queued team. */
function redactPrivateBattleFields<T extends { queuedTeamA?: unknown; queuedTeamB?: unknown }>(
  row: T,
): Omit<T, 'queuedTeamA' | 'queuedTeamB'> {
  const { queuedTeamA: _a, queuedTeamB: _b, ...rest } = row;
  return rest;
}

battleReadRoutes.get(
  '/history',
  catchErrors(async (c) => {
    const address = c.req.query('address');
    if (!address) {
      throw new ApiError('INVALID_INPUT', 'address query parameter required');
    }
    const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);

    const result = await db
      .select()
      .from(battles)
      .where(
        or(
          eq(battles.playerA, address.toLowerCase()),
          eq(battles.playerB, address.toLowerCase()),
        ),
      )
      .orderBy(desc(battles.createdAt))
      .limit(limit);

    return c.json(
      serializeBigInts({
        address,
        count: result.length,
        battles: result.map(redactPrivateBattleFields),
      }),
    );
  }),
);

battleReadRoutes.get(
  '/:battleId',
  catchErrors(async (c) => {
    const { battleId } = c.req.param();

    // PR-B X1 + Codex PR-B MEDIUM-3: skip chain reads for both pending_create
    // (status=0, on-chain createBattle in flight) AND create_failed
    // (status=4, on-chain createBattle never landed). readBattle would
    // throw NOT_FOUND in both cases and break the page; the frontend uses
    // the status field to render the correct UI without chain data.
    const dbResult = await db
      .select()
      .from(battles)
      .where(eq(battles.battleId, BigInt(battleId)))
      .limit(1);

    const dbRow = dbResult[0];
    const skipChainRead = dbRow && (dbRow.status === 0 || dbRow.status === 4);
    const chainBattle = skipChainRead ? null : await readBattle(BigInt(battleId));

    return c.json(
      serializeBigInts({
        chain: chainBattle,
        db: dbRow ? redactPrivateBattleFields(dbRow) : null,
      }),
    );
  }),
);

/** A2: authenticated endpoint returns ONLY the caller's own queued team ID.
 *  Used by the frontend commit-hash flow — `chain.teamIdA/B` are 0 until
 *  reveal, so this is the canonical pre-reveal source. Returns 404 if the
 *  caller isn't a participant, preserving information-hiding for spectators. */
battleReadRoutes.get(
  '/:battleId/my-team',
  walletAuth,
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    const address = (c.get('address') as string).toLowerCase();

    const row = await db
      .select({
        playerA: battles.playerA,
        playerB: battles.playerB,
        queuedTeamA: battles.queuedTeamA,
        queuedTeamB: battles.queuedTeamB,
      })
      .from(battles)
      .where(eq(battles.battleId, BigInt(battleId)))
      .limit(1);

    if (row.length === 0) throw new ApiError('NOT_FOUND', `Battle #${battleId} not found`);

    const b = row[0];
    let myTeamId: bigint | null = null;
    if (b.playerA === address) myTeamId = b.queuedTeamA;
    else if (b.playerB === address) myTeamId = b.queuedTeamB;
    else throw new ApiError('NOT_FOUND', `Battle #${battleId} not found`);

    return c.json(serializeBigInts({ battleId, myTeamId }));
  }),
);

/** V2 remnant kept so old clients keep working: battle_rounds no longer exists.
 *  The V3 turn history is `GET /:battleId/turns` (session.ts). */
battleReadRoutes.get(
  '/:battleId/rounds',
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    return c.json({ battleId, count: 0, rounds: [], deprecated: 'use /api/game/combat/:battleId/turns' });
  }),
);
