import pino from 'pino';

export type Logger = pino.Logger;

export interface LoggerOptions {
  service: string;
  level?: string;
}

const env = process.env.NODE_ENV ?? 'development';
const usePretty = env === 'development';

export function createLogger(opts: LoggerOptions): pino.Logger {
  const level = opts.level ?? process.env.LOG_LEVEL ?? (usePretty ? 'debug' : 'info');

  return pino({
    level,
    base: { service: opts.service, env },
    ...(usePretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true },
          },
        }
      : {}),
  });
}
