import type { Context, MiddlewareHandler } from 'hono';
import pino from 'pino';
import { pinoLogger } from 'hono-pino';

const env = process.env.NODE_ENV ?? 'development';
const usePretty = env === 'development';

/** Request headers worth keeping in the request log. hono-pino's default binding logs EVERY header, which put
 *  bearer tokens (`authorization`) and the WebSocket token query into the logs of whoever hosts us. Only an
 *  allow-list is logged; `x-forwarded-for` stays because it is how the proxy hop count (TRUST_PROXY_HOPS) is
 *  verified against a live request. */
const LOGGED_HEADERS = ['user-agent', 'content-type', 'content-length', 'origin', 'x-forwarded-for', 'x-auth-domain'] as const;

/** Query strings can carry credentials too (`/ws?token=…`, `signature=`): log the path only. */
function requestBindings(c: Context): pino.Bindings {
  const headers: Record<string, string> = {};
  for (const name of LOGGED_HEADERS) {
    const v = c.req.header(name);
    if (v) headers[name] = v;
  }
  return { req: { url: c.req.path, method: c.req.method, headers } };
}

export function createHonoLogger(service = 'api'): MiddlewareHandler {
  const level = process.env.LOG_LEVEL ?? (usePretty ? 'debug' : 'info');

  return pinoLogger({
    pino: pino({
      level,
      base: { service, env },
      ...(usePretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true },
            },
          }
        : {}),
    }),
    http: { onReqBindings: requestBindings },
  });
}
