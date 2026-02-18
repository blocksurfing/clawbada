import { Hono } from 'hono';
import { TeamManagerAbi, addresses } from '@clawbada/chain';
import { walletAuth } from '../../middleware/auth';
import { catchErrors, ApiError } from '../../lib/errors';
import { readTeam, readTeamsByOwner, readLobster, serializeBigInts } from '../../lib/chain';
import { buildCalldata, singleStep } from '../../lib/calldata';

export const teamRoutes = new Hono();

// GET /api/game/teams — list teams for a wallet
teamRoutes.get(
  '/',
  catchErrors(async (c) => {
    const address = c.req.query('address');
    if (!address) {
      throw new ApiError('INVALID_INPUT', 'address query parameter required');
    }

    const teams = await readTeamsByOwner(address);
    return c.json(serializeBigInts({ address, count: teams.length, teams }));
  }),
);

// GET /api/game/teams/:teamId — get team details
teamRoutes.get(
  '/:teamId',
  catchErrors(async (c) => {
    const { teamId } = c.req.param();
    const team = await readTeam(BigInt(teamId));

    // Enrich with lobster data
    const lobsters = await Promise.all(
      team.lobsterIds.map((id) => readLobster(id)),
    );

    return c.json(serializeBigInts({
      ...team,
      lobsters: lobsters.map((l) => ({
        tokenId: l.tokenId,
        class: l.decoded.class,
        legend: l.decoded.legend,
        purity: l.purity,
        evolutionTier: l.evolutionTier,
        damage: l.damage,
        stats: l.stats,
      })),
    }));
  }),
);

// POST /api/game/teams/create — create a new team
teamRoutes.post(
  '/create',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;
    const body = await c.req.json<{ lobsterIds: [string, string, string] }>();

    if (!body.lobsterIds || body.lobsterIds.length !== 3) {
      throw new ApiError('INVALID_INPUT', 'Must provide exactly 3 lobsterIds');
    }

    const ids = body.lobsterIds.map(BigInt) as [bigint, bigint, bigint];

    // Validate ownership and lock status
    const lobsters = await Promise.all(ids.map((id) => readLobster(id)));
    for (const l of lobsters) {
      if (l.owner.toLowerCase() !== address.toLowerCase()) {
        throw new ApiError('INVALID_INPUT', `Lobster #${l.tokenId} not owned by caller`);
      }
      if (l.locked) {
        throw new ApiError('LOBSTER_LOCKED', `Lobster #${l.tokenId} is locked`);
      }
    }

    const calldata = buildCalldata(
      addresses.teamManager,
      TeamManagerAbi as any,
      'createTeam',
      [ids],
    );

    return c.json(singleStep('Create team with 3 lobsters', calldata));
  }),
);

// POST /api/game/teams/:teamId/disband — disband a team
teamRoutes.post(
  '/:teamId/disband',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;
    const { teamId } = c.req.param();
    const id = BigInt(teamId);

    const team = await readTeam(id);
    if (team.owner.toLowerCase() !== address.toLowerCase()) {
      throw new ApiError('INVALID_INPUT', 'Not the team owner');
    }
    if (!team.active) {
      throw new ApiError('INVALID_INPUT', 'Team already disbanded');
    }

    const calldata = buildCalldata(
      addresses.teamManager,
      TeamManagerAbi as any,
      'disbandTeam',
      [id],
    );

    return c.json(singleStep('Disband team and unlock lobsters', calldata));
  }),
);
