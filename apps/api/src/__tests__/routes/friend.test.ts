import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('@clawbada/chain', () => ({
  verifyMessage: mock(() => Promise.resolve(true)),
  getAddress: mock((addr: string) => addr),
  base: { id: 8453 },
  baseSepolia: { id: 84532 },
}));

// The real service rules run against an in-memory repo; the battle start is a stub.
import { FriendRoomService, FriendRoomError } from '../../lib/friend-rooms/service';
import { MemoryFriendRoomRepo } from '../../lib/friend-rooms/memory-repo';
const repo = new MemoryFriendRoomRepo();
const startBattle = mock(async () => 'f_00000000-0000-4000-8000-000000000001');
const battleActive = mock(async (_id: string) => true);
const service = new FriendRoomService({ repo, startBattle, battleActive });
mock.module('../../lib/friend-rooms', () => ({ friendRooms: service, FriendRoomError }));
const livePracticeCount = mock(() => 0);
// Keep the real exports other route test files rely on (bun shares module mocks across files in one run).
import { isPracticeId, isOffChainId, CHAIN_ID_RE } from '../../lib/battle-session/protocol';
import { PracticeConflictError } from '../../lib/battle-session/manager';
/** Which battles are still being played, as the per-IP share of live battles asks (lib/live-battles.ts). */
const liveGet = mock((_id: string): unknown => undefined);
mock.module('../../lib/battle-session', () => ({ isPracticeId, isOffChainId, CHAIN_ID_RE, PracticeConflictError, battleSessions: { livePracticeCount, get: liveGet } }));

import { friendRoutes } from '../../routes/game/friend';
import { createTestApp, authHeaders, TEST_ADDRESS } from '../helpers/route-test-utils';
import { mintSessionToken, resetSessionSecret } from '../../lib/session-token';
import { assertGuestScope } from '../../middleware/auth';

