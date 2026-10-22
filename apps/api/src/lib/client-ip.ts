/**
 * F-2I/F-2O: trusted client-IP resolution shared between the WS upgrade
 * handler and Hono REST middleware (rate limiter).
 *
 * Threat model: `X-Forwarded-For` is client-controlled by default. Only honor
 * it when explicitly opted in via `TRUST_PROXY=true` and the deployment runs
 * behind an edge that APPENDS the connecting address. Google's front ends
 * (Cloud Run, the external load balancer) append — they never strip what the
 * client sent — so the trustworthy entry is counted from the RIGHT:
 * `TRUST_PROXY_HOPS` (default 1) is the number of trailing entries added by
 * infrastructure we trust. Taking the leftmost entry, as before 2026-10-22,
 * let any client pick its own rate-limit bucket. Otherwise fall back to the
 * connection peer address from Bun's `server.requestIP(req)`.
 */

const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
/** Trailing X-Forwarded-For entries appended by trusted proxies. Cloud Run alone = 1; behind the external
 *  load balancer the real value is read off a live request's header (see docs/runbooks/cloud-run.md). */
const TRUSTED_HOPS = Math.max(1, Math.floor(Number(process.env.TRUST_PROXY_HOPS ?? 1)) || 1);

/** Bun server's `requestIP` shape — accepts a Request, returns address+family
 *  or null. Loosened here so callers can pass any object with a compatible
 *  signature without importing Bun types directly. */
type RequestIPFn = (req: Request) => { address?: string } | null | undefined;

interface BunServerLike {
  requestIP?: RequestIPFn;
}

/** The entry `hops` from the right of an X-Forwarded-For value, or null when the header is too short. */
export function pickForwardedFor(xff: string | null | undefined, hops: number = TRUSTED_HOPS): string | null {
  if (!xff) return null;
  const entries = xff.split(',').map((s) => s.trim()).filter(Boolean);
  const pick = entries[entries.length - hops];
  return pick || null;
}

/** Resolve the trusted client IP for `req`. `server` is optional but
 *  required for the secure (`TRUST_PROXY=false`) path. */
export function getClientIp(
  req: Request,
  server?: BunServerLike | undefined,
): string {
  if (TRUST_PROXY) {
    const picked = pickForwardedFor(req.headers.get('x-forwarded-for'));
    if (picked) return picked;
  }
  const peer = server?.requestIP?.(req);
  return peer?.address || 'unknown';
}
