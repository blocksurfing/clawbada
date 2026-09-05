#!/usr/bin/env bun
/**
 * Play a practice battle against the API as a human-proxy bot — the protocol
 * smoke test that needs no browser.
 *
 *   bun run scripts/play-practice.ts --key 0x<hex> [--api http://localhost:3001] [--bot cautious]
 *        [--tier elite] [--preset elite_mix | --team <teamId> | --lobsters 1,2,3] [--rest] [--policy balanced]
 *
 * Flow: sign `Clawbada Auth: <ts>` with viem → POST /api/game/combat/practice →
 * open /ws with the signed params → answer every turn_started for side A with a
 * local bot policy over the seedless snapshot (submit_turn over WS, or POST /turn
 * with --rest) → verify each turn_resolved.postStateHash advances → exit 0 on
 * battle_ended. Exit 1 on any protocol error.
 */
import { privateKeyToAccount } from 'viem/accounts';
import { v3 } from '@clawbada/game-logic';

type Args = Record<string, string | boolean>;
const args: Args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const key = a.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) { args[key] = next; i++; } else args[key] = true;
}
const API = String(args.api ?? process.env.API_URL ?? 'http://localhost:3001');
const WS = String(args.ws ?? process.env.WS_URL ?? API.replace(/^http/, 'ws') + '/ws');
const KEY = String(args.key ?? process.env.PLAYER_PRIVATE_KEY ?? '');
if (!/^0x[0-9a-fA-F]{64}$/.test(KEY)) { console.error('need --key 0x<32-byte hex> (or PLAYER_PRIVATE_KEY)'); process.exit(2); }
const BOT = String(args.bot ?? 'balanced');
const POLICY = v3.botPolicy((String(args.policy ?? 'balanced') as v3.BotName));
const USE_REST = args.rest === true;

const account = privateKeyToAccount(KEY as `0x${string}`);
async function auth(): Promise<{ address: string; signature: string; timestamp: string }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await account.signMessage({ message: `Clawbada Auth: ${timestamp}` });
  return { address: account.address, signature, timestamp };
}
async function post(path: string, body: unknown): Promise<any> {
  const a = await auth();
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Wallet-Address': a.address, 'X-Signature': a.signature, 'X-Timestamp': a.timestamp },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const body: Record<string, unknown> = { bot: BOT, opponent: args.opponent ?? 'mirror' };
if (args.team) body.teamId = String(args.team);
else if (args.lobsters) body.lobsterIds = String(args.lobsters).split(',');
else body.preset = String(args.preset ?? `${args.tier ?? 'evolved'}_mix`);

const created = await post('/api/game/combat/practice', body);
const battleId: string = created.battleId;
let snapshot = created.snapshot;
console.log(`practice ${battleId} started: tier=${snapshot.session.tier} bot=${snapshot.session.bot} first=${snapshot.current.lobsterId} (${snapshot.current.controller})`);

// Local mirror of the battle for legality + hash checks: seedless state rebuilt from snapshots.
let local: v3.AtbBattleState = v3.fromWire({ ...snapshot.state, vrfSeed: '0' });
let lastHash: string | null = snapshot.state.log.at(-1)?.postStateHash ?? null;
let turnsPlayed = 0;

const a = await auth();
const ws = new WebSocket(`${WS}?address=${a.address}&signature=${a.signature}&timestamp=${a.timestamp}&battleId=${battleId}`);
const done = new Promise<number>((resolve) => {
  ws.onopen = () => console.log('ws open');
  ws.onerror = (e) => { console.error('ws error', e); resolve(1); };
  ws.onclose = (e) => { console.log(`ws closed ${e.code} ${e.reason}`); };
  ws.onmessage = async (m) => {
    const msg = JSON.parse(String(m.data));
    const d = msg.data;
    switch (msg.event) {
      case 'battle_snapshot':
        snapshot = d; local = v3.fromWire({ ...d.state, vrfSeed: '0' });
        if (d.current.controller?.toLowerCase() === account.address.toLowerCase()) await act(d.current.turn, d.current.lobsterId);
        break;
      case 'turn_started':
        if (d.controller.toLowerCase() === account.address.toLowerCase()) await act(d.turn, d.lobsterId);
        break;
      case 'turn_resolved': {
        turnsPlayed++;
        if (lastHash && d.postStateHash === lastHash) { console.error('postStateHash did not advance'); resolve(1); }
        lastHash = d.postStateHash;
        const r = d.result;
        const dmg = r.damage.map((x: any) => `${x.targetId}-${x.amount}${x.isCrit ? '!' : ''}${x.killed ? '†' : ''}`).join(' ');
        console.log(`t${d.turn} ${r.lobsterId} ${r.skipped ? 'STUN' : r.action}${r.targetId ? '→' + r.targetId : ''}${r.path.length ? ` move(${r.path.length})` : ''} ${dmg} [${d.submittedBy}]`);
        // Re-sync the local mirror from the authoritative HP map (the seedless mirror cannot roll dice).
        for (const [id, h] of Object.entries<any>(d.hp)) { const l = local.lobsters.find((x) => x.id === id)!; l.hp = BigInt(h.hp); l.alive = h.alive; }
        break;
      }
      case 'battle_ended':
        console.log(`battle ended: winner=${d.winner} reason=${d.reason} turns=${turnsPlayed} finalStateHash=${d.finalStateHash} turnLogHash=${d.turnLogHash}`);
        ws.close(); resolve(0);
        break;
      case 'error':
        console.error('server error', d); resolve(1);
        break;
      case 'turn_ack':
      case 'bar_updated':
      case 'pong':
        break;
      default:
        console.log('event', msg.event);
    }
  };
});

async function act(turn: number, lobsterId: string) {
  // Always fetch the authoritative snapshot before acting: positions/charge/statuses may have changed.
  const s = await (await fetch(`${API}/api/game/combat/${battleId}/state`, { headers: await authHeaders() })).json();
  local = v3.fromWire({ ...s.state, vrfSeed: '0' });
  const actor = local.lobsters.find((l) => l.id === lobsterId)!;
  const cmd = POLICY(local, actor);
  if (USE_REST) {
    const res = await post(`/api/game/combat/${battleId}/turn`, { turn, command: cmd });
    if (!res.accepted) { console.error('REST turn rejected', res); }
  } else {
    ws.send(JSON.stringify({ type: 'submit_turn', battleId, turn, command: cmd }));
  }
}
async function authHeaders(): Promise<Record<string, string>> {
  const x = await auth();
  return { 'X-Wallet-Address': x.address, 'X-Signature': x.signature, 'X-Timestamp': x.timestamp };
}

const code = await Promise.race([done, new Promise<number>((r) => setTimeout(() => { console.error('timeout after 10 min'); r(1); }, 600_000))]);
process.exit(code);
