/**
 * Incident drill (audit 2026-09, D-06): a stolen RESOLVER key settles a battle the moment the
 * server starts it, naming a colluding wallet the winner — and the whole honest stack has to
 * notice, refuse to help, get the players to dispute in time, and let the admin put it right.
 *
 * Runs AFTER the assert phase, so the main run's "every operator job succeeded" and its money
 * assertions are untouched: this battle is SUPPOSED to leave a dead settle job behind.
 *
 *   attack   settle(battleId, attacker, fabricated hashes, max damage on the victim) with the
 *            resolver key, while the battle is live on the API and nobody has moved yet
 *   detect   indexer: proposal kept in its own columns, session hashes untouched, alarm
 *            API: settlement_alert to the room; GET /combat/:id says settlement.rogue
 *            engine: the honest settle job finds a result that is not ours -> dead + fatal
 *   react    an agent disputes through POST /combat/:id/dispute, inside the window
 *   contain  past the deadline nothing finalizes
 *   repair   adminResolveDispute with the TRUE result from the honest job's payload: the real
 *            winner is paid, the disputer's bond comes back
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveSeedSecret } from '@clawbada/chain';
import { waitFor } from '../lib/wait';
import { WEI, BattleArenaAbi } from '../lib/chain';
import { KEYS } from '../lib/env';
import type { Checks } from '../lib/checks';
import type { Stack } from './00-infra';
import type { Players } from './10-onboarding';
import type { Flags } from '../run';

const PHASE = { Deposit: 1, TeamCommit: 2, TeamReveal: 3, Active: 4, AwaitingFinalize: 5, Settled: 6 } as const;
const ZERO = '0x0000000000000000000000000000000000000000';
const FAKE_STATE = `0x${'de'.repeat(32)}` as const;
const FAKE_LOG = `0x${'ad'.repeat(32)}` as const;
/** Same value scripts/e2e/lib/env.ts hands the API and the engine. */
const SEED_MASTER = 'e2e-harness-battle-seed-secret-0123456789abcdef';

