import { Hono } from 'hono';
import { renderLobsterPng, VALID_SIZES } from '@clawbada/asset-gen';
import { readLobster } from '../../lib/chain';
import { ApiError, catchErrors } from '../../lib/errors';

export const renderRoutes = new Hono();

const DEFAULT_SIZE = 128;

function parseSize(raw: string | undefined): number {
  if (!raw) return DEFAULT_SIZE;
  const n = Number(raw);
  if (!VALID_SIZES.includes(n as any)) {
    throw new ApiError('INVALID_INPUT', `Invalid size. Must be one of: ${VALID_SIZES.join(', ')}`);
  }
  return n;
}

function parseTier(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  if (isNaN(n) || n < 0 || n > 3) {
    throw new ApiError('INVALID_INPUT', 'Tier must be 0-3');
  }
  return n;
}

function parseDna(raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new ApiError('INVALID_INPUT', 'Invalid DNA value');
  }
}

/**
 * GET /render/dna/:dna — Render lobster image by raw DNA.
 * Query params: ?size=64|128|256|512&tier=0|1|2|3
 *
 * NOTE: This route must be defined BEFORE /:tokenId to avoid the
 * "dna" segment being captured as a tokenId.
 */
renderRoutes.get(
  '/dna/:dna',
  catchErrors(async (c) => {
    const dna = parseDna(c.req.param('dna'));
    const size = parseSize(c.req.query('size'));
    const tier = parseTier(c.req.query('tier'));

    const png = await renderLobsterPng(dna, tier, { size });

    return c.body(png as any, 200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    });
  }),
);

/**
 * GET /render/:tokenId — Render lobster image by on-chain token ID.
 * Query params: ?size=64|128|256|512
 */
renderRoutes.get(
  '/:tokenId',
  catchErrors(async (c) => {
    const tokenId = BigInt(c.req.param('tokenId'));
    const size = parseSize(c.req.query('size'));

    const lobster = await readLobster(tokenId);
    const png = await renderLobsterPng(lobster.dna, lobster.evolutionTier, { size });

    return c.body(png as any, 200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
    });
  }),
);
