import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index';
import { createQueryClient } from './connection';

const queryClient = createQueryClient();
export const db = drizzle(queryClient, { schema });

export type Database = typeof db;

/** Shutdown: drain the pool (waits up to `timeoutSec` for in-flight queries) so the server does not log
 *  reset connections. */
export async function closeDb(timeoutSec = 2): Promise<void> {
  await queryClient.end({ timeout: timeoutSec });
}