export async function rogueSettlementDrill(stack: Stack, players: Players, flags: Flags, checks: Checks): Promise<void> {
  const { chain, db, anvil } = stack;
  const { a, b } = players;
  const arena = stack.deployment.contracts.BattleArena;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Stake + bond for a second battle.
  await chain.transferClaw(KEYS.deployer.key, a.agent.address, 10_000n * WEI);
  await chain.transferClaw(KEYS.deployer.key, b.agent.address, 10_000n * WEI);

  // ── an ordinary match, up to the moment the server starts the battle ──
  await a.agent.joinQueue(a.teamId, flags.stake);
  const qb = await b.agent.joinQueue(b.teamId, flags.stake);
  const battleId = qb.battleId ?? (await a.agent.waitMatched());
  const id = BigInt(battleId);
  await waitFor(async () => { const r = await a.agent.battle(battleId); return r.db?.status === 1 && Number(r.chain?.phase) === PHASE.Deposit ? r : null; }, { timeoutMs: 60_000, label: 'drill: createBattle on-chain' });
  await a.agent.deposit(battleId);
  await b.agent.deposit(battleId);
  await waitFor(async () => (await db.sql`select phase from battles where battle_id = ${battleId}`)[0]?.phase === PHASE.TeamCommit, { timeoutMs: 30_000, label: 'drill: indexer mirrors TeamCommit' });
  const ca = await a.agent.commit(battleId);
  const cb = await b.agent.commit(battleId);
  await waitFor(async () => (await db.sql`select phase from battles where battle_id = ${battleId}`)[0]?.phase === PHASE.TeamReveal, { timeoutMs: 30_000, label: 'drill: indexer mirrors TeamReveal' });
  await a.agent.reveal(battleId, ca.teamId, ca.salt);
  await b.agent.reveal(battleId, cb.teamId, cb.salt);
  const active = await waitFor(async () => { const x = await chain.getBattle(id); return Number(x.phase) === PHASE.Active ? x : null; }, { timeoutMs: 30_000, everyMs: 300, label: 'drill: revealTeams mined' });
  await waitFor(async () => (await db.sql`select 1 from battle_sessions where id = ${battleId} and status = 'active'`).length > 0, { timeoutMs: 30_000, label: 'drill: API is running the battle' });
  checks.check(true, `drill battle #${battleId} is live on the server, nobody has moved yet`);

  // ── THE ATTACK ──
  // B is the colluding wallet; A is the victim. Damage arrays are keyed by on-chain slot.
  const attacker = b.agent.address;
  const victimIsSlotA = String(active.playerA).toLowerCase() === a.agent.address.toLowerCase();
  const [dmgA, dmgB] = victimIsSlotA ? [[40, 40, 40], [0, 0, 0]] : [[0, 0, 0], [40, 40, 40]];
  // D-01 means settle() must also disclose the battle's seed secret. It is derived from a master
  // secret that lives in the same engine environment as the resolver key: steal one, steal both.
  const seedSecret = deriveSeedSecret(SEED_MASTER, id);
  await chain.tx(KEYS.deployer.key, arena, BattleArenaAbi, 'settle', [id, attacker, FAKE_STATE, FAKE_LOG, dmgA, dmgB, seedSecret]);
  const rogue = await chain.getBattle(id);
  checks.eq(Number(rogue.phase), PHASE.AwaitingFinalize, 'ATTACK: a rogue settle() landed while the battle is still being played');
  checks.eq(String(rogue.proposedWinner).toLowerCase(), attacker.toLowerCase(), 'ATTACK: the chain now says the colluding wallet won');
  await waitFor(async () => (await db.sql`select phase from battles where battle_id = ${battleId}`)[0]?.phase === PHASE.AwaitingFinalize, { timeoutMs: 30_000, label: 'drill: indexer mirrors the rogue proposal' });

  // The API notices on its next 2 s poll. Real battles last minutes; two bots finish in under two
  // seconds, so wait for the alarm before the agents connect — they are then told on join.
  const logOf = (name: string) => readFileSync(join(stack.runDir, `${name}.log`), 'utf8');
  await waitFor(async () => (logOf('api').includes('rogue_settlement_proposal') ? true : null), { timeoutMs: 30_000, everyMs: 500, label: 'drill: API raises the alarm for the live battle' });
  checks.check(true, 'DETECT: the API saw a result on-chain for a battle it is still running');

  // ── DETECT + REACT: the agents connect, are told at once, and dispute ──
  const [ra, rb] = await Promise.all([a.agent.playBattle(battleId), b.agent.playBattle(battleId)]);
  checks.eq(ra.winner, rb.winner, 'the honest battle was still played to its real end (the evidence)');
  if (!ra.disputed && !rb.disputed) await a.agent.disputeIfRogue(battleId); // the post-battle check every agent should run
  const disputedBattle = await waitFor(async () => { const x = await chain.getBattle(id); return x.disputed ? x : null; }, { timeoutMs: 30_000, label: 'drill: disputeBattle mined' });
  const disputer = String(disputedBattle.disputer).toLowerCase();
  checks.check([a.agent.address.toLowerCase(), b.agent.address.toLowerCase()].includes(disputer), 'REACT: a player disputed through the API inside the window', `${ra.disputed || rb.disputed ? 'on the live settlement_alert' : 'on the post-battle settlement check'}, disputer ${disputer.slice(0, 10)}`);
  checks.check(ra.disputed || rb.disputed, 'REACT: the dispute was triggered by the live settlement_alert, while the battle was still being played');
  checks.eq(BigInt(disputedBattle.disputeBondPaid), 250n * WEI, 'the 250 CLAW bond is escrowed');

  // ── DETECT: every honest service noticed, and none of them helped ──
  const row = (await db.sql`select proposed_winner, proposed_final_state_hash from battles where battle_id = ${battleId}`)[0]!;
  checks.eq(String(row.proposed_winner), attacker.toLowerCase(), 'indexer: the on-chain proposal is recorded in its own columns');
  const sess = await waitFor(async () => { const s = (await db.sql`select status, final_state_hash, turn_log_hash from battle_sessions where id = ${battleId}`)[0]; return s && s.status !== 'active' ? s : null; }, { timeoutMs: 30_000, label: 'drill: session finished' });
  checks.check(String(sess.final_state_hash).toLowerCase() === ra.finalStateHash.toLowerCase() && String(sess.final_state_hash).toLowerCase() !== FAKE_STATE, "indexer: the server's own hashes were NOT overwritten by the fabricated ones", String(sess.final_state_hash).slice(0, 18));

  const job = await waitFor(async () => { const j = (await db.sql`select status, last_error, payload from operator_jobs where idempotency_key = ${'settle_battle:' + battleId}`)[0]; return j && Number(j.status) === 3 ? j : null; }, { timeoutMs: 60_000, label: 'drill: honest settle job goes dead' });
  checks.check(String(job.last_error).startsWith('proposal_mismatch'), 'engine: the honest settle job refused to call this "already settled"', String(job.last_error).slice(0, 60));

  const view = await a.agent.battle(battleId);
  checks.check(view.settlement?.rogue === true && view.settlement?.verdict === 'result_mismatch', 'API: GET /combat/:id flags the settlement as rogue', `${view.settlement?.verdict}`);

  for (const svc of ['api', 'engine', 'indexer']) {
    checks.check(logOf(svc).includes('rogue_settlement_proposal'), `${svc}: raised the rogue_settlement_proposal alarm`);
  }

  // ── CONTAIN: the window closes and nothing pays out ──
  const now = await chain.latestTimestamp();
  await anvil.increaseTime(Number(BigInt(disputedBattle.payoutDeadline) - now) + 30);
  await sleep(12_000); // more than one FinalizeWatcher tick
  checks.eq(Number((await chain.getBattle(id)).phase), PHASE.AwaitingFinalize, 'CONTAIN: past the deadline the rogue result has NOT been paid out');

  // ── REPAIR: the admin resolves with the true result, taken from the honest job's payload ──
  const p = job.payload as { winner: string; finalStateHash: string; turnLogHash: string; damageA: number[]; damageB: number[] };
  const trueWinner = p.winner === 'draw' ? ZERO : p.winner;
  const { receipt } = await chain.tx(KEYS.deployer.key, arena, BattleArenaAbi, 'adminResolveDispute', [id, trueWinner, p.finalStateHash, p.turnLogHash, p.damageA, p.damageB]);
  const resolved = await chain.getBattle(id);
  checks.eq(Number(resolved.phase), PHASE.Settled, 'REPAIR: adminResolveDispute settled the battle');
  checks.eq(String(resolved.winner).toLowerCase(), trueWinner.toLowerCase(), 'REPAIR: the winner on-chain is the one the real battle produced');
  checks.eq(String(resolved.finalStateHash).toLowerCase(), ra.finalStateHash.toLowerCase(), 'REPAIR: the settled hashes are the real battle\'s');
  const refunds = chain.events<{ disputer: string; amount: bigint }>(receipt, BattleArenaAbi, 'DisputeBondRefunded');
  checks.check(refunds.length === 1 && String(refunds[0]!.disputer).toLowerCase() === disputer && BigInt(refunds[0]!.amount) === 250n * WEI, 'REPAIR: the disputer got the 250 CLAW bond back');
  await waitFor(async () => (await db.sql`select phase from battles where battle_id = ${battleId}`)[0]?.phase === PHASE.Settled, { timeoutMs: 30_000, label: 'drill: indexer mirrors Settled' });
}
