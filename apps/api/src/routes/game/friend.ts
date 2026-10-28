/**
 * Battle Friends (owner 2026-10-28): invite a friend by link and fight live — no wallet needed on either side, no
 * stake, no rating. `playerAuth` takes a wallet OR a guest session; nothing here touches the economy.
 *
 * POST /api/game/friend/rooms            { arena? }   → { roomId, secret, invite, expiresAt }  (host)
 * POST /api/game/friend/rooms/:id/join   { secret }   → room view                                (friend)
 * POST /api/game/friend/rooms/:id/team   { team }     → room view   team = { classes: [3], tier, purity }
 * POST /api/game/friend/rooms/:id/ready               → room view (+ battleId once both are ready)
 * POST /api/game/friend/rooms/:id/cancel              → room view
 * GET  /api/game/friend/rooms/:id                     → room view   (poll while waiting; the other player's team
 *                                                                    is never included — only "locked in")
 *
 * The invite is `roomId.secret`; the web puts it in the URL FRAGMENT (/battle-friends/join#…) so it never reaches a
 * server log or a Referer. The secret is shown once and only its hash is stored.
 */
import { Hono } from 'hono';
import { playerAuth } from '../../middleware/auth';
import { catchErrors, ApiError } from '../../lib/errors';
import { battleSessions, PracticeConflictError } from '../../lib/battle-session';
import { friendRooms, FriendRoomError } from '../../lib/friend-rooms';

export const friendRoutes = new Hono();

/** The ceiling on live off-chain battles (shared with practice; PRACTICE_MAX_LIVE, default 500). */
function maxLive(): number {
  const n = Number(process.env.PRACTICE_MAX_LIVE);
  return Number.isInteger(n) && n > 0 ? n : 500;
}

/** Bodies take exactly the listed fields — nothing like `staked`, `ranked` or `bracket` can ride along. */
async function body(c: { req: { json<T>(): Promise<T> } }, allowed: string[]): Promise<Record<string, unknown>> {
  const raw = await c.req.json<unknown>().catch(() => ({}));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError('INVALID_INPUT', 'JSON object expected');
  const extra = Object.keys(raw).filter((k) => !allowed.includes(k));
  if (extra.length) throw new ApiError('INVALID_INPUT', `unexpected field(s): ${extra.join(', ')}`);
  return raw as Record<string, unknown>;
}

function mapError(err: unknown): never {
  if (err instanceof FriendRoomError) {
    throw new ApiError(err.code === 'CONFLICT' ? 'BATTLE_PHASE_ERROR' : err.code, err.message);
  }
  if (err instanceof PracticeConflictError) throw new ApiError('BATTLE_PHASE_ERROR', 'One of you is still in another battle — finish or leave it first');
  throw err;
}

const caller = (c: { get(k: 'address'): string }) => c.get('address').toLowerCase();

friendRoutes.post('/rooms', playerAuth, catchErrors(async (c) => {
  const b = await body(c, ['arena']);
  try {
    const room = await friendRooms.create(caller(c as never), { arena: b.arena });
    return c.json({ ...room, invite: `${room.roomId}.${room.secret}` }, 201);
  } catch (err) { mapError(err); }
}));

friendRoutes.post('/rooms/:id/join', playerAuth, catchErrors(async (c) => {
  const b = await body(c, ['secret']);
  try { return c.json(await friendRooms.join(c.req.param('id'), b.secret, caller(c as never))); } catch (err) { mapError(err); }
}));

friendRoutes.post('/rooms/:id/team', playerAuth, catchErrors(async (c) => {
  const b = await body(c, ['team']);
  try { return c.json(await friendRooms.setTeam(c.req.param('id'), caller(c as never), b.team)); } catch (err) { mapError(err); }
}));

friendRoutes.post('/rooms/:id/ready', playerAuth, catchErrors(async (c) => {
  if (battleSessions.livePracticeCount() >= maxLive()) throw new ApiError('RATE_LIMITED', 'The Dojo is full right now — try again in a minute');
  try { return c.json(await friendRooms.ready(c.req.param('id'), caller(c as never))); } catch (err) { mapError(err); }
}));

friendRoutes.post('/rooms/:id/cancel', playerAuth, catchErrors(async (c) => {
  try { return c.json(await friendRooms.cancel(c.req.param('id'), caller(c as never))); } catch (err) { mapError(err); }
}));

friendRoutes.get('/rooms/:id', playerAuth, catchErrors(async (c) => {
  try { return c.json(await friendRooms.view(c.req.param('id'), caller(c as never))); } catch (err) { mapError(err); }
}));
