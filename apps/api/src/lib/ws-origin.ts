/**
 * Which web pages may open a WebSocket to this API.
 *
 * A browser always sends `Origin` on a WebSocket upgrade, and a page cannot fake it, so checking it stops another
 * site from opening sockets in a visitor's name. Agents and scripts send no Origin (or one they choose) and are
 * judged by their ticket / token / signature alone, exactly as before.
 *
 *   WS_ALLOWED_ORIGINS  comma-separated origins; an entry may hold one `*` (e.g. a Vercel preview pattern).
 *                       When unset: https:// + every AUTH_DOMAINS host, docs.clawbada.com (the game is served
 *                       there too), this project's Vercel previews, and localhost outside production.
 */
import { allowedAuthDomains } from '../middleware/auth';

const DEFAULT_EXTRA = [
  'https://docs.clawbada.com',
  'https://clawbada-web-*-blocksurfing-5487s-projects.vercel.app',
];

export function allowedWsOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const configured = (env.WS_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim().toLowerCase()).filter(Boolean);
  if (configured.length) return configured;
  const fromDomains = allowedAuthDomains(env).map((d) => (/^(localhost|127\.0\.0\.1)(:|$)/.test(d) ? `http://${d}` : `https://${d}`));
  const list = [...fromDomains, ...DEFAULT_EXTRA];
  if (env.NODE_ENV !== 'production') list.push('http://localhost:3000', 'http://127.0.0.1:3000');
  return [...new Set(list)];
}

function matches(pattern: string, origin: string): boolean {
  const star = pattern.indexOf('*');
  if (star < 0) return pattern === origin;
  const head = pattern.slice(0, star);
  const tail = pattern.slice(star + 1);
  // The wildcard stands for one DNS label's worth of [a-z0-9-] — never a dot, so it cannot reach another domain.
  if (!origin.startsWith(head) || !origin.endsWith(tail) || origin.length < head.length + tail.length + 1) return false;
  return /^[a-z0-9-]+$/.test(origin.slice(head.length, origin.length - tail.length));
}

/** True when the upgrade may proceed: no Origin (not a browser), or an allowed one. */
export function wsOriginAllowed(origin: string | null, allowed: string[] = allowedWsOrigins()): boolean {
  if (origin === null || origin === '') return true;
  const o = origin.trim().toLowerCase();
  return allowed.some((p) => matches(p, o));
}
