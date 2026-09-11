import { Hono } from 'hono';
import { walletAuth } from '../middleware/auth';
import { catchErrors } from '../lib/errors';
import { ApiError } from '../lib/errors';
import {
  bearerFrom, mintSessionToken, verifySessionToken,
  TOKEN_REFRESH_AFTER_SEC, TOKEN_TTL_SEC, SESSION_MAX_AGE_SEC,
} from '../lib/session-token';

/**
 * Sign once, play for hours.
 *
 * A wallet signature is only good for 5 minutes, so without this a browser wallet interrupts a
 * live battle with a signing modal. `POST /api/auth/session` trades one signature for a bearer
 * token; `/refresh` renews it without touching the wallet, up to SESSION_MAX_AGE_SEC after the
 * original signature.
 */
export const authRoutes = new Hono();

// ──────────── POST /api/auth/session ────────────
// Auth: a fresh wallet signature (walletAuth also accepts a token, which simply re-issues).
authRoutes.post(
  '/session',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;
    const minted = mintSessionToken(address);
    return c.json({
      token: minted.token,
      address,
      expiresAt: minted.expiresAt,
      sessionEndsAt: minted.sessionEndsAt,
      refreshAfterSec: TOKEN_TTL_SEC - TOKEN_REFRESH_AFTER_SEC,
    });
  }),
);

// ──────────── POST /api/auth/session/refresh ────────────
// Auth: the current token only — never prompts the wallet. Refuses once the session is older
// than SESSION_MAX_AGE_SEC, at which point the client signs again.
authRoutes.post(
  '/session/refresh',
  catchErrors(async (c) => {
    const bearer = bearerFrom(c.req.header('Authorization'));
    if (!bearer) throw new ApiError('UNAUTHORIZED', 'Send the current token as Authorization: Bearer <token>');
    const { checksumAddress, sessionStart } = verifySessionToken(bearer);
    const minted = mintSessionToken(checksumAddress, sessionStart);
    return c.json({
      token: minted.token,
      address: checksumAddress,
      expiresAt: minted.expiresAt,
      sessionEndsAt: minted.sessionEndsAt,
      refreshAfterSec: TOKEN_TTL_SEC - TOKEN_REFRESH_AFTER_SEC,
    });
  }),
);
