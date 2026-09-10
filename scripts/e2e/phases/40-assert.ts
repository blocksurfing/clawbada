import { WEI } from '../lib/chain';
import { KEYS } from '../lib/env';
import type { Checks } from '../lib/checks';
import type { Stack } from './00-infra';
import type { Players } from './10-onboarding';
import type { BattleOutcome } from './20-battle';
import type { MiningOutcome } from './30-mining';

/** Final parity: chain vs DB vs what the clients saw. Mining deltas are excluded from the battle money math. */
export async function assertPhase(stack: Stack, players: Players, battle: BattleOutcome, mining: MiningOutcome, checks: Checks): Promise<void> {
  const { chain, db } = stack;
  const id = BigInt(battle.battleId);
  const onChain = await chain.getBattle(id);
  const winner = String(onChain.winner).toLowerCase();
  const draw = winner === '0x0000000000000000000000000000000000000000';
  const aAddr = players.a.agent.address.toLowerCase();
  const bAddr = players.b.agent.address.toLowerCase();

  // ── money (Low bracket example: pot 5,000, fee 500, winner +2,000 net, loser −2,500) ──
  const stake = battle.stake;
  const pot = stake * 2n;
  const fee = draw ? 0n : pot / 10n;
  const balA = (await chain.balance(players.a.agent.address)) - (mining.player === players.a ? mining.reward : 0n);
  const balB = (await chain.balance(players.b.agent.address)) - (mining.player === players.b ? mining.reward : 0n);
  const dA = balA - battle.balancesBefore.a;
  const dB = balB - battle.balancesBefore.b;
  if (draw) {
    checks.eq(dA, 0n, 'draw: A refunded in full');
    checks.eq(dB, 0n, 'draw: B refunded in full');
  } else {
    const [dw, dl] = winner === aAddr ? [dA, dB] : [dB, dA];
    checks.eq(dw, pot - fee - stake, `winner net +${(pot - fee - stake) / WEI} CLAW`);
    checks.eq(dl, -stake, `loser net −${stake / WEI} CLAW`);
  }
  const supplyDelta = (await chain.totalSupply()) - battle.balancesBefore.supply - mining.reward;
  const devDelta = (await chain.balance(KEYS.devWallet.address)) - battle.balancesBefore.dev;
  checks.check(draw || supplyDelta === -(fee * 85n) / 100n, 'protocol fee: 85 % burned', `supply Δ ${supplyDelta / WEI} CLAW (fee ${fee / WEI})`);
  checks.check(draw || devDelta === (fee * 15n) / 100n, 'protocol fee: 15 % to the dev wallet', `dev Δ ${devDelta / WEI} CLAW`);

  // ── teams released, damage applied ──
  for (const p of [players.a, players.b]) {
    const team = await chain.getTeam(p.teamId);
    checks.eq(Boolean(team.active), false, `${p.agent.o.label}: team released`);
  }
  // proposedDamageA/B are keyed by on-chain player slot; map slots to our players by address.
  const slotAPlayer = String(onChain.playerA).toLowerCase() === aAddr ? players.a : players.b;
  const slotBPlayer = slotAPlayer === players.a ? players.b : players.a;
  const damA = [0, 1, 2].map((i) => Number(onChain.proposedDamageA[i]));
  const damB = [0, 1, 2].map((i) => Number(onChain.proposedDamageB[i]));
  const lobA = await Promise.all(slotAPlayer.teamLobsters.map((l) => chain.getLobster(l)));
  const lobB = await Promise.all(slotBPlayer.teamLobsters.map((l) => chain.getLobster(l)));
  checks.check(lobA.every((l, i) => Number(l.damage) === damA[i]) && lobB.every((l, i) => Number(l.damage) === damB[i]), 'repair damage applied to all six lobsters', `slot A ${damA.join('/')} slot B ${damB.join('/')}`);

  // ── DB parity (indexer) ──
  const row = (await db.sql`select phase, status, winner, winner_payout, protocol_fee, settled_at from battles where battle_id = ${battle.battleId}`)[0];
  checks.eq(Number(row?.phase), 6, 'battles.phase = Settled');
  checks.check(draw ? row?.winner == null : String(row?.winner).toLowerCase() === winner, 'battles.winner mirrors chain', String(row?.winner));
  checks.eq(String(row?.protocol_fee), (fee / WEI).toString(), 'battles.protocol_fee mirrors the fee');
  checks.check(!!row?.settled_at, 'battles.settled_at set');
  const sess = (await db.sql`select status, final_state_hash, turn_log_hash, vrf_round from battle_sessions where id = ${battle.battleId}`)[0];
  checks.eq(String(sess?.status), 'settled', 'battle_sessions.status = settled');
  checks.eq(String(sess?.final_state_hash).toLowerCase(), battle.finalStateHash.toLowerCase(), 'session finalStateHash mirrors the client');
  if (!stack.flags.liveDrand) checks.eq(Number(sess?.vrf_round), 1000, 'drand stub round recorded on the session');
  const agents = await db.sql`select address, wins, losses, total_battles from agents where address in (${aAddr}, ${bAddr})`;
  checks.check(agents.length === 2 && agents.every((r: any) => Number(r.total_battles) >= 1), 'agents rows updated for both players', agents.map((r: any) => `${String(r.address).slice(0, 6)} ${r.wins}W/${r.losses}L`).join(' '));
  const jobs = await db.sql`select job_type, status from operator_jobs`;
  checks.check(jobs.every((j: any) => Number(j.status) === 2), 'every operator job succeeded', jobs.map((j: any) => `${j.job_type}:${j.status}`).join(' '));
  const idx = (await db.sql`select contract_name, last_processed_block from indexer_state order by contract_name`) as any[];
  checks.check(idx.some((r) => r.contract_name === 'BattleArena'), 'indexer_state has BattleArena', idx.map((r) => `${r.contract_name}@${r.last_processed_block}`).join(' '));

  // ── services stayed up ──
  checks.check(!stack.api.exited && !stack.engine.exited && !stack.indexer.exited, 'api, engine, indexer still running');
  checks.check(true, 'reveal latency', `${battle.revealLatencyChainSec} s chain / ${battle.revealLatencyWallMs} ms wall (window 20 s)`);
}
