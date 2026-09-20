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
import { readLobster, readCooldownEnd, readBreedCost, serializeBigInts } from '../../lib/chain';
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
    // BreedingLab charges wei per its own schedule; approve exactly what it will pull.
    const costWei = await readBreedCost(parentA, parentB);

    const approveCalldata = buildCalldata(
      addresses.clawToken,
      ClawTokenAbi as any,
      'approve',
      [addresses.breedingLab, costWei],
    );

    // Breeding is two steps on-chain: requestBreed commits the fee and both parents' breed slots,
    // and finalizeBreed mints the offspring from a block hash that did not exist at request time.
    // This used to encode a function named `breed`, which BreedingLab does not have — the real
    // ABI encoder throws on it, so the endpoint answered 500 and breeding through the app never
    // worked (the route test stubs the encoder, so it could not notice).
    const breedCalldata = buildCalldata(
      addresses.breedingLab,
      BreedingLabAbi as any,
      'requestBreed',
      [parentAId, parentBId],
    );

    return c.json({
      ...multiStep(
        { description: `Approve ${cost} $CLAW for breeding`, calldata: approveCalldata },
        { description: 'Request the breed (fee and breed slots are committed now)', calldata: breedCalldata },
      ),
      preview: serializeBigInts({ totalCost: cost, totalCostWei: costWei, parentA: parentAId, parentB: parentBId }),
      // D-21: the engine's keeper finalizes every request a few seconds after its target block.
      // finalizeBreed is permissionless, so a client may also do it itself — it MUST land within
      // ~256 blocks (~8.5 min on Base) of the target block or the breed is forfeited.
      finalize: {
        by: 'keeper',
        windowBlocks: 256,
        selfServe: 'POST /api/game/breeding/finalize/:requestId',
        note: 'The offspring is minted by finalizeBreed, normally within seconds. The request id is in the BreedRequested event.',
      },
    });
  }),
);

// POST /api/game/breeding/finalize/:requestId — calldata to finalize a breed yourself.
// Permissionless on-chain, so no auth: anyone may finalize anyone's request (the offspring always
// goes to the original requester). The keeper normally gets there first; this is the fallback.
breedingRoutes.post(
  '/finalize/:requestId',
  catchErrors(async (c) => {
    const raw = c.req.param('requestId');
    if (!/^[1-9]\d{0,30}$/.test(raw)) throw new ApiError('INVALID_INPUT', 'requestId must be a positive integer');
    const calldata = buildCalldata(addresses.breedingLab, BreedingLabAbi as any, 'finalizeBreed', [BigInt(raw)]);
    return c.json({
      ...multiStep({ description: `Finalize breed request #${raw} (mints the offspring)`, calldata }),
      // D-22: the contract refuses to finalize with less than FINALIZE_MIN_GAS left.
      gasHint: '800000',
    });
  }),
);
