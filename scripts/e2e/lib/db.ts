/**
 * One throwaway Postgres database per run on the local `clawbada-pg` container
 * (postgresql://clawbada:clawbada@127.0.0.1:5432). Migrated with the repo's drizzle
 * migrations; dropped on teardown unless `--keep`.
 */
import postgres from 'postgres';
import { spawn } from 'bun';

export interface RunDb {
  name: string;
  url: string;
  /** Raw SQL for assertions: sql`select ...`. */
  sql: ReturnType<typeof postgres>;
  drop(): Promise<void>;
  close(): Promise<void>;
}

const ADMIN_URL = process.env.E2E_PG_ADMIN_URL ?? 'postgresql://clawbada:clawbada@127.0.0.1:5432/clawbada';

export async function createRunDb(repoRoot: string, tag: string): Promise<RunDb> {
  const name = `clawbada_e2e_${tag}`;
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/[^/]+$/, `/${name}`);

  // drizzle-kit migrate via the db workspace (reads DATABASE_URL).
  const mig = spawn(['bun', 'run', '--filter', '@clawbada/db', 'migrate'], {
    cwd: repoRoot, env: { ...process.env, DATABASE_URL: url }, stdout: 'pipe', stderr: 'pipe',
  });
  const [out, err] = await Promise.all([new Response(mig.stdout).text(), new Response(mig.stderr).text()]);
  const code = await mig.exited;
  if (code !== 0) throw new Error(`db migrate failed (exit ${code}):\n${out}\n${err}`);

  const sql = postgres(url, { max: 4, onnotice: () => {} });
  return {
    name, url, sql,
    async close() { await sql.end({ timeout: 2 }); },
    async drop() {
      await sql.end({ timeout: 2 }).catch(() => {});
      const a = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
      await a.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
