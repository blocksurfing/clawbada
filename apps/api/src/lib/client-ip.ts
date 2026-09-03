/**
 * F-2I/F-2O: trusted client-IP resolution shared between the WS upgrade
 * handler and Hono REST middleware (rate limiter).
 *
 * Threat model: `X-Forwarded-For` is client-controlled by default. Only honor
 * it when explicitly opted in via `TRUST_PROXY=true` and the deployment runs
 * behind an edge that strips/overwrites the header. Otherwise fall back to
 * the connection peer address from Bun's `server.requestIP(req)`.
 */

const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

/** Bun server's `requestIP` shape — accepts a Request, returns address+family
 *  or null. Loosened here so callers can pass any object with a compatible
 *  signature without importing Bun types directly. */
type RequestIPFn = (req: Request) => { address?: string } | null | undefined;

interface BunServerLike {
  requestIP?: RequestIPFn;
}

/** Resolve the trusted client IP for `req`. `server` is optional but
 *  required for the secure (`TRUST_PROXY=false`) path. */
export function getClientIp(
  req: Request,
  server?: BunServerLike | undefined,
): string {
  if (TRUST_PROXY) {
    const xff = req.headers.get('x-forwarded-for');
    if (xff) {
      // Take the LEFTMOST entry — the original client (after the trusted
      // edge has rewritten/appended). Caller is responsible for ensuring
      // the edge actually does this.
      const first = xff.split(',')[0]?.trim();
      if (first) return first;
    }
  }
  const peer = server?.requestIP?.(req);
  return peer?.address || 'unknown';
}
