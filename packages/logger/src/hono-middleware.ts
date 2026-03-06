import type { MiddlewareHandler } from 'hono';
import pino from 'pino';
import { pinoLogger } from 'hono-pino';

const env = process.env.NODE_ENV ?? 'development';
const usePretty = env === 'development';

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
  });
}