const app = createTestApp(friendRoutes, '/api/game/friend');
const GUEST = '0x9999999999999999999999999999999999999999';
const guestHeaders = (address = GUEST) => ({ Authorization: `Bearer ${mintSessionToken(address, undefined, { guest: true }).token}` });
const json = (headers: Record<string, string>, body?: unknown) => ({ method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

beforeEach(() => { repo.rows.clear(); resetSessionSecret?.(); livePracticeCount.mockImplementation(() => 0); battleActive.mockImplementation(async () => true); });

describe('friend routes', () => {
  test('a guest (no wallet) can open a room; the invite is roomId.secret', async () => {
    const res = await app.request('/api/game/friend/rooms', json(guestHeaders()));
    expect(res.status).toBe(201);
    const body = await res.json() as { roomId: string; secret: string; invite: string };
    expect(body.invite).toBe(`${body.roomId}.${body.secret}`);
  });

  test('a wallet works too', async () => {
    expect((await app.request('/api/game/friend/rooms', json(authHeaders()))).status).toBe(201);
  });

  test('no session at all is refused', async () => {
    const res = await app.request('/api/game/friend/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(401);
  });

  test('bodies take exactly the listed fields (no staked / ranked / bracket riding along)', async () => {
    for (const extra of [{ staked: true }, { ranked: true }, { bracket: 2 }, { stakeAmount: '100' }]) {
      const res = await app.request('/api/game/friend/rooms', json(guestHeaders(), extra));
      expect(res.status).toBe(400);
    }
  });

  test('the host sets the match rules (tier, purity) when opening the room; the view carries them', async () => {
    const res = await app.request('/api/game/friend/rooms', json(guestHeaders(), { tier: 'apex', purity: 6 }));
    expect(res.status).toBe(201);
    const { roomId } = await res.json() as { roomId: string };
    const view = await (await app.request(`/api/game/friend/rooms/${roomId}`, { headers: guestHeaders() })).json() as { tier: string; purity: number };
    expect(view).toMatchObject({ tier: 'apex', purity: 6 });
    expect((await app.request('/api/game/friend/rooms', json(guestHeaders(), { tier: 'mythic' }))).status).toBe(400);
  });

  test('a guest and a wallet play the whole lobby: join, teams, ready → battle', async () => {
    const created = await (await app.request('/api/game/friend/rooms', json(authHeaders()))).json() as { roomId: string; secret: string };
    const joined = await app.request(`/api/game/friend/rooms/${created.roomId}/join`, json(guestHeaders(), { secret: created.secret }));
    expect(joined.status).toBe(200);
    const team = { classes: ['kraken', 'ember', 'abyss'], tier: 'elite', purity: 3 };   // the room's default rules
    expect((await app.request(`/api/game/friend/rooms/${created.roomId}/team`, json(authHeaders(), { team }))).status).toBe(200);
    expect((await app.request(`/api/game/friend/rooms/${created.roomId}/team`, json(guestHeaders(), { team: { ...team, classes: ['bulwark', 'mantis', 'sentinel'] } }))).status).toBe(200);
    // The host's view never carries the friend's classes — nor who the friend is: opening an invite must not tell
    // the host which address opened it (the two are exchanged when both press Battle).
    const hostView = await (await app.request(`/api/game/friend/rooms/${created.roomId}`, { headers: authHeaders() })).json() as { opponent: Record<string, unknown> };
    expect(JSON.stringify(hostView)).not.toContain('bulwark');
    expect(hostView.opponent).toEqual({ joined: true, lockedIn: true, ready: false });
    expect(JSON.stringify(hostView).toLowerCase()).not.toContain(GUEST.toLowerCase());
    const friendView = await (await app.request(`/api/game/friend/rooms/${created.roomId}`, { headers: guestHeaders() })).json();
    expect(JSON.stringify(friendView).toLowerCase()).not.toContain(TEST_ADDRESS.toLowerCase());
    await app.request(`/api/game/friend/rooms/${created.roomId}/ready`, json(authHeaders()));
    const done = await (await app.request(`/api/game/friend/rooms/${created.roomId}/ready`, json(guestHeaders()))).json() as { battleId: string; status: string };
    expect(done.battleId).toMatch(/^f_/);
    expect(done.status).toBe('in_battle');
    expect(startBattle).toHaveBeenCalled();
  });

  test('a wrong secret answers 404 and the host gets 409 on their own link', async () => {
    const created = await (await app.request('/api/game/friend/rooms', json(guestHeaders()))).json() as { roomId: string; secret: string };
    expect((await app.request(`/api/game/friend/rooms/${created.roomId}/join`, json(authHeaders(), { secret: 'B'.repeat(22) }))).status).toBe(404);
    expect((await app.request(`/api/game/friend/rooms/${created.roomId}/join`, json(guestHeaders(), { secret: created.secret }))).status).toBe(409);
  });

  test('a battle counts against the IP whose `ready` started it: at its share that IP starts no other, a different IP does', async () => {
    process.env.PRACTICE_MAX_LIVE_PER_IP = '1';
    try {
      const live = new Set<string>();
      liveGet.mockImplementation((id: string) => (live.has(id) ? {} : undefined));
      let n = 0;
      startBattle.mockImplementation(async () => { const id = `f_00000000-0000-4000-8000-0000000000${10 + n++}`; live.add(id); return id; });
      // The caller's IP, both ways it can be resolved: the connection peer (the real resolver) and X-Forwarded-For
      // (the stub rate-limit.test.ts installs for the whole run — bun shares module mocks across files).
      const at = (ip: string) => ({ server: { requestIP: () => ({ address: ip }) } });
      const who = (k: number) => guestHeaders(`0x00000000000000000000000000000000000000${(0xb0 + k).toString(16)}`);
      const team = { classes: ['kraken', 'ember', 'abyss'], tier: 'elite', purity: 3 };
      /** A lobby with both teams locked in, nobody ready yet. */
      const lobby = async (host: number, friend: number): Promise<string> => {
        const created = await (await app.request('/api/game/friend/rooms', json(who(host)))).json() as { roomId: string; secret: string };
        await app.request(`/api/game/friend/rooms/${created.roomId}/join`, json(who(friend), { secret: created.secret }));
        await app.request(`/api/game/friend/rooms/${created.roomId}/team`, json(who(host), { team }));
        await app.request(`/api/game/friend/rooms/${created.roomId}/team`, json(who(friend), { team }));
        return created.roomId;
      };
      const ready = (room: string, player: number, ip: string) => app.request(`/api/game/friend/rooms/${room}/ready`, json({ ...who(player), 'x-forwarded-for': ip }), at(ip));

      const first = await lobby(1, 2);
      expect((await ready(first, 1, '198.51.100.1')).status).toBe(200);          // starts nothing: the slot is given back
      const started = await (await ready(first, 2, '198.51.100.1')).json() as { status: string };
      expect(started.status).toBe('in_battle');

      const second = await lobby(3, 4);
      const refused = await ready(second, 3, '198.51.100.1');                    // that IP is at its share (1)
      expect(refused.status).toBe(429);
      expect((await refused.json() as { message: string }).message).toContain('Too many battles');
      expect((await ready(second, 3, '198.51.100.2')).status).toBe(200);         // another IP is not
      expect((await (await ready(second, 4, '198.51.100.2')).json() as { status: string }).status).toBe('in_battle');

      live.clear();                                                               // both battles end
      const third = await lobby(5, 6);
      expect((await ready(third, 5, '198.51.100.1')).status).toBe(200);
    } finally {
      delete process.env.PRACTICE_MAX_LIVE_PER_IP;
      startBattle.mockImplementation(async () => 'f_00000000-0000-4000-8000-000000000001');
    }
  });

  test('ready answers 429 when the Dojo is full', async () => {
    livePracticeCount.mockImplementation(() => 1_000_000);
    const created = await (await app.request('/api/game/friend/rooms', json(guestHeaders()))).json() as { roomId: string };
    expect((await app.request(`/api/game/friend/rooms/${created.roomId}/ready`, json(guestHeaders()))).status).toBe(429);
  });

  test('rematch: after the battle either player asks; sides swap; strangers 404; empty body only', async () => {
    const created = await (await app.request('/api/game/friend/rooms', json(authHeaders()))).json() as { roomId: string; secret: string };
    const id = created.roomId;
    await app.request(`/api/game/friend/rooms/${id}/join`, json(guestHeaders(), { secret: created.secret }));
    const team = { classes: ['kraken', 'ember', 'abyss'], tier: 'elite', purity: 3 };   // the room's default rules
    await app.request(`/api/game/friend/rooms/${id}/team`, json(authHeaders(), { team }));
    await app.request(`/api/game/friend/rooms/${id}/team`, json(guestHeaders(), { team }));
    await app.request(`/api/game/friend/rooms/${id}/ready`, json(authHeaders()));
    await app.request(`/api/game/friend/rooms/${id}/ready`, json(guestHeaders()));
    expect((await app.request(`/api/game/friend/rooms/${id}/rematch`, json(guestHeaders()))).status).toBe(409);   // still playing
    battleActive.mockImplementation(async () => false);
    expect((await app.request(`/api/game/friend/rooms/${id}/rematch`, json(guestHeaders(), { staked: true }))).status).toBe(400);
    expect((await app.request(`/api/game/friend/rooms/${id}/rematch`, json(guestHeaders('0x8888888888888888888888888888888888888888')))).status).toBe(404);
    const res = await app.request(`/api/game/friend/rooms/${id}/rematch`, json(guestHeaders()));
    expect(res.status).toBe(200);
    const v = await res.json() as { id: string; role: string; status: string; rematchOf: string };
    expect(v).toMatchObject({ role: 'host', status: 'seated', rematchOf: id });
    const hostSees = await (await app.request(`/api/game/friend/rooms/${id}`, { headers: authHeaders() })).json() as { rematch: { roomId: string; offeredBy: string } };
    expect(hostSees.rematch).toMatchObject({ roomId: v.id, offeredBy: 'opponent' });
  });

  test('guest scope: friend battle ids are allowed, chain battle ids are not', () => {
    expect(() => assertGuestScope(true, 'f_00000000-0000-4000-8000-000000000001')).not.toThrow();
    expect(() => assertGuestScope(true, 'p_00000000-0000-4000-8000-000000000001')).not.toThrow();
    expect(() => assertGuestScope(true, '42')).toThrow();
    expect(() => assertGuestScope(true, null)).toThrow();
  });
});

void TEST_ADDRESS;
