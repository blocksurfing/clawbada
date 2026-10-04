import { Hono } from 'hono';
import { MiningPoolAbi, addresses } from '@clawbada/chain';
import { TIER_WEIGHTS, EXPEDITION_DURATION_SECONDS, SEASON_DURATION_DAYS, EvolutionTier } from '@clawbada/game-logic';
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

const SEASON_DURATION_SECONDS = BigInt(SEASON_DURATION_DAYS * 24 * 60 * 60);

interface SeasonWindow {
  season: bigint;
  startTime: bigint;
  /** Unix seconds: startTime + 60 days. MiningPool treats the season as over from this second. */
  endsAt: bigint;
  /** Chain time the window was judged at. */
  now: bigint;
}

/**
 * C-L3: MiningPool gates startExpedition (and repeg) on an active season — `currentSeason() > 0`
 * and `block.timestamp < startTime + SEASON_DURATION`. Outside one (season 1 never started, or
 * the 60 days are up and the Safe has not started the next season) say so with 409 SEASON_GAP
 * instead of handing back a transaction that reverts SeasonNotActive. In-flight expeditions are
 * unaffected: claimExpedition pays regardless of the season.
 */
async function requireActiveSeason(): Promise<SeasonWindow> {
  const [season, now] = await Promise.all([readCurrentSeason(), readChainNow()]);
  if (season === 0n) {
    throw new ApiError('SEASON_GAP', 'No mining season has started: the Safe has not started season 1, so expeditions cannot start yet');
  }
  const config = await readSeasonConfig(season);
  const endsAt = config.startTime + SEASON_DURATION_SECONDS;
  if (now >= endsAt) {
    const endedIso = new Date(Number(endsAt) * 1000).toISOString();
    throw new ApiError(
      'SEASON_GAP',
      `Season ${season} ended at ${endedIso} (seasonEndedAt=${endsAt}) and the Safe has not started the next season; expeditions cannot start until it does (claims still pay)`,
    );
  }
  return { season, startTime: config.startTime, endsAt, now };
}

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
// 409 SEASON_GAP outside a season (C-L3): there is no hourly budget to report then.
miningRoutes.get(
  '/budget',
  catchErrors(async (c) => {
    const window = await requireActiveSeason();
    const [budget, baseReward] = await Promise.all([readEpochBudget(), readCurrentBaseReward()]);
    const remaining = budget.cap > budget.minted ? budget.cap - budget.minted : 0n;
    return c.json(serializeBigInts({
      season: window.season,
      // When MiningPool stops accepting expeditions unless the Safe has started the next season by then.
      seasonEndsAt: window.endsAt,
      seasonEndsAtIso: new Date(Number(window.endsAt) * 1000).toISOString(),
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

    // C-L3: nothing can start outside a season, whatever the team looks like.
    await requireActiveSeason();

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
