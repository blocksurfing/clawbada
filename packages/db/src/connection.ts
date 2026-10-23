import postgres from 'postgres';

export type PgOptions = postgres.Options<{}>;
export type PgSql = postgres.Sql<{}>;

export interface ResolvedConnection {
  /** DATABASE_URL with the `host=` socket parameter removed (postgres.js would otherwise forward it to the
   *  server as a startup parameter, which Postgres rejects). Unchanged for TCP URLs. */
  url: string;
  /** Extra postgres.js options: `path` to the socket FILE when the URL names a unix socket directory. */
  options: PgOptions;
}

/**
 * Cloud Run reaches Cloud SQL through a unix socket at /cloudsql/PROJECT:REGION:INSTANCE (file
 * `.s.PGSQL.5432` inside it). postgres.js only connects to a socket through its `host` / `path` OPTIONS:
 * a URL with an empty authority (`postgresql://u:p@/db?host=...`) does not parse at all, and a URL that
 * keeps a hostname passes `host=` through to the server untouched. So production sets
 *   DATABASE_URL=postgresql://USER:PASS@localhost/DB?host=/cloudsql/PROJECT:REGION:INSTANCE
 * and this turns the parameter into `{ path: '<dir>/.s.PGSQL.<port>' }`. `path` rather than `host`
 * because postgres.js splits `host` on ':' for its multi-host syntax, which mangles the instance name.
 * Any other URL — TCP, with or without `sslmode=` — is returned byte-for-byte unchanged.
 * Do not put `sslmode=` on the socket form: the socket is plaintext by design.
 */
export function resolveConnection(databaseUrl: string): ResolvedConnection {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    // Not a URL (unset in a unit test, PG* env vars, a bare host): hand it to postgres.js untouched, which
    // only fails on the first query — the behaviour the repo had before the socket helper.
    return { url: databaseUrl, options: {} };
  }
  const host = url.searchParams.get('host');
  if (!host || !host.startsWith('/')) return { url: databaseUrl, options: {} };
  url.searchParams.delete('host');
  const port = url.port || '5432';
  return { url: url.toString(), options: { path: `${host.replace(/\/+$/, '')}/.s.PGSQL.${port}` } };
}

/** Pool size. postgres.js defaults to 10 per process; Cloud SQL's shared-core tiers allow ~25 in total
 *  across api, engine, indexer and humans, so production sets DB_POOL_MAX per service. */
export function poolMax(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.DB_POOL_MAX);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
}

/** The one way this repo builds a postgres.js client. `overrides` win over everything. */
export function createQueryClient(databaseUrl: string | undefined = process.env.DATABASE_URL, overrides: PgOptions = {}): PgSql {
  const base: PgOptions = { max: poolMax(), connect_timeout: 10, idle_timeout: 60 };
  // No URL at all (a unit test that never queries): postgres.js's own lazy default, as before.
  if (!databaseUrl) return postgres({ ...base, ...overrides });
  const { url, options } = resolveConnection(databaseUrl);
  return postgres(url, { ...base, ...options, ...overrides });
}
