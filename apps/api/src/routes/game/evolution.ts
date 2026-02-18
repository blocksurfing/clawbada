import { Hono } from 'hono';
import { EvolutionLabAbi, ClawTokenAbi, addresses } from '@clawbada/chain';
import {
  evolutionRequirements,
  canEvolve,
  previewEvolvedStats,
  EvolutionTier,
  LegendStatus,
  type Lobster,
} from '@clawbada/game-logic';
import { walletAuth } from '../../middleware/auth';
import { catchErrors, ApiError } from '../../lib/errors';
import { readLobster, serializeBigInts } from '../../lib/chain';
import { buildCalldata, multiStep } from '../../lib/calldata';

export const evolutionRoutes = new Hono();

// GET /api/game/evolution/cost/:lobsterId — get evolution cost for a lobster
evolutionRoutes.get(
  '/cost/:lobsterId',
  catchErrors(async (c) => {
    const { lobsterId } = c.req.param();
    const lobster = await readLobster(BigInt(lobsterId));

    const reqs = evolutionRequirements(lobster.evolutionTier as EvolutionTier);
    if (!reqs) {
      return c.json({
        lobsterId,
        currentTier: lobster.evolutionTier,
        tierName: EvolutionTier[lobster.evolutionTier],
        canEvolve: false,
        reason: 'Already at Apex tier',
      });
    }

    const nextTier = lobster.evolutionTier + 1;
    const previewStats = previewEvolvedStats(
      lobster.decoded.class,
      nextTier as EvolutionTier,
      lobster.decoded.legend === LegendStatus.Legend,
    );

    return c.json(serializeBigInts({
      lobsterId,
      currentTier: lobster.evolutionTier,
      currentTierName: EvolutionTier[lobster.evolutionTier],
      nextTier,
      nextTierName: EvolutionTier[nextTier],
      fuelCount: reqs.fuelCount,
      fuelTier: reqs.fuelTier,
      fuelTierName: EvolutionTier[reqs.fuelTier],
      clawCost: reqs.clawCost,
      previewStats,
    }));
  }),
);

// POST /api/game/evolution/evolve — evolve a lobster
evolutionRoutes.post(
  '/evolve',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;
    const body = await c.req.json<{ lobsterId: string; fuelId1: string; fuelId2: string }>();

    if (!body.lobsterId || !body.fuelId1 || !body.fuelId2) {
      throw new ApiError('INVALID_INPUT', 'lobsterId, fuelId1, and fuelId2 required');
    }

    const lobsterId = BigInt(body.lobsterId);
    const fuelId1 = BigInt(body.fuelId1);
    const fuelId2 = BigInt(body.fuelId2);

    const [lobster, fuel1, fuel2] = await Promise.all([
      readLobster(lobsterId),
      readLobster(fuelId1),
      readLobster(fuelId2),
    ]);

    // Validate ownership of all 3
    for (const l of [lobster, fuel1, fuel2]) {
      if (l.owner.toLowerCase() !== address.toLowerCase()) {
        throw new ApiError('INVALID_INPUT', `Lobster #${l.tokenId} not owned by caller`);
      }
    }

    // Build game-logic Lobster objects for validation
    const toLobster = (chain: typeof lobster): Lobster => ({
      tokenId: chain.tokenId,
      owner: chain.owner,
      dna: chain.dna,
      class: chain.decoded.class,
      legend: chain.decoded.legend,
      breedType: chain.decoded.breedType,
      purity: chain.purity,
      evolutionTier: chain.evolutionTier as EvolutionTier,
      damage: chain.damage,
      breedCount: chain.breedCount,
      generation: chain.generation,
      soulbound: chain.soulbound,
      locked: chain.locked,
    });

    const validation = canEvolve(toLobster(lobster), [toLobster(fuel1), toLobster(fuel2)]);
    if (!validation.valid) {
      throw new ApiError('INVALID_INPUT', validation.reason!);
    }

    const reqs = evolutionRequirements(lobster.evolutionTier as EvolutionTier)!;

    const approveCalldata = buildCalldata(
      addresses.clawToken,
      ClawTokenAbi as any,
      'approve',
      [addresses.evolutionLab, reqs.clawCost],
    );

    const evolveCalldata = buildCalldata(
      addresses.evolutionLab,
      EvolutionLabAbi as any,
      'evolve',
      [lobsterId, fuelId1, fuelId2],
    );

    return c.json({
      ...multiStep(
        { description: `Approve ${reqs.clawCost} $CLAW for evolution`, calldata: approveCalldata },
        { description: `Evolve lobster #${lobsterId} to ${EvolutionTier[lobster.evolutionTier + 1]}`, calldata: evolveCalldata },
      ),
      preview: serializeBigInts({
        lobsterId,
        fuelBurned: [fuelId1, fuelId2],
        clawCost: reqs.clawCost,
        fromTier: EvolutionTier[lobster.evolutionTier],
        toTier: EvolutionTier[lobster.evolutionTier + 1],
      }),
    });
  }),
);
