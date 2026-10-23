import { describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { poolMax, resolveConnection } from '../connection';

describe('resolveConnection', () => {
  test('Cloud SQL socket form: strips host= and returns the socket file as `path`', () => {
    const r = resolveConnection('postgresql://api:s3cret@localhost/clawbada?host=/cloudsql/my-proj:us-east4:clawbada-pg');
    expect(r.url).toBe('postgresql://api:s3cret@localhost/clawbada');
    expect(r.options).toEqual({ path: '/cloudsql/my-proj:us-east4:clawbada-pg/.s.PGSQL.5432' });
    // What postgres.js actually resolves (constructing a client does not connect).
    const opts = postgres(r.url, r.options).options;
    expect(opts.path).toBe('/cloudsql/my-proj:us-east4:clawbada-pg/.s.PGSQL.5432');
    expect(opts.host).toEqual(['localhost']);
    expect(opts.port).toEqual([5432]);
    expect(opts.ssl).toBe(false);
    expect(opts.database).toBe('clawbada');
    expect((opts.connection as Record<string, unknown>).host).toBeUndefined();
  });

  test('plain TCP URL is returned untouched with no options', () => {
    const url = 'postgresql://clawbada:clawbada@localhost:5432/clawbada';
    expect(resolveConnection(url)).toEqual({ url, options: {} });
    expect(postgres(url).options.path).toBeFalsy();   // postgres.js stores `false` for "no socket"
  });

  test('TCP with sslmode keeps the parameter and adds no socket path', () => {
    const url = 'postgresql://u:p@10.1.2.3:5432/db?sslmode=require';
    expect(resolveConnection(url)).toEqual({ url, options: {} });
    expect(postgres(url).options.ssl).toBe('require');
  });

  test('a non-URL value passes through untouched (postgres.js fails lazily, on the first query)', () => {
    expect(resolveConnection('localhost')).toEqual({ url: 'localhost', options: {} });
  });

  test('socket form keeps other params and honours an explicit port', () => {
    const r = resolveConnection('postgresql://u:p@localhost:6432/db?host=/cloudsql/p:r:i&application_name=api');
    expect(r.url).toBe('postgresql://u:p@localhost:6432/db?application_name=api');
    expect(r.options.path).toBe('/cloudsql/p:r:i/.s.PGSQL.6432');
  });
});

describe('poolMax', () => {
  test('defaults to 10 and honours DB_POOL_MAX', () => {
    expect(poolMax({})).toBe(10);
    expect(poolMax({ DB_POOL_MAX: '4' })).toBe(4);
    expect(poolMax({ DB_POOL_MAX: 'nope' })).toBe(10);
  });
});
