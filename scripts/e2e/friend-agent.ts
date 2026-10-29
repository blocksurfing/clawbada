/**
 * Two agents play a friend battle over plain HTTP — no WebSocket, no wallet (Battle Friends PR 4, 2026-10-29). This is
 * the loop the OpenClaw skill documents (skills/openclaw/clawbada/SKILL.md):
 *
 *   POST /api/auth/guest → POST /friend/rooms (host) → POST /rooms/:id/join (friend, with the invite secret)
 *   → POST /rooms/:id/team → POST /rooms/:id/ready  (the second ready starts the battle)
 *   → loop: GET /combat/:id/events?after=<turn>&wait=20 → if it's my turn: GET /legal → POST /turn
 *   → until `ended`. Then POST /rooms/:id/rematch (either agent) to play again, sides swapped.
 *
 *   API=http://127.0.0.1:3011 bun scripts/e2e/friend-agent.ts
 *
 * Each agent sends its own X-Forwarded-For (run the API with TRUST_PROXY=true) so the per-IP limits apply per agent,
 * as for two agents on two machines. A 429 is answered the polite way: wait, then retry.
 */
export {};   // a module: top-level await

const API = process.env.API ?? 'http://127.0.0.1:3001';

type Agent = { name: string; token: string; address: string; ip: string; turns: number; polls: number; throttled: number };
const call = async (a: Agent, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const r = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${a.token}`, 'content-type': 'application/json', 'X-Forwarded-For': a.ip }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = (await r.json().catch(() => null)) as any;
  if (r.status === 429) { a.throttled++; if (process.env.DEBUG) console.log(`   429 ${a.name} ${method} ${path.split("?")[0]} ${JSON.stringify(j)}`); await Bun.sleep(5_000); return call(a, method, path, body); }
  if (r.status >= 400 && r.status !== 409) throw new Error(`${a.name} ${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return { status: r.status, body: j };
};
const guest = async (name: string, ip: string): Promise<Agent> => {
  const j = (await (await fetch(`${API}/api/auth/guest`, { method: 'POST', headers: { 'X-Forwarded-For': ip } })).json()) as any;
  return { name, token: j.token, address: j.address.toLowerCase(), ip, turns: 0, polls: 0, throttled: 0 };
};
const ok = (label: string, pass: boolean, detail = '') => { console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!pass) process.exitCode = 1; };

/** One agent's whole battle: long-poll, act on my turns, stop at the end. */
async function play(a: Agent, battleId: string): Promise<{ winner: string | null; turn: number }> {
  let after = -1;
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    const ev = (await call(a, 'GET', `/api/game/combat/${battleId}/events?after=${after}&wait=20`)).body;
    a.polls++;
    if (ev.retry) { await Bun.sleep(ev.retry * 1000); continue; }
    if (ev.ended) return { winner: ev.ended.winner, turn: ev.turn };
    after = ev.turn;
    const snap = ev.snapshot;
    const mySide = snap.session.playerA === a.address ? 'A' : 'B';
    if (snap.current?.side !== mySide || snap.current?.controller === 'bot') continue;
    const legal = await call(a, 'GET', `/api/game/combat/${battleId}/legal`);
    if (legal.status !== 200) continue;   // not my turn after all (the bar moved): poll again
    const cmds = legal.body.commands as any[];
    // A command is { lobsterId, move?, action: 'attack' | 'special' | 'defend', targetId? } — prefer hitting something.
    const pick = cmds.find((c) => c.action === 'special') ?? cmds.find((c) => c.action === 'attack') ?? cmds[0];
    const sub = await call(a, 'POST', `/api/game/combat/${battleId}/turn`, { turn: legal.body.turn, command: pick });
    if (sub.status === 200) a.turns++;
  }
  throw new Error(`${a.name}: the battle did not end in time`);
}

const host = await guest('host-agent', '198.51.100.55'), friend = await guest('friend-agent', '198.51.100.66');
const created = (await call(host, 'POST', '/api/game/friend/rooms', {})).body;
const [roomId, secret] = String(created.invite).split('.');
ok('host agent opens a room', /^r_/.test(roomId));
ok('friend agent joins with the secret', (await call(friend, 'POST', `/api/game/friend/rooms/${roomId}/join`, { secret })).body.status === 'seated');
await call(host, 'POST', `/api/game/friend/rooms/${roomId}/team`, { team: { classes: ['kraken', 'ember', 'abyss'], tier: 'elite', purity: 3 } });
await call(friend, 'POST', `/api/game/friend/rooms/${roomId}/team`, { team: { classes: ['bulwark', 'mantis', 'sentinel'], tier: 'elite', purity: 3 } });
await call(host, 'POST', `/api/game/friend/rooms/${roomId}/ready`);
const battleId = (await call(friend, 'POST', `/api/game/friend/rooms/${roomId}/ready`)).body.battleId as string;
ok('both ready → a friend battle', /^f_/.test(battleId ?? ''), battleId);

const t0 = Date.now();
const [rh, rf] = await Promise.all([play(host, battleId), play(friend, battleId)]);
ok('both agents played to the end over HTTP only', rh.winner !== undefined && rh.winner === rf.winner, `winner ${rh.winner}, ${rh.turn} turns, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
ok('both agents took turns', host.turns > 0 && friend.turns > 0, `host ${host.turns}, friend ${friend.turns}`);
console.log(`   throttled (429, waited and retried): host ${host.throttled}, friend ${friend.throttled}`);
ok('long-polls, not busy-polling', host.polls < rh.turn * 3 && friend.polls < rh.turn * 3, `host ${host.polls} polls, friend ${friend.polls} polls for ${rh.turn} turns`);

const room = (await call(host, 'GET', `/api/game/friend/rooms/${roomId}`)).body;
ok('the room is ended', room.status === 'ended', room.status);
const re = (await call(friend, 'POST', `/api/game/friend/rooms/${roomId}/rematch`)).body;
ok('either agent can ask for a rematch: sides swapped, both seated', re.status === 'seated' && re.role === 'host', JSON.stringify({ status: re.status, role: re.role }));
const seen = (await call(host, 'GET', `/api/game/friend/rooms/${roomId}`)).body;
ok('the other agent sees the offer on the old room', seen.rematch?.roomId === re.id && seen.rematch?.offeredBy === 'opponent');
await call(host, 'POST', `/api/game/friend/rooms/${re.id}/cancel`);
process.exit();
