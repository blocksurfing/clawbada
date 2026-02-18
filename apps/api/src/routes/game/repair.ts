import { Hono } from 'hono';
import { RepairShopAbi, ClawTokenAbi, addresses } from '@clawbada/chain';
import { repairCost, REPAIR_RATES, DAMAGE_THRESHOLD, EvolutionTier } from '@clawbada/game-logic';
import { walletAuth } from '../../middleware/auth';
import { catchErrors, ApiError } from '../../lib/errors';
import { readLobster, serializeBigInts } from '../../lib/chain';
import { buildCalldata, multiStep } from '../../lib/calldata';

export const repairRoutes = new Hono();

// GET /api/game/repair/cost/:lobsterId — get repair cost estimate
repairRoutes.get(
  '/cost/:lobsterId',
  catchErrors(async (c) => {
    const { lobsterId } = c.req.param();
    const pointsParam = c.req.query('points');
    const lobster = await readLobster(BigInt(lobsterId));

    const pointsToRepair = pointsParam ? Number(pointsParam) : lobster.damage;
    const actualPoints = Math.min(pointsToRepair, lobster.damage);

    if (lobster.damage === 0) {
      return c.json({
        lobsterId,
        damage: 0,
        cost: '0',
        message: 'Lobster has no damage',
      });
    }

    const cost = repairCost(lobster.evolutionTier as EvolutionTier, actualPoints);
    const fullRepairCost = repairCost(lobster.evolutionTier as EvolutionTier, lobster.damage);
    const ratePerPoint = REPAIR_RATES[lobster.evolutionTier as EvolutionTier];

    return c.json(serializeBigInts({
      lobsterId,
      currentDamage: lobster.damage,
      pointsToRepair: actualPoints,
      cost,
      fullRepairCost,
      ratePerPoint,
      tierName: EvolutionTier[lobster.evolutionTier],
      battleBlocked: lobster.damage >= DAMAGE_THRESHOLD,
      damageAfterRepair: lobster.damage - actualPoints,
    }));
  }),
);

// POST /api/game/repair/repair — repair a lobster
repairRoutes.post(
  '/repair',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;
    const body = await c.req.json<{ lobsterId: string; pointsToRepair?: number }>();

    if (!body.lobsterId) {
      throw new ApiError('INVALID_INPUT', 'lobsterId required');
    }

    const lobsterId = BigInt(body.lobsterId);
    const lobster = await readLobster(lobsterId);

    if (lobster.owner.toLowerCase() !== address.toLowerCase()) {
      throw new ApiError('INVALID_INPUT', 'Not the lobster owner');
    }

    if (lobster.damage === 0) {
      throw new ApiError('INVALID_INPUT', 'Lobster has no damage to repair');
    }

    if (lobster.evolutionTier === EvolutionTier.Base) {
      throw new ApiError('INSUFFICIENT_TIER', 'Base tier lobsters cannot be repaired (no battle damage at Base tier)');
    }

    const points = body.pointsToRepair ?? lobster.damage;
    const actualPoints = Math.min(points, lobster.damage);

    if (actualPoints <= 0) {
      throw new ApiError('INVALID_INPUT', 'pointsToRepair must be > 0');
    }

    const cost = repairCost(lobster.evolutionTier as EvolutionTier, actualPoints);

    const approveCalldata = buildCalldata(
      addresses.clawToken,
      ClawTokenAbi as any,
      'approve',
      [addresses.repairShop, cost],
    );

    const repairCalldata = buildCalldata(
      addresses.repairShop,
      RepairShopAbi as any,
      'repair',
      [lobsterId, actualPoints],
    );

    return c.json({
      ...multiStep(
        { description: `Approve ${cost} $CLAW for repair`, calldata: approveCalldata },
        { description: `Repair ${actualPoints} damage on lobster #${lobsterId}`, calldata: repairCalldata },
      ),
      preview: serializeBigInts({
        lobsterId,
        pointsRepaired: actualPoints,
        cost,
        damageAfterRepair: lobster.damage - actualPoints,
      }),
    });
  }),
);
