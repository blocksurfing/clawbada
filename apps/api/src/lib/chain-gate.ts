/**
 * The parts of the API that only mean something once the contracts are deployed — mining, teams, the market,
 * breeding, evolution, repair, the mining boost and the faucet — are closed until then.
 *
 * Without contract addresses every one of those routes can only fail, and it fails late: after authentication,
 * after parsing a body, some after a call to the RPC. Closed here, at the mount point, a request is answered before
 * any of that work, the error log stops filling with the same failure, and a caller is told why. The same answer as
 * the other switched-off features (practice, guest sessions): 404.
 *
 * Open when the contracts are configured — the Sepolia deploy adds the *_ADDRESS variables together
 * (docs/runbooks/testnet-deploy.md §6). CHAIN_ROUTES=on|off overrides, for a stack that needs it either way.
 *
 * Not behind this gate: combat (its chain routes share `/:battleId/…` with the live practice and friend battles,
 * and its reads are database reads) and rendering (a lobster drawn from its DNA needs art, not contracts; it has a
 * switch of its own, lib/render-gate.ts).
 */
import type { MiddlewareHandler } from 'hono';
import { ApiError } from './errors';

export function chainRoutesOpen(env: Record<string, string | undefined> = process.env): boolean {
  if (env.CHAIN_ROUTES === 'on') return true;
  if (env.CHAIN_ROUTES === 'off') return false;
  const nft = env.LOBSTER_NFT_ADDRESS;
  return Boolean(nft && nft !== '0x');
}

/** Paths (under the app root) that are chain-only. `/x/*` also covers `/x` itself. */
export const CHAIN_ONLY_PATHS = [
  '/api/faucet/*',
  '/api/game/mining/*',
  '/api/game/teams/*',
  '/api/game/market/*',
  '/api/game/breeding/*',
  '/api/game/evolution/*',
  '/api/game/repair/*',
  '/api/game/boost/*',
] as const;

export const CHAIN_ROUTES_CLOSED_MESSAGE = 'Not open yet: this part of the game goes live with the contracts';

export const chainRoutesOnly: MiddlewareHandler = async (_c, next) => {
  if (!chainRoutesOpen()) throw new ApiError('NOT_FOUND', CHAIN_ROUTES_CLOSED_MESSAGE);
  await next();
};
