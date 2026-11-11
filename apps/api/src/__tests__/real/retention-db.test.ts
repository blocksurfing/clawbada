/**
 * The housekeeping deletes against a REAL Postgres: which rows go and, above all, which never do.
 *
 * Skipped unless TEST_DATABASE_URL names a migrated database (CI has none):
 *   TEST_DATABASE_URL=postgresql://clawbada:clawbada@127.0.0.1:5432/clawbada bun test src/__tests__/real/retention-db.test.ts
 * It never touches that database's own rows: it copies the three tables' shape into a throwaway schema, points
 * its one connection at it, and drops the schema afterwards.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { battleSessions, battleTurns, friendRooms, createQueryClient, type Database } from '@clawbada/db';
import { DbRetentionStore } from '../../lib/retention-store';
import { purgeOnce } from '../../lib/retention';

const url = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;
const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const CUTOFF = ago(30);
type PgSql = ReturnType<typeof createQueryClient>;

describe.skipIf(!url)('DbRetentionStore (real Postgres)', () => {
  const schema = `retention_test_${randomUUID().slice(0, 8)}`;
  let admin: PgSql;
  let client: PgSql;
  let dbx: Database;
  let store: DbRetentionStore;

  const session = (id: string, kind: string, status: string, days: number) =>
    ({ id, kind, status, playerA: '0xa', playerB: kind === 'practice' ? 'bot:balanced' : '0xb', tier: 'elite', roster: [], stateJson: '{}', updatedAt: ago(days), createdAt: ago(days) });
  const turns = (sessionId: string, n = 3) =>
    Array.from({ length: n }, (_, turn) => ({ sessionId, turn, lobsterId: 'A0', result: {}, postStateHash: '0x0', submittedBy: 'player' }));
  const room = (id: string, status: string, days: number, battleId: string | null = null) =>
    ({ id, host: '0xa', guest: '0xb', secretHash: 'h', status, battleId, expiresAt: ago(days), updatedAt: ago(days), createdAt: ago(days) });
  const sessionIds = async () => (await dbx.select({ id: battleSessions.id }).from(battleSessions)).map((r) => r.id).sort();
  const turnOwners = async () => [...new Set((await dbx.select({ id: battleTurns.sessionId }).from(battleTurns)).map((r) => r.id))].sort();
  const roomIds = async () => (await dbx.select({ id: friendRooms.id }).from(friendRooms)).map((r) => r.id).sort();

  beforeAll(async () => {
    admin = createQueryClient(url, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    for (const t of ['battle_sessions', 'battle_turns', 'friend_rooms']) await admin.unsafe(`CREATE TABLE ${schema}.${t} (LIKE public.${t} INCLUDING ALL)`);
    client = createQueryClient(url, { max: 1, connection: { search_path: schema } });
    dbx = drizzle(client) as unknown as Database;
    store = new DbRetentionStore(dbx);

    await dbx.insert(battleSessions).values([
      session('p_old_finished', 'practice', 'finished', 31),
      session('f_old_finished', 'friend', 'finished', 45),
      session('p_old_abandoned', 'practice', 'abandoned', 31),
      session('p_recent_finished', 'practice', 'finished', 29),
      session('p_old_active', 'practice', 'active', 60),
      session('f_old_active', 'friend', 'active', 31),
      session('1001', 'real', 'settled', 400),
      session('1002', 'real', 'finished', 400),
      session('1003', 'real', 'abandoned', 400),
    ]);
    for (const id of ['p_old_finished', 'f_old_finished', 'p_recent_finished', 'p_old_active', '1001', '1002']) await dbx.insert(battleTurns).values(turns(id));
    await dbx.insert(friendRooms).values([
      room('r_old_ended', 'ended', 31, 'f_old_finished'),
      room('r_old_open', 'open', 40),
      room('r_old_cancelled', 'cancelled', 35),
      room('r_old_expired', 'expired', 35),
      room('r_recent_ended', 'ended', 10),
      room('r_old_live_battle', 'in_battle', 31, 'f_old_active'),
      room('r_old_stale_in_battle', 'in_battle', 31, 'f_old_finished'),
      room('r_old_in_battle_no_id', 'in_battle', 31),
    ]);
  });

  afterAll(async () => {
    await client?.end({ timeout: 2 });
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end({ timeout: 2 });
  });

  test('the test really runs in its own schema', async () => {
    const [{ current_schema }] = await client`select current_schema()`;
    expect(current_schema).toBe(schema);
  });

  test('a batch takes no more than its limit', async () => {
    expect((await store.purgeSessions(CUTOFF, 2)).sessions).toBe(2);
    expect((await sessionIds()).length).toBe(7);
  });

  test('old finished practice and friend battles go, with their turns; everything else stays', async () => {
    const rest = await store.purgeSessions(CUTOFF, 100);
    expect(rest.sessions).toBe(1);
    expect(await sessionIds()).toEqual(['1001', '1002', '1003', 'f_old_active', 'p_old_active', 'p_recent_finished']);
    // Turns: only the deleted battles' are gone. A real battle's log and a live battle's turns are intact.
    expect(await turnOwners()).toEqual(['1001', '1002', 'p_old_active', 'p_recent_finished']);
    expect((await dbx.select().from(battleTurns)).length).toBe(12);
    expect(await store.purgeSessions(CUTOFF, 100)).toEqual({ sessions: 0, turns: 0 });
  });

  test('old rooms go — unless the room\'s battle is still live — and recent ones stay', async () => {
    expect(await store.purgeRooms(CUTOFF, 100)).toBe(6);
    expect(await roomIds()).toEqual(['r_old_live_battle', 'r_recent_ended']);
    expect(await store.purgeRooms(CUTOFF, 100)).toBe(0);
  });

  test('a row exactly at the cutoff stays (strictly older only)', async () => {
    await dbx.insert(battleSessions).values({ ...session('p_at_cutoff', 'practice', 'finished', 0), updatedAt: CUTOFF });
    await dbx.insert(friendRooms).values({ ...room('r_at_cutoff', 'ended', 0), updatedAt: CUTOFF });
    expect(await store.purgeSessions(CUTOFF, 100)).toEqual({ sessions: 0, turns: 0 });
    expect(await store.purgeRooms(CUTOFF, 100)).toBe(0);
  });

  test('a whole pass through purgeOnce counts turns and leaves nothing old behind', async () => {
    await dbx.insert(battleSessions).values([1, 2, 3, 4, 5].map((i) => session(`p_bulk_${i}`, 'practice', 'finished', 90)));
    for (const i of [1, 2, 3, 4, 5]) await dbx.insert(battleTurns).values(turns(`p_bulk_${i}`, 4));
    await dbx.insert(friendRooms).values([1, 2, 3].map((i) => room(`r_bulk_${i}`, 'ended', 90)));
    const pass = await purgeOnce(store, { days: 30, now: NOW, batch: 2, maxBatches: 10, pause: async () => {} });
    expect(pass).toEqual({ sessions: 5, turns: 20, rooms: 3, capped: false });
    expect(await sessionIds()).toEqual(['1001', '1002', '1003', 'f_old_active', 'p_at_cutoff', 'p_old_active', 'p_recent_finished']);
    expect(await roomIds()).toEqual(['r_at_cutoff', 'r_old_live_battle', 'r_recent_ended']);
  });
});
