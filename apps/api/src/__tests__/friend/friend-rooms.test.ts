import { describe, expect, test } from 'bun:test';
import { FriendRoomService, FriendRoomError, INVITE_TTL_MS, LOBBY_TTL_MS, hashSecret, validateTeam, type FriendRoomRow } from '../../lib/friend-rooms/service';
import { MemoryFriendRoomRepo } from '../../lib/friend-rooms/memory-repo';

const HOST = '0x1111111111111111111111111111111111111111';
const FRIEND = '0x2222222222222222222222222222222222222222';
const STRANGER = '0x3333333333333333333333333333333333333333';
const TEAM = { classes: ['kraken', 'ember', 'abyss'], tier: 'apex', purity: 6 };
const TEAM2 = { classes: ['bulwark', 'mantis', 'sentinel'], tier: 'evolved', purity: 2 };

function setup(opts: { startFails?: boolean } = {}) {
  let now = 1_800_000_000_000;
  const repo = new MemoryFriendRoomRepo();
  const started: FriendRoomRow[] = [];
  const active = new Set<string>();
  const svc = new FriendRoomService({
    repo,
    now: () => now,
    startBattle: async (room) => {
      if (opts.startFails) throw new Error('boom');
      started.push(room);
      const id = `f_00000000-0000-4000-8000-00000000000${started.length}`;
      active.add(id);
      return id;
    },
    battleActive: async (id) => active.has(id),
  });
  return { svc, repo, started, active, tick: (ms: number) => { now += ms; } };
}

async function seated() {
  const s = setup();
  const room = await s.svc.create(HOST);
  await s.svc.join(room.roomId, room.secret, FRIEND);
  return { ...s, room };
}

