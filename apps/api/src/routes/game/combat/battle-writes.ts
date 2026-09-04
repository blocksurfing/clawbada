/**
 * POST endpoints for battle actions — calldata builders. The API never sends
 * tx itself; it returns calldata for the agent (or wallet) to sign and broadcast.
 *
 * POST /api/game/combat/:battleId/deposit       — approve + deposit stake
 * POST /api/game/combat/:battleId/commit-team   — submit team commit hash
 * POST /api/game/combat/:battleId/reveal-team   — submit team-reveal salt (F5-01:
 *                                                   server-verified, engine submits the
 *                                                   atomic revealTeams — no calldata)
 * POST /api/game/combat/:battleId/commit-moves  — submit move commit hash
 * POST /api/game/combat/:battleId/reveal-moves  — reveal moves (also nudges
 *                                                   the engine to resolve the round)
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import {
  BattleArenaAbi,
  ClawTokenAbi,
  addresses,
  teamCommitHash,
} from '@clawbada/chain';
import { ANTI_GRIEF_DEPOSIT_BPS, BattlePhase } from '@clawbada/game-logic';
import { db, battles } from '@clawbada/db';
import { log as baseLog } from '../../../logger';
import { walletAuth } from '../../../middleware/auth';
import { catchErrors, ApiError } from '../../../lib/errors';
import { readBattle, serializeBigInts } from '../../../lib/chain';
import { buildCalldata, singleStep, multiStep } from '../../../lib/calldata';
import { battleWS } from '../../../lib/ws';

const log = baseLog.child({ module: 'combat:writes' });

export const battleWriteRoutes = new Hono();

battleWriteRoutes.post(
  '/:battleId/deposit',
  walletAuth,
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    const id = BigInt(battleId);

    const battle = await readBattle(id);
    const antiGrief = (battle.stakeAmount * ANTI_GRIEF_DEPOSIT_BPS) / 10000n;
    const totalDeposit = battle.stakeAmount + antiGrief;

    const approveCalldata = buildCalldata(
      addresses.clawToken,
      ClawTokenAbi as any,
      'approve',
      [addresses.battleArena, totalDeposit],
    );

    const depositCalldata = buildCalldata(
      addresses.battleArena,
      BattleArenaAbi as any,
      'deposit',
      [id],
    );

    return c.json({
      ...multiStep(
        { description: `Approve ${totalDeposit} $CLAW (stake + 5% anti-grief)`, calldata: approveCalldata },
        { description: 'Deposit stake for battle', calldata: depositCalldata },
      ),
      preview: serializeBigInts({
        battleId: id,
        stakeAmount: battle.stakeAmount,
        antiGriefDeposit: antiGrief,
        totalDeposit,
      }),
    });
  }),
);

battleWriteRoutes.post(
  '/:battleId/commit-team',
  walletAuth,
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    const body = await c.req.json<{ commitHash: string }>();

    if (!body.commitHash) {
      throw new ApiError('INVALID_INPUT', 'commitHash required');
    }

    const calldata = buildCalldata(
      addresses.battleArena,
      BattleArenaAbi as any,
      'commitTeam',
      [BigInt(battleId), body.commitHash],
    );

    return c.json(singleStep('Commit team composition hash', calldata));
  }),
);

// F5-01: team reveal is atomic and RESOLVER-submitted. Players NO LONGER reveal on-chain
// themselves (the old per-player revealTeam leaked the first revealer's composition and let
// the second mover dodge). Instead each player POSTs their salt here; the API verifies it
// against the on-chain commit and stores it. Once BOTH salts are in, the engine submits a
// single revealTeams(...) for both teams via the operator key (nothing leaks on-chain until
// both are bound in one tx). No calldata is returned — the player signs nothing to reveal.
battleWriteRoutes.post(
  '/:battleId/reveal-team',
  walletAuth,
  catchErrors(async (c) => {
    const address = (c.get('address') as string).toLowerCase();
    const { battleId } = c.req.param();
    const body = await c.req.json<{ teamId: string; salt: string }>();

    if (!body.teamId || !body.salt) {
      throw new ApiError('INVALID_INPUT', 'teamId and salt required');
    }

    const id = BigInt(battleId);
    const battle = await readBattle(id);

    // Must be a participant, and the battle must be in the TeamReveal phase.
    const isPlayerA = address === battle.playerA.toLowerCase();
    const isPlayerB = address === battle.playerB.toLowerCase();
    if (!isPlayerA && !isPlayerB) {
      throw new ApiError('UNAUTHORIZED', 'Not a participant in this battle');
    }
    if (battle.phase !== BattlePhase.TeamReveal) {
      throw new ApiError('BATTLE_PHASE_ERROR', 'Battle is not in the team-reveal phase');
    }

    // Fail fast: verify the salt+teamId against this player's on-chain commit, so a bad
    // reveal is rejected here instead of reverting the engine's revealTeams tx later. The
    // commit hash binds (battleId, player, teamId, salt), so a match authenticates all three.
    const teamId = BigInt(body.teamId);
    const salt = body.salt as `0x${string}`;
    const expected = teamCommitHash(id, address as `0x${string}`, teamId, salt);
    const onChainCommit = isPlayerA ? battle.teamCommitA : battle.teamCommitB;
    if (expected.toLowerCase() !== String(onChainCommit).toLowerCase()) {
      throw new ApiError('INVALID_INPUT', 'Salt/teamId do not match the committed team hash');
    }

    // Persist the revealed teamId (teamA/teamB are 0 until reveal) plus the salt (transient —
    // cleared once revealTeams confirms). The engine's RevealWatcher reads both to submit.
    await db
      .update(battles)
      .set(isPlayerA ? { teamA: teamId, revealSaltA: salt } : { teamB: teamId, revealSaltB: salt })
      .where(eq(battles.battleId, id));

    const row = await db.query.battles.findFirst({ where: eq(battles.battleId, id) });
    const bothIn = Boolean(row?.revealSaltA) && Boolean(row?.revealSaltB);

    return c.json({
      status: bothIn ? 'both_revealed' : 'waiting_for_opponent',
      message: bothIn
        ? 'Both teams revealed — the battle will begin shortly.'
        : 'Salt received. Waiting for your opponent to reveal.',
    });
  }),
);

battleWriteRoutes.post(
  '/:battleId/commit-moves',
  walletAuth,
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    const body = await c.req.json<{ commitHash: string }>();

    if (!body.commitHash) {
      throw new ApiError('INVALID_INPUT', 'commitHash required');
    }

    const calldata = buildCalldata(
      addresses.battleArena,
      BattleArenaAbi as any,
      'commitMoves',
      [BigInt(battleId), body.commitHash],
    );

    return c.json(singleStep('Commit round moves hash', calldata));
  }),
);

battleWriteRoutes.post(
  '/:battleId/reveal-moves',
  walletAuth,
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    const body = await c.req.json<{ moveData: string; salt: string }>();

    if (!body.moveData || !body.salt) {
      throw new ApiError('INVALID_INPUT', 'moveData and salt required');
    }

    const calldata = buildCalldata(
      addresses.battleArena,
      BattleArenaAbi as any,
      'revealMoves',
      [BigInt(battleId), body.moveData, body.salt],
    );

    // After returning calldata, schedule a round-resolution check. The actual
    // round resolution is handled by the engine service (`apps/engine`) — the
    // API just nudges things along once both reveals appear on-chain.
    scheduleRoundResolution(BigInt(battleId));

    return c.json(singleStep('Reveal round moves', calldata));
  }),
);

/** X13: handleTimeout calldata. The contract's `handleTimeout(battleId)` is
 *  permissionless once the phase's deadline has elapsed (BattleArena.sol:727).
 *  It routes to the right cleanup path per phase:
 *    - Deposit / TeamCommit / TeamReveal → cancel + refund stakes.
 *    - Active → emergency neutral exit.
 *    - AwaitingFinalize (undisputed) → finalize payout.
 *  The frontend shows a button when chain.phase has elapsed `phaseDeadline`
 *  (or `payoutDeadline` for AwaitingFinalize); auth here is for telemetry +
 *  rate limit, not access control. Anyone can call on chain. */
