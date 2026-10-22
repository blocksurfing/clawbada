#!/usr/bin/env bun
/**
 * Apply pending drizzle migrations with drizzle-orm's own migrator — the function drizzle-kit's `migrate`
 * command delegates to (drizzle-kit 0.30.x). It reads the same drizzle/meta/_journal.json, records the same
 * sha256 file hash + journal timestamp in drizzle.__drizzle_migrations, and applies only entries newer than
 * the last recorded one, so local dev keeps using `bun run migrate` (drizzle-kit) and the container runs
 * this: drizzle-kit builds its own postgres.js client from a URL and cannot reach the Cloud SQL unix
 * socket; this goes through the shared client helper. A session advisory lock serialises two containers
 * starting at once (a rollout). Exit 0 = up to date / applied; exit 1 = failure (the container then never
 * starts the API).
 *
 *   DATABASE_URL=... bun run packages/db/src/migrate.ts
 */
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createQueryClient, type PgSql } from './connection';

/** Resolved from this file, so it works from the Docker WORKDIR (/app) and from any cwd. */
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const LOCK_KEY = 7_272_740;

async function appliedCount(sql: PgSql): Promise<number> {
  const [t] = await sql<{ exists: boolean }[]>`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`;
  if (!t?.exists) return 0;
  const [c] = await sql<{ n: string }[]>`select count(*)::text as n from drizzle.__drizzle_migrations`;
  return Number(c?.n ?? 0);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  // max: 1 — the advisory lock is session-level and must live on the connection the migrator uses.
  const sql = createQueryClient(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`select pg_advisory_lock(${LOCK_KEY})`;
    try {
      const before = await appliedCount(sql);
      const t0 = Date.now();
      await migrate(drizzle(sql), { migrationsFolder });
      const after = await appliedCount(sql);
      console.log(`[migrate] ok: applied ${after - before} migration(s), ${after} total, ${Date.now() - t0} ms (${migrationsFolder})`);
    } finally {
      await sql`select pg_advisory_unlock(${LOCK_KEY})`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[migrate] FAILED', err);
    process.exit(1);
  },
);
