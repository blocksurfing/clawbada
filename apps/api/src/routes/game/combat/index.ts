import { Hono } from 'hono';
import { eq, and, desc, or } from 'drizzle-orm';
import {
  BattleArenaAbi,
  ClawTokenAbi,
  addresses,
  getPublicClient,
  getBattleArena,
} from '@clawbada/chain';
import {
  STAKE_BRACKETS,
  ANTI_GRIEF_DEPOSIT_BPS,
  DAMAGE_THRESHOLD,
  EvolutionTier,
  BattlePhase,
} from '@clawbada/game-logic';
import { db, battles, battleRounds, matchmakingQueue, agents } from '@clawbada/db';
import { log as baseLog } from '../../../logger';
import { walletAuth } from '../../../middleware/auth';
import { catchErrors, ApiError } from '../../../lib/errors';
import { readTeam, readLobster, readBattle, serializeBigInts } from '../../../lib/chain';
import { buildCalldata, singleStep, multiStep } from '../../../lib/calldata';
import { battleWS } from '../../../lib/ws';

const log = baseLog.child({ module: 'combat' });

export const combatRoutes = new Hono();

// ──────────── Matchmaking ────────────

// POST /api/game/combat/queue — join matchmaking queue
combatRoutes.post(
  '/queue',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;
    const body = await c.req.json<{ teamId: string; stakeAmount: string }>();

    if (!body.teamId || !body.stakeAmount) {
      throw new ApiError('INVALID_INPUT', 'teamId and stakeAmount required');
    }

    const teamId = BigInt(body.teamId);
    const stakeAmount = BigInt(body.stakeAmount);

    // Determine stake bracket
    const bracketIndex = STAKE_BRACKETS.findIndex((b) => b === stakeAmount);
    if (bracketIndex === -1) {
      throw new ApiError(
        'INVALID_INPUT',
        `stakeAmount must be one of: ${STAKE_BRACKETS.map(String).join(', ')}`,
      );
    }

    // Validate team ownership
    const team = await readTeam(teamId);
    if (team.owner.toLowerCase() !== address.toLowerCase()) {
      throw new ApiError('INVALID_INPUT', 'Not the team owner');
    }
    if (!team.active) {
      throw new ApiError('INVALID_INPUT', 'Team is not active');
    }

    // Validate all lobsters: Evolved+, damage < 80
    const lobsters = await Promise.all(team.lobsterIds.map((id) => readLobster(id)));
    for (const l of lobsters) {
      if (l.evolutionTier < EvolutionTier.Evolved) {
        throw new ApiError(
          'INSUFFICIENT_TIER',
          `Lobster #${l.tokenId} is ${EvolutionTier[l.evolutionTier]} tier, battle requires Evolved+`,
        );
      }
      if (l.damage >= DAMAGE_THRESHOLD) {
        throw new ApiError(
          'INVALID_INPUT',
          `Lobster #${l.tokenId} has ${l.damage} damage (>= ${DAMAGE_THRESHOLD}), must repair first`,
        );
      }
    }

    // Check not already in queue
    const existing = await db
      .select()
      .from(matchmakingQueue)
      .where(eq(matchmakingQueue.address, address.toLowerCase()))
      .limit(1);

    if (existing.length > 0) {
      throw new ApiError('INVALID_INPUT', 'Already in matchmaking queue');
    }

    // Get agent ELO
    const agentResult = await db
      .select()
      .from(agents)
      .where(eq(agents.address, address.toLowerCase()))
      .limit(1);
    const elo = agentResult.length > 0 ? agentResult[0].elo : 1200;

    // Insert into queue
    await db.insert(matchmakingQueue).values({
      address: address.toLowerCase(),
      teamId,
      stakeBracket: bracketIndex,
      elo,
    });

    // Try to find a match (same bracket, similar ELO)
    const match = await tryMatch(address.toLowerCase(), bracketIndex, elo);

    if (match) {
      return c.json({
        status: 'matched',
        battleId: match.battleId.toString(),
        opponent: match.opponent,
      });
    }

    return c.json({ status: 'queued', bracket: bracketIndex, elo });
  }),
);

// GET /api/game/combat/queue/status — check queue status
combatRoutes.get(
  '/queue/status',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;

    const entry = await db
      .select()
      .from(matchmakingQueue)
      .where(eq(matchmakingQueue.address, address.toLowerCase()))
      .limit(1);

    if (entry.length === 0) {
      return c.json({ inQueue: false });
    }

    return c.json(serializeBigInts({
      inQueue: true,
      ...entry[0],
      waitingSeconds: Math.floor((Date.now() - entry[0].enqueuedAt.getTime()) / 1000),
    }));
  }),
);

// DELETE /api/game/combat/queue — leave matchmaking queue
combatRoutes.delete(
  '/queue',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;

    await db
      .delete(matchmakingQueue)
      .where(eq(matchmakingQueue.address, address.toLowerCase()));

    return c.json({ removed: true });
  }),
);

// ──────────── Battle reads ────────────

// GET /api/game/combat/history — past battles for a wallet
combatRoutes.get(
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

    return c.json(serializeBigInts({
      address,
      count: result.length,
      battles: result,
    }));
  }),
);

// GET /api/game/combat/:battleId — get battle state
combatRoutes.get(
  '/:battleId',
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    const chainBattle = await readBattle(BigInt(battleId));

    // Enrich with DB data
    const dbResult = await db
      .select()
      .from(battles)
      .where(eq(battles.battleId, BigInt(battleId)))
      .limit(1);

    return c.json(serializeBigInts({
      chain: chainBattle,
      db: dbResult[0] ?? null,
    }));
  }),
);