describe('friend rooms', () => {
  test('create: 128-bit secret returned once, only its hash stored, 15 min expiry', async () => {
    const { svc, repo } = setup();
    const room = await svc.create(HOST);
    expect(room.roomId).toMatch(/^r_[0-9a-f-]{36}$/);
    expect(Buffer.from(room.secret, 'base64url').length).toBe(16);
    const row = repo.rows.get(room.roomId)!;
    expect(row.secretHash).toBe(hashSecret(room.secret));
    expect(JSON.stringify(row)).not.toContain(room.secret);
    expect(new Date(room.expiresAt).getTime() - 1_800_000_000_000).toBe(INVITE_TTL_MS);
  });

  test('a new room cancels the host\'s older unstarted ones (one live invite at a time)', async () => {
    const { svc, repo } = setup();
    const a = await svc.create(HOST);
    const b = await svc.create(HOST);
    expect(repo.rows.get(a.roomId)!.status).toBe('cancelled');
    expect(repo.rows.get(b.roomId)!.status).toBe('open');
  });

  test('join: first friend takes the seat; the link is single-use', async () => {
    const { svc, room } = await seated();
    const again = svc.join(room.roomId, room.secret, STRANGER);
    await expect(again).rejects.toThrow(FriendRoomError);
    await expect(again).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('join: refreshing your own accepted link shows the lobby again', async () => {
    const { svc, room } = await seated();
    const view = await svc.join(room.roomId, room.secret, FRIEND);
    expect(view.role).toBe('guest');
    expect(view.status).toBe('seated');
  });

  test('join: wrong secret, unknown room and expired room all answer the same NOT_FOUND', async () => {
    const s = setup();
    const room = await s.svc.create(HOST);
    for (const attempt of [
      () => s.svc.join(room.roomId, 'A'.repeat(22), FRIEND),
      () => s.svc.join('r_00000000-0000-4000-8000-000000000000', room.secret, FRIEND),
      () => s.svc.join('not-a-room', room.secret, FRIEND),
    ]) await expect(attempt()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    s.tick(INVITE_TTL_MS + 1);
    await expect(s.svc.join(room.roomId, room.secret, FRIEND)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('the host cannot take their own seat', async () => {
    const { svc } = setup();
    const room = await svc.create(HOST);
    await expect(svc.join(room.roomId, room.secret, HOST)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('joining gives the lobby a fresh window; an idle lobby expires', async () => {
    const s = await seated();
    const view = await s.svc.view(s.room.roomId, HOST);
    expect(new Date(view.expiresAt).getTime() - 1_800_000_000_000).toBe(LOBBY_TTL_MS);
    s.tick(LOBBY_TTL_MS + 1);
    expect((await s.svc.view(s.room.roomId, HOST)).status).toBe('expired');
  });

  test('teams stay hidden: the other player only sees "locked in"', async () => {
    const { svc, room } = await seated();
    await svc.setTeam(room.roomId, HOST, TEAM);
    const friendView = await svc.view(room.roomId, FRIEND);
    expect(friendView.opponent.lockedIn).toBe(true);
    expect(JSON.stringify(friendView)).not.toContain('kraken');
    const hostView = await svc.view(room.roomId, HOST);
    expect(hostView.you.team?.classes).toEqual(['kraken', 'ember', 'abyss']);
  });

  test('both teams + both ready → exactly one battle starts, host on A with their team', async () => {
    const { svc, room, started } = await seated();
    await svc.setTeam(room.roomId, HOST, TEAM);
    await svc.setTeam(room.roomId, FRIEND, TEAM2);
    const first = await svc.ready(room.roomId, HOST);
    expect(first.battleId).toBeNull();
    const [a, b] = await Promise.all([svc.ready(room.roomId, FRIEND), svc.ready(room.roomId, FRIEND)]);
    expect(started.length).toBe(1);
    expect(started[0].host).toBe(HOST);
    expect(started[0].guest).toBe(FRIEND);
    expect(started[0].hostTeam?.classes[0]).toBe('kraken');
    expect((a.battleId ?? b.battleId)).toMatch(/^f_/);
    expect((await svc.view(room.roomId, HOST)).status).toBe('in_battle');
  });

  test('ready needs a team; a ready team is locked', async () => {
    const { svc, room } = await seated();
    await expect(svc.ready(room.roomId, HOST)).rejects.toMatchObject({ code: 'CONFLICT' });
    await svc.setTeam(room.roomId, HOST, TEAM);
    await svc.ready(room.roomId, HOST);
    await expect(svc.setTeam(room.roomId, HOST, TEAM2)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('a failed start puts the lobby back (both unready) and surfaces the error', async () => {
    const s = setup({ startFails: true });
    const room = await s.svc.create(HOST);
    await s.svc.join(room.roomId, room.secret, FRIEND);
    await s.svc.setTeam(room.roomId, HOST, TEAM);
    await s.svc.setTeam(room.roomId, FRIEND, TEAM2);
    await s.svc.ready(room.roomId, HOST);
    await expect(s.svc.ready(room.roomId, FRIEND)).rejects.toThrow('boom');
    const v = await s.svc.view(room.roomId, HOST);
    expect(v.status).toBe('seated');
    expect(v.you.ready).toBe(false);
  });

  test('the room ends when its battle is over', async () => {
    const { svc, room, active } = await seated();
    await svc.setTeam(room.roomId, HOST, TEAM);
    await svc.setTeam(room.roomId, FRIEND, TEAM2);
    await svc.ready(room.roomId, HOST);
    const v = await svc.ready(room.roomId, FRIEND);
    active.delete(v.battleId!);
    expect((await svc.view(room.roomId, HOST)).status).toBe('ended');
  });

  test('outsiders get NOT_FOUND on every room action', async () => {
    const { svc, room } = await seated();
    for (const p of [() => svc.view(room.roomId, STRANGER), () => svc.setTeam(room.roomId, STRANGER, TEAM), () => svc.ready(room.roomId, STRANGER), () => svc.cancel(room.roomId, STRANGER)]) {
      await expect(p()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  test('either player can cancel before the battle', async () => {
    const { svc, room } = await seated();
    expect((await svc.cancel(room.roomId, FRIEND)).status).toBe('cancelled');
    await expect(svc.setTeam(room.roomId, HOST, TEAM)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('team validation is strict (no extra fields, known classes/tiers, purity 0-6)', () => {
    expect(validateTeam(TEAM).tier).toBe('apex');
    for (const bad of [
      { ...TEAM, staked: true },
      { ...TEAM, classes: ['kraken', 'ember'] },
      { ...TEAM, classes: ['kraken', 'ember', 'crab'] },
      { ...TEAM, tier: 'base' },
      { ...TEAM, purity: 7 },
      { ...TEAM, purity: 2.5 },
      null,
    ]) expect(() => validateTeam(bad)).toThrow(FriendRoomError);
  });

  test('create rejects unknown arenas', async () => {
    const { svc } = setup();
    await expect(svc.create(HOST, { arena: 'moon' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await svc.create(HOST, { arena: 'elite' })).roomId).toMatch(/^r_/);
  });
});

// Play again (2026-10-29): one tap after the battle, either player, sides swapped, both seated, no link.
describe('friend rematch', () => {
  async function finished() {
    const s = await seated();
    await s.svc.setTeam(s.room.roomId, HOST, TEAM);
    await s.svc.setTeam(s.room.roomId, FRIEND, TEAM2);
    await s.svc.ready(s.room.roomId, HOST);
    const v = await s.svc.ready(s.room.roomId, FRIEND);
    s.active.delete(v.battleId!);   // the battle is over
    return s;
  }
  const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof FriendRoomError ? e.code : 'other'; } };

  test('only after the battle: not while open, seated or in battle', async () => {
    const s = await seated();
    expect(await code(s.svc.rematch(s.room.roomId, HOST))).toBe('CONFLICT');
    await s.svc.setTeam(s.room.roomId, HOST, TEAM);
    await s.svc.setTeam(s.room.roomId, FRIEND, TEAM2);
    await s.svc.ready(s.room.roomId, HOST);
    await s.svc.ready(s.room.roomId, FRIEND);
    expect(await code(s.svc.rematch(s.room.roomId, FRIEND))).toBe('CONFLICT');
  });

  test('the first ask opens one room: sides swapped, both seated, teams empty, same board, fresh lobby window', async () => {
    const s = await finished();
    const v = await s.svc.rematch(s.room.roomId, FRIEND);
    expect(v.status).toBe('seated');
    expect(v.role).toBe('host');                 // the old guest now hosts (side A changes hands)
    expect(v.you.team).toBeNull();
    expect(v.opponent).toMatchObject({ joined: true, lockedIn: false, ready: false });
    expect(v.rematchOf).toBe(s.room.roomId);
    const row = s.repo.rows.get(v.id)!;
    expect(row).toMatchObject({ host: FRIEND, guest: HOST, arena: 'dojo', rematchBy: FRIEND });
    expect(row.expiresAt.getTime() - 1_800_000_000_000).toBe(LOBBY_TTL_MS);
  });

  test('the other player sees the offer on the old room, and their ask (Accept) lands in the same room', async () => {
    const s = await finished();
    const offered = await s.svc.rematch(s.room.roomId, HOST);
    const seen = await s.svc.view(s.room.roomId, FRIEND);
    expect(seen.status).toBe('ended');
    expect(seen.rematch).toEqual({ roomId: offered.id, offeredBy: 'opponent', status: 'seated' });
    expect((await s.svc.view(s.room.roomId, HOST)).rematch?.offeredBy).toBe('you');
    const accepted = await s.svc.rematch(s.room.roomId, FRIEND);
    expect(accepted.id).toBe(offered.id);
    expect(accepted.role).toBe('host');
    expect([...s.repo.rows.values()].filter((r) => r.rematchOf === s.room.roomId)).toHaveLength(1);
  });

  test('both asking at once still makes one room', async () => {
    const s = await finished();
    const [a, b] = await Promise.all([s.svc.rematch(s.room.roomId, HOST), s.svc.rematch(s.room.roomId, FRIEND)]);
    expect(a.id).toBe(b.id);
  });

  test('declined: "no thanks" cancels it, and asking again says so', async () => {
    const s = await finished();
    const offered = await s.svc.rematch(s.room.roomId, HOST);
    await s.svc.cancel(offered.id, FRIEND);
    expect((await s.svc.view(s.room.roomId, HOST)).rematch?.status).toBe('cancelled');
    await expect(s.svc.rematch(s.room.roomId, HOST)).rejects.toThrow(/no thanks/);
  });

  test('a rematch plays like any lobby and can be followed by another', async () => {
    const s = await finished();
    const r1 = await s.svc.rematch(s.room.roomId, HOST);
    await s.svc.setTeam(r1.id, HOST, TEAM);
    await s.svc.setTeam(r1.id, FRIEND, TEAM2);
    await s.svc.ready(r1.id, HOST);
    const v = await s.svc.ready(r1.id, FRIEND);
    expect(v.status).toBe('in_battle');
    expect(s.started.at(-1)).toMatchObject({ host: FRIEND, guest: HOST });   // A is the old guest now
    s.active.delete(v.battleId!);
    const r2 = await s.svc.rematch(r1.id, HOST);
    expect(r2.role).toBe('host');                                          // and back again
    expect(s.repo.rows.get(r2.id)!.host).toBe(HOST);
  });

  test('strangers cannot ask', async () => {
    const s = await finished();
    expect(await code(s.svc.rematch(s.room.roomId, STRANGER))).toBe('NOT_FOUND');
  });
});
