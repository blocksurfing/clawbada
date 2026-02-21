import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { ApiError, catchErrors, type ErrorCode } from '../lib/errors';

// ──────────── ApiError constructor ────────────

describe('ApiError', () => {
  const cases: Array<{ code: ErrorCode; expectedStatus: number }> = [
    { code: 'INVALID_INPUT', expectedStatus: 400 },
    { code: 'NOT_FOUND', expectedStatus: 404 },
    { code: 'UNAUTHORIZED', expectedStatus: 401 },
    { code: 'CHAIN_ERROR', expectedStatus: 502 },
    { code: 'COOLDOWN_ACTIVE', expectedStatus: 409 },
    { code: 'RATE_LIMITED', expectedStatus: 429 },
    { code: 'INSUFFICIENT_TIER', expectedStatus: 403 },
    { code: 'LOBSTER_LOCKED', expectedStatus: 409 },
    { code: 'BATTLE_PHASE_ERROR', expectedStatus: 409 },
    { code: 'INTERNAL_ERROR', expectedStatus: 500 },
  ];

  for (const { code, expectedStatus } of cases) {
    test(`constructor sets correct fields for ${code}`, () => {
      const msg = `Test message for ${code}`;
      const err = new ApiError(code, msg);

      expect(err.code).toBe(code);
      expect(err.message).toBe(msg);
      expect(err.status).toBe(expectedStatus);
    });
  }

  test('name is "ApiError"', () => {
    const err = new ApiError('NOT_FOUND', 'gone');
    expect(err.name).toBe('ApiError');
  });

  test('is instanceof Error', () => {
    const err = new ApiError('INTERNAL_ERROR', 'boom');
    expect(err).toBeInstanceOf(Error);
  });
});

// ──────────── catchErrors ────────────

describe('catchErrors', () => {
  test('returns handler response when no error is thrown', async () => {
    const app = new Hono();
    app.get(
      '/test',
      catchErrors(async (c) => {
        return c.json({ ok: true }, 200);
      }),
    );

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  test('returns correct JSON response when handler throws ApiError', async () => {
    const app = new Hono();
    app.get(
      '/test',
      catchErrors(async () => {
        throw new ApiError('NOT_FOUND', 'Lobster not found');
      }),
    );

    const res = await app.request('/test');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'NOT_FOUND', message: 'Lobster not found' });
  });

  test('maps each ApiError code to the right HTTP status', async () => {
    const codes: Array<{ code: ErrorCode; status: number }> = [
      { code: 'INVALID_INPUT', status: 400 },
      { code: 'UNAUTHORIZED', status: 401 },
      { code: 'CHAIN_ERROR', status: 502 },
      { code: 'RATE_LIMITED', status: 429 },
      { code: 'INSUFFICIENT_TIER', status: 403 },
    ];

    for (const { code, status } of codes) {
      const app = new Hono();
      app.get(
        '/test',
        catchErrors(async () => {
          throw new ApiError(code, 'err');
        }),
      );

      const res = await app.request('/test');
      expect(res.status).toBe(status);
      const body = await res.json();
      expect(body.error).toBe(code);
    }
  });

  test('returns 500 INTERNAL_ERROR when handler throws a regular Error', async () => {
    const app = new Hono();
    app.get(
      '/test',
      catchErrors(async () => {
        throw new Error('something broke');
      }),
    );

    const res = await app.request('/test');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  });

  test('returns 500 INTERNAL_ERROR when handler throws a non-Error value', async () => {
    const app = new Hono();
    app.get(
      '/test',
      catchErrors(async () => {
        throw 'string error'; // eslint-disable-line no-throw-literal
      }),
    );

    const res = await app.request('/test');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('INTERNAL_ERROR');
  });
});