// GET /api/game/combat/:battleId/rounds — get round history
combatRoutes.get(
  '/:battleId/rounds',
  catchErrors(async (c) => {
    const { battleId } = c.req.param();

    const rounds = await db
      .select()
      .from(battleRounds)
      .where(eq(battleRounds.battleId, BigInt(battleId)))
      .orderBy(battleRounds.round);

    return c.json(serializeBigInts({
      battleId,
      count: rounds.length,
      rounds,
    }));
  }),
);

// ──────────── Battle writes (calldata for agent) ────────────

// POST /api/game/combat/:battleId/deposit — deposit stake
combatRoutes.post(
  '/:battleId/deposit',
  walletAuth,
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    const id = BigInt(battleId);

    const battle = await readBattle(id);

    // Calculate total deposit: stake + anti-grief (5%)
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

// POST /api/game/combat/:battleId/commit-team — commit team hash
combatRoutes.post(
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

// POST /api/game/combat/:battleId/reveal-team — reveal team
combatRoutes.post(
  '/:battleId/reveal-team',
  walletAuth,
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    const body = await c.req.json<{ teamId: string; salt: string }>();

    if (!body.teamId || !body.salt) {
      throw new ApiError('INVALID_INPUT', 'teamId and salt required');
    }

    const calldata = buildCalldata(
      addresses.battleArena,
      BattleArenaAbi as any,
      'revealTeam',
      [BigInt(battleId), BigInt(body.teamId), body.salt],
    );

    return c.json(singleStep('Reveal team composition', calldata));
  }),
);

// POST /api/game/combat/:battleId/commit-moves — commit move hash
combatRoutes.post(
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

// POST /api/game/combat/:battleId/reveal-moves — reveal moves
combatRoutes.post(
  '/:battleId/reveal-moves',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;
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

    // After returning calldata, try to resolve round server-side
    // (done async after the agent submits the tx)
    const id = BigInt(battleId);
    scheduleRoundResolution(id);

    return c.json(singleStep('Reveal round moves', calldata));
  }),
);

// ──────────── Server-side helpers ────────────

const ELO_MATCH_RANGE = 200;

async function tryMatch(
  address: string,
  bracket: number,
  elo: number,
): Promise<{ battleId: bigint; opponent: string } | null> {
  // Find another player in same bracket with similar ELO
  const candidates = await db
    .select()
    .from(matchmakingQueue)
    .where(
      and(
        eq(matchmakingQueue.stakeBracket, bracket),
      ),
    )
    .orderBy(matchmakingQueue.enqueuedAt)
    .limit(10);

  // Filter out self and find closest ELO
  const opponent = candidates.find(
    (c) => c.address !== address && Math.abs(c.elo - elo) <= ELO_MATCH_RANGE,
  );

  if (!opponent) return null;

  // Remove both from queue atomically
  await db.transaction(async (tx) => {
    await tx.delete(matchmakingQueue).where(eq(matchmakingQueue.address, address));
    await tx.delete(matchmakingQueue).where(eq(matchmakingQueue.address, opponent.address));
  });

  // Create battle on-chain via operator key (MATCHMAKER_ROLE)
  // This runs server-side with the operator's wallet
  const stakeAmount = STAKE_BRACKETS[bracket];

  try {
    const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
    const client = getPublicClient(isTestnet) as any;
    const arena = getBattleArena(client);

    // Simulate the call to get battleId (actual tx sent by operator)
    const battleId = await arena.simulate.createBattle([
      address as `0x${string}`,
      opponent.address as `0x${string}`,
      stakeAmount,
    ]).then((r: any) => r.result);

    // Store in DB
    await db.insert(battles).values({
      battleId,
      playerA: address,
      playerB: opponent.address,
      teamA: 0n, // Filled after team reveal
      teamB: 0n,
      stakeBracket: bracket,
      stakeAmount: stakeAmount.toString(),
      phase: BattlePhase.StakeDeposit,
    });

    // Notify both via WebSocket
    battleWS.broadcast(battleId.toString(), 'match_found', {
      battleId: battleId.toString(),
      playerA: address,
      playerB: opponent.address,
      stakeAmount: stakeAmount.toString(),
    });

    return { battleId, opponent: opponent.address };
  } catch (err) {
    log.error({ err }, 'Failed to create battle');
    // Put both back in queue
    await db.insert(matchmakingQueue).values({
      address,
      teamId: 0n,
      stakeBracket: bracket,
      elo,
    });
    return null;
  }
}

function scheduleRoundResolution(battleId: bigint): void {
  // Schedule async — check if both reveals are in, resolve round
  setTimeout(async () => {
    try {
      await tryResolveRound(battleId);
    } catch (err) {
      log.error({ err, battleId: battleId.toString() }, 'Round resolution failed');
    }
  }, 2000); // Wait 2s for on-chain tx to confirm
}

async function tryResolveRound(battleId: bigint): Promise<void> {
  const battle = await readBattle(battleId);

  // Check if both reveals are in for current round
  if (!battle.roundRevealedA || !battle.roundRevealedB) {
    return; // Wait for other player
  }

  // Round resolution is handled by the engine service (apps/engine).
  // The engine's BattleStateMachine watches for both reveals, then:
  //   1. Fetches a drand VRF beacon
  //   2. Calls resolveRound() from @clawbada/game-logic
  //   3. Stores the round result in battleRounds
  //   4. Broadcasts via WebSocket
  //   5. Settles or advances the round on-chain via operator key
  //
  // The API's role is just to accept the reveal and notify the engine.
  battleWS.broadcast(battleId.toString(), 'round_reveal_complete', {
    battleId: battleId.toString(),
    round: battle.currentRound,
  });
}
