import { Hono } from 'hono';
import { MiningPoolAbi, addresses } from '@clawbada/chain';
import { TIER_WEIGHTS, EXPEDITION_DURATION_SECONDS, EvolutionTier } from '@clawbada/game-logic';
import { walletAuth } from '../../middleware/auth';
import { catchErrors, ApiError } from '../../lib/errors';
import {
  readTeamsByOwner,
  readTeam,
  readLobster,
  readExpedition,
  readActiveExpedition,
  readCurrentSeason,
  readSeasonConfig,
  readCurrentBaseReward,
  readEpochBudget,
  serializeBigInts, readChainNow } from '../../lib/chain';
import { buildCalldata, singleStep } from '../../lib/calldata';

export const miningRoutes = new Hono();

// GET /api/game/mining — list active expeditions for a wallet
miningRoutes.get(
  '/',
  catchErrors(async (c) => {
    const address = c.req.query('address');
    if (!address) {
      throw new ApiError('INVALID_INPUT', 'address query parameter required');
    }

    const teams = await readTeamsByOwner(address);
    const expeditions = [];

    for (const team of teams) {
      if (!team.active) continue;
      const expId = await readActiveExpedition(team.teamId);
      if (expId > 0n) {
        const exp = await readExpedition(expId);
        expeditions.push(exp);
      }
    }

    return c.json(serializeBigInts({
      address,
      count: expeditions.length,
      expeditions,
    }));
  }),
);

// GET /api/game/mining/budget — D-19: this hour's spend ceiling and when the next hour opens.
// No hour may mint more than twice its fair share of the season budget left; in a rush the
// last expeditions to arrive wait for the next hour. Registered before /:expeditionId.
miningRoutes.get(
  '/budget',
  catchErrors(async (c) => {
    const [budget, baseReward] = await Promise.all([readEpochBudget(), readCurrentBaseReward()]);
    const remaining = budget.cap > budget.minted ? budget.cap - budget.minted : 0n;
    return c.json(serializeBigInts({
      baseReward,
      cap: budget.cap,
      minted: budget.minted,
      remaining,
      // Whole (unboosted) expeditions per tier that still fit this hour: Base / Evolved / Elite / Apex.
      fits: [0, 1, 2, 3].map((t) => (baseReward > 0n ? Number(remaining / (baseReward * BigInt(TIER_WEIGHTS[t as EvolutionTier]))) : 0)),
      nextEpochAt: budget.nextEpochAt,
      nextEpochAtIso: new Date(Number(budget.nextEpochAt) * 1000).toISOString(),
    }));
  }),
);

// GET /api/game/mining/:expeditionId — get expedition details
miningRoutes.get(
  '/:expeditionId',
  catchErrors(async (c) => {
    const { expeditionId } = c.req.param();
    const exp = await readExpedition(BigInt(expeditionId));

    const completionTime = exp.startTime + BigInt(EXPEDITION_DURATION_SECONDS);
    const now = await readChainNow();
    const remainingSeconds = completionTime > now ? Number(completionTime - now) : 0;

    return c.json(serializeBigInts({
      ...exp,
      completionTime,
      remainingSeconds,
    }));
  }),
);

// POST /api/game/mining/start — start a new expedition
miningRoutes.post(
  '/start',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;
    const body = await c.req.json<{ teamId: string; mineTier: number }>();

    if (body.teamId === undefined || body.mineTier === undefined) {
      throw new ApiError('INVALID_INPUT', 'teamId and mineTier required');
    }

    const teamId = BigInt(body.teamId);
    const mineTier = body.mineTier;

    if (mineTier < 0 || mineTier > 3) {
      throw new ApiError('INVALID_INPUT', 'mineTier must be 0-3 (Base/Evolved/Elite/Apex)');
    }

    // Validate team ownership
    const team = await readTeam(teamId);
    if (team.owner.toLowerCase() !== address.toLowerCase()) {
      throw new ApiError('INVALID_INPUT', 'Not the team owner');
    }
    // F-02b: TeamManager.sol's `active` flag means the team is currently busy
    // (mining or in a battle). To START a new expedition the team must be
    // idle. The previous gate inverted the check — only busy teams passed,
    // then the on-chain `MiningPool` revert blocked the call.
    if (team.active) {
      throw new ApiError('INVALID_INPUT', 'Team is busy in another activity (mining or battle)');
    }

    // Check not already mining
    const activeExp = await readActiveExpedition(teamId);
    if (activeExp > 0n) {
      throw new ApiError('INVALID_INPUT', 'Team already has an active expedition');
    }

    // Validate tier gate: all 3 lobsters must meet mine tier
    const lobsters = await Promise.all(team.lobsterIds.map((id) => readLobster(id)));
    for (const l of lobsters) {
      if (l.evolutionTier < mineTier) {
        throw new ApiError(
          'INSUFFICIENT_TIER',
          `Lobster #${l.tokenId} is ${EvolutionTier[l.evolutionTier]} tier, needs ${EvolutionTier[mineTier]}+`,
        );
      }
    }

    // The live rate: TOK-G1 re-pegs it hourly, so the launch constant is only right in hour one.
    // (A battle-rank boost, if the team holds one, adds up to 50% on top on-chain.)
    const baseReward = await readCurrentBaseReward();
    const expectedRewardWei = baseReward * BigInt(TIER_WEIGHTS[mineTier as EvolutionTier]);
    const expectedReward = Number(expectedRewardWei / 10n ** 18n);

    // D-19: no hour may mint more than twice its fair share of the season budget left. Say
    // "full until HH:MM" here rather than hand back a transaction that reverts
    // EpochBudgetFull(nextEpochAt) on-chain.
    const budget = await readEpochBudget();
    if (budget.minted + expectedRewardWei > budget.cap) {
      const opensAt = new Date(Number(budget.nextEpochAt) * 1000).toISOString();
      throw new ApiError('MINE_FULL', `This hour's mining budget is spent; expeditions can start again at ${opensAt}`);
    }

    const calldata = buildCalldata(
      addresses.miningPool,
      MiningPoolAbi as any,
      'startExpedition',
      [teamId, mineTier],
    );

    return c.json({
      ...singleStep(`Start ${EvolutionTier[mineTier]} mine expedition (~${expectedReward} $CLAW)`, calldata),
      preview: serializeBigInts({
        teamId,
        mineTier,
        tierName: EvolutionTier[mineTier],
        expectedReward,
        expectedRewardWei,
        baseReward,
        durationSeconds: EXPEDITION_DURATION_SECONDS,
      }),
    });
  }),
);

// POST /api/game/mining/:expeditionId/claim — claim completed expedition
miningRoutes.post(
  '/:expeditionId/claim',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;
    const { expeditionId } = c.req.param();
    const expId = BigInt(expeditionId);

    const exp = await readExpedition(expId);
    if (exp.owner.toLowerCase() !== address.toLowerCase()) {
      throw new ApiError('INVALID_INPUT', 'Not the expedition owner');
    }
    if (exp.claimed) {
      throw new ApiError('INVALID_INPUT', 'Expedition already claimed');
    }
    if (!exp.isComplete) {
      throw new ApiError('INVALID_INPUT', 'Expedition not yet complete');
    }

    const calldata = buildCalldata(
      addresses.miningPool,
      MiningPoolAbi as any,
      'claimExpedition',
      [expId],
    );

    return c.json({
      ...singleStep('Claim mining expedition reward', calldata),
      reward: exp.reward.toString(),
    });
  }),
);
