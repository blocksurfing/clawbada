import { Hono } from 'hono';
import { BreedingLabAbi, ClawTokenAbi, addresses } from '@clawbada/chain';
import {
  totalBreedCost,
  breedCostPerParent,
  MAX_BREEDS_PER_LOBSTER,
  BREED_COOLDOWN_SECONDS,
  LobsterClass,
  CLASS_NAMES,
} from '@clawbada/game-logic';
import { walletAuth } from '../../middleware/auth';
import { catchErrors, ApiError } from '../../lib/errors';
import { readLobster, readCooldownEnd, serializeBigInts } from '../../lib/chain';
import { buildCalldata, multiStep } from '../../lib/calldata';

export const breedingRoutes = new Hono();

// GET /api/game/breeding/preview — preview breed cost and offspring probabilities
breedingRoutes.get(
  '/preview',
  catchErrors(async (c) => {
    const parentAId = c.req.query('parentA');
    const parentBId = c.req.query('parentB');

    if (!parentAId || !parentBId) {
      throw new ApiError('INVALID_INPUT', 'parentA and parentB query parameters required');
    }

    const [parentA, parentB] = await Promise.all([
      readLobster(BigInt(parentAId)),
      readLobster(BigInt(parentBId)),
    ]);

    const costA = breedCostPerParent(parentA.breedCount, parentA.generation);
    const costB = breedCostPerParent(parentB.breedCount, parentB.generation);
    const total = costA + costB;

    // Class probabilities
    const sameClass = parentA.decoded.class === parentB.decoded.class;
    const classProb = sameClass
      ? { [CLASS_NAMES[parentA.decoded.class]]: '100%' }
      : {
          [CLASS_NAMES[parentA.decoded.class]]: '50%',
          [CLASS_NAMES[parentB.decoded.class]]: '50%',
        };

    const offspringGeneration = Math.max(parentA.generation, parentB.generation) + 1;

    return c.json(serializeBigInts({
      parentA: {
        tokenId: parentA.tokenId,
        breedCount: parentA.breedCount,
        generation: parentA.generation,
        cost: costA,
        breedsRemaining: MAX_BREEDS_PER_LOBSTER - parentA.breedCount,
      },
      parentB: {
        tokenId: parentB.tokenId,
        breedCount: parentB.breedCount,
        generation: parentB.generation,
        cost: costB,
        breedsRemaining: MAX_BREEDS_PER_LOBSTER - parentB.breedCount,
      },
      totalCost: total,
      offspringGeneration,
      classProbabilities: classProb,
      legendChance: '0.3%',
    }));
  }),
);

// GET /api/game/breeding/cooldowns/:lobsterId — get cooldown timer
breedingRoutes.get(
  '/cooldowns/:lobsterId',
  catchErrors(async (c) => {
    const { lobsterId } = c.req.param();
    const cooldownEnd = await readCooldownEnd(BigInt(lobsterId));
    const now = BigInt(Math.floor(Date.now() / 1000));
    const remaining = cooldownEnd > now ? Number(cooldownEnd - now) : 0;

    return c.json(serializeBigInts({
      lobsterId,
      cooldownEnd,
      remainingSeconds: remaining,
      isReady: remaining === 0,
    }));
  }),
);

// POST /api/game/breeding/breed — breed two parents
breedingRoutes.post(
  '/breed',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;
    const body = await c.req.json<{ parentA: string; parentB: string }>();

    if (!body.parentA || !body.parentB) {
      throw new ApiError('INVALID_INPUT', 'parentA and parentB required');
    }

    const parentAId = BigInt(body.parentA);
    const parentBId = BigInt(body.parentB);

    if (parentAId === parentBId) {
      throw new ApiError('INVALID_INPUT', 'Cannot breed a lobster with itself');
    }

    const [parentA, parentB] = await Promise.all([
      readLobster(parentAId),
      readLobster(parentBId),
    ]);

    // Validate ownership
    if (parentA.owner.toLowerCase() !== address.toLowerCase()) {
      throw new ApiError('INVALID_INPUT', `Parent A (#${parentAId}) not owned by caller`);
    }
    if (parentB.owner.toLowerCase() !== address.toLowerCase()) {
      throw new ApiError('INVALID_INPUT', `Parent B (#${parentBId}) not owned by caller`);
    }

    // Validate not locked
    if (parentA.locked) throw new ApiError('LOBSTER_LOCKED', `Parent A (#${parentAId}) is locked`);
    if (parentB.locked) throw new ApiError('LOBSTER_LOCKED', `Parent B (#${parentBId}) is locked`);

    // Validate breed count
    if (parentA.breedCount >= MAX_BREEDS_PER_LOBSTER) {
      throw new ApiError('INVALID_INPUT', `Parent A (#${parentAId}) has reached max breeds (${MAX_BREEDS_PER_LOBSTER})`);
    }
    if (parentB.breedCount >= MAX_BREEDS_PER_LOBSTER) {
      throw new ApiError('INVALID_INPUT', `Parent B (#${parentBId}) has reached max breeds (${MAX_BREEDS_PER_LOBSTER})`);
    }

    // Validate cooldowns
    const now = BigInt(Math.floor(Date.now() / 1000));
    const [cdA, cdB] = await Promise.all([
      readCooldownEnd(parentAId),
      readCooldownEnd(parentBId),
    ]);
    if (cdA > now) throw new ApiError('COOLDOWN_ACTIVE', `Parent A (#${parentAId}) is on cooldown`);
    if (cdB > now) throw new ApiError('COOLDOWN_ACTIVE', `Parent B (#${parentBId}) is on cooldown`);

    const cost = totalBreedCost(parentA.breedCount, parentA.generation, parentB.breedCount, parentB.generation);

    const approveCalldata = buildCalldata(
      addresses.clawToken,
      ClawTokenAbi as any,
      'approve',
      [addresses.breedingLab, cost],
    );

    const breedCalldata = buildCalldata(
      addresses.breedingLab,
      BreedingLabAbi as any,
      'breed',
      [parentAId, parentBId],
    );

    return c.json({
      ...multiStep(
        { description: `Approve ${cost} $CLAW for breeding`, calldata: approveCalldata },
        { description: 'Breed two lobsters', calldata: breedCalldata },
      ),
      preview: serializeBigInts({ totalCost: cost, parentA: parentAId, parentB: parentBId }),
    });
  }),
);
