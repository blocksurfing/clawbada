/**
 * Drawing lobsters — GET /api/game/render/… — is closed until it is switched on: LOBSTER_RENDER_ENABLED=true.
 *
 * Every other public read is a lookup; a render is work. The largest sprite sheet (16 frames of 320 px) takes about
 * 50 ms of a laptop core, on the thread that also runs every live battle, and the lobster to draw is whatever DNA is
 * in the URL, so a cache cannot answer for it. No page shows a rendered lobster yet — the ones that will (market,
 * teams, breeding) open with the contracts — so until one does, these routes answer like the other switched-off
 * features: 404, before anything is parsed or drawn.
 *
 * Local stacks switch it on (.env.example, docker-compose.yml). Before production does: draw off the battle thread
 * or under a server-wide budget, keep what was drawn, give the routes a rate limit of their own in app.ts and at the
 * edge (docs/runbooks/cloud-run.md, "Cloud Armor"), and describe the closed answer in docs/gitbook/agents.md.
 */
import type { MiddlewareHandler } from 'hono';
import { ApiError } from './errors';

export function renderRoutesOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.LOBSTER_RENDER_ENABLED === 'true';
}

/** `/x/*` also covers `/x` itself. */
export const RENDER_PATH = '/api/game/render/*';

export const RENDER_ROUTES_CLOSED_MESSAGE = 'Not open yet: lobster images are switched off on this server';

export const renderRoutesOnly: MiddlewareHandler = async (_c, next) => {
  if (!renderRoutesOpen()) throw new ApiError('NOT_FOUND', RENDER_ROUTES_CLOSED_MESSAGE);
  await next();
};
