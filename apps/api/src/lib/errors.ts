import type { Context } from 'hono';

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'CHAIN_ERROR'
  | 'COOLDOWN_ACTIVE'
  | 'RATE_LIMITED'
  | 'INSUFFICIENT_TIER'
  | 'LOBSTER_LOCKED'
  | 'BATTLE_PHASE_ERROR'
  | 'INTERNAL_ERROR';

const STATUS_MAP: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  CHAIN_ERROR: 502,
  COOLDOWN_ACTIVE: 409,
  RATE_LIMITED: 429,
  INSUFFICIENT_TIER: 403,
  LOBSTER_LOCKED: 409,
  BATTLE_PHASE_ERROR: 409,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.status = STATUS_MAP[code];
    this.name = 'ApiError';
  }
}

type HandlerFn = (c: Context) => Promise<Response>;

export function catchErrors(handler: HandlerFn): HandlerFn {
  return async (c: Context) => {
    try {
      return await handler(c);
    } catch (err) {
      if (err instanceof ApiError) {
        return c.json({ error: err.code, message: err.message }, err.status as any);
      }
      console.error('Unhandled error:', err);
      return c.json(
        { error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        500,
      );
    }
  };
}