battleWriteRoutes.post(
  '/:battleId/handle-timeout',
  walletAuth,
  catchErrors(async (c) => {
    const { battleId } = c.req.param();

    const calldata = buildCalldata(
      addresses.battleArena,
      BattleArenaAbi as any,
      'handleTimeout',
      [BigInt(battleId)],
    );

    return c.json(singleStep('Handle timeout (cancel / finalize stuck battle)', calldata));
  }),
);

// ──────────── Internal ────────────

function scheduleRoundResolution(battleId: bigint): void {
  setTimeout(async () => {
    try {
      await tryResolveRound(battleId);
    } catch (err) {
      log.error({ err, battleId: battleId.toString() }, 'Round resolution failed');
    }
  }, 2000); // wait 2s for the on-chain reveal tx to confirm
}

async function tryResolveRound(battleId: bigint): Promise<void> {
  const battle = await readBattle(battleId);
  if (!battle.roundRevealedA || !battle.roundRevealedB) {
    return; // wait for the other player
  }
  // The engine service handles the actual resolveRound call. The API's role
  // here is just to fan out a "both reveals are in" notification so listeners
  // know the round is ready to resolve.
  battleWS.broadcast(battleId.toString(), 'round_reveal_complete', {
    battleId: battleId.toString(),
    round: battle.currentRound,
  });
}
