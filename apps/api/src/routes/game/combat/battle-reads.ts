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
import { BattlePhase } from '@clawbada/game-logic';
import { catchErrors, ApiError } from '../../../lib/errors';
import { readBattle, serializeBigInts } from '../../../lib/chain';
import { walletAuth } from '../../../middleware/auth';

export const battleReadRoutes = new Hono();

type BattleRow = typeof battles.$inferSelect;

/**
 * What an unauthenticated caller may see of a battle row. An ALLOW-LIST, on purpose.
 *
 * Audit D-07: this used to be a deny-list that stripped only `queuedTeamA/B`. When the first
 * player POSTed their reveal salt, the server wrote their teamId into `teamA/teamB` and the salt
 * into `revealSaltA/B` — and this public read returned the whole row. Anyone, including the
 * opponent, could read the first revealer's team (and the salt that proves it) BEFORE the atomic
 * on-chain reveal, then simply not post their own salt: the reveal window times out into a
 * full-refund mutual cancel (F5-01's safety net), i.e. a free matchup dodge. F5-01 made the
 * on-chain reveal atomic precisely to stop that; the API undid it.
 *
 *  - `revealSaltA/B` and `queuedTeamA/B` never leave the server.
 *  - `teamA/teamB` are shown only once the ON-CHAIN reveal has been indexed (phase >= Active),
 *    at which point both are public on-chain anyway. Before that they read 0, exactly as they do
 *    before anyone has posted a salt, so their value carries no signal.
 *  - A column added to the table later is private until someone lists it here.
 *
 * The authenticated /:battleId/my-team endpoint is the only path that returns a caller's own team.
 */
export function publicBattleView(row: BattleRow) {
  const teamsArePublic = row.phase >= BattlePhase.Active;
  return {
    battleId: row.battleId,
    playerA: row.playerA,
    playerB: row.playerB,
    teamA: teamsArePublic ? row.teamA : 0n,
    teamB: teamsArePublic ? row.teamB : 0n,
    stakeBracket: row.stakeBracket,
    stakeAmount: row.stakeAmount,
    phase: row.phase,
    status: row.status,
    powerA: row.powerA,
    powerB: row.powerB,
    winner: row.winner,
    protocolFee: row.protocolFee,
    winnerPayout: row.winnerPayout,
    totalRounds: row.totalRounds,
    createdAt: row.createdAt,
    settledAt: row.settledAt,
  };
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
        battles: result.map(publicBattleView),
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
        db: dbRow ? publicBattleView(dbRow) : null,
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
