import { waitFor } from '../lib/wait';
import { WEI } from '../lib/chain';
import { KEYS } from '../lib/env';
import type { Checks } from '../lib/checks';
import type { Stack } from './00-infra';
import type { Players } from './10-onboarding';
import type { Flags } from '../run';

export interface BattleOutcome {
  battleId: string; stake: bigint;
  winner: string; reason: string; finalStateHash: string; turnLogHash: string; turns: number;
  balancesBefore: { a: bigint; b: bigint; dev: bigint; supply: bigint };
  revealLatencyChainSec: number; revealLatencyWallMs: number;
  payoutDeadline: bigint;
}

const PHASE = { Deposit: 1, TeamCommit: 2, TeamReveal: 3, Active: 4, AwaitingFinalize: 5, Settled: 6 } as const;

export async function battlePhase(stack: Stack, players: Players, flags: Flags, checks: Checks): Promise<BattleOutcome> {
  const { chain, db, anvil } = stack;
  const { a, b } = players;
  const stake = BigInt(flags.stake) * WEI;

  const balancesBefore = { a: await chain.balance(a.agent.address), b: await chain.balance(b.agent.address), dev: await chain.balance(KEYS.devWallet.address), supply: await chain.totalSupply() };

  // 1. Queue: A waits, B pairs (same power 3, baseline rating) — synchronous match on join.
  const qa = await a.agent.joinQueue(a.teamId, flags.stake);
  checks.eq(qa.status, 'queued', 'A queued');
  const qb = await b.agent.joinQueue(b.teamId, flags.stake);
  const battleId = qb.battleId ?? (await a.agent.waitMatched());
  checks.check(!!battleId, `matched → battle #${battleId}`, qb.status);

  // 2. Engine create_battle → DB status 1, chain phase Deposit.
  await waitFor(async () => { const r = await a.agent.battle(battleId); return r.db?.status === 1 && Number(r.chain?.phase) === PHASE.Deposit ? r : null; }, { timeoutMs: 60_000, label: 'createBattle on-chain (status 1, phase Deposit)' });
  checks.check(true, 'createBattle submitted by the engine (status=1, phase=Deposit)');

  // 3. Deposits (approve + deposit, both players).
  await a.agent.deposit(battleId);
  await b.agent.deposit(battleId);
  const afterDeposit = await chain.getBattle(BigInt(battleId));
  checks.eq(Number(afterDeposit.phase), PHASE.TeamCommit, 'both deposits → phase TeamCommit');
  await waitFor(async () => (await db.sql`select phase from battles where battle_id = ${battleId}`)[0]?.phase === PHASE.TeamCommit, { timeoutMs: 30_000, label: 'indexer mirrors TeamCommit' });

  // 4. Commits (client-side salt + hash; one tx each).
  const ca = await a.agent.commit(battleId);
  const cb = await b.agent.commit(battleId);
  const afterCommit = await chain.getBattle(BigInt(battleId));
  checks.eq(Number(afterCommit.phase), PHASE.TeamReveal, 'both commits → phase TeamReveal');
  const t0Chain = await chain.latestTimestamp();
  const t0Wall = Date.now();

  // 5. Reveal: salts to the API; the engine's RevealWatcher submits the atomic revealTeams.
  await waitFor(async () => (await db.sql`select phase from battles where battle_id = ${battleId}`)[0]?.phase === PHASE.TeamReveal, { timeoutMs: 30_000, label: 'indexer mirrors TeamReveal' });
  await a.agent.reveal(battleId, ca.teamId, ca.salt);
  const rb = await b.agent.reveal(battleId, cb.teamId, cb.salt);
  checks.eq(rb, 'both_revealed', 'second reveal reports both_revealed');
  const active = await waitFor(async () => { const x = await chain.getBattle(BigInt(battleId)); return Number(x.phase) === PHASE.Active ? x : null; }, { timeoutMs: 30_000, everyMs: 300, label: 'revealTeams mined (phase Active)' });
  const t1Chain = await chain.latestTimestamp();
  const revealLatencyChainSec = Number(t1Chain - t0Chain);
  const revealLatencyWallMs = Date.now() - t0Wall;
  checks.check(revealLatencyChainSec < 20, `reveal landed inside the 20 s window`, `${revealLatencyChainSec} s chain / ${revealLatencyWallMs} ms wall`);
  // The matchmaker decides who is on-chain player A (the seeker pairs with the oldest queued
  // row), so map by address rather than assuming our A is slot A.
  const aIsSlotA = String(active.playerA).toLowerCase() === a.agent.address.toLowerCase();
  const [slotATeam, slotBTeam] = aIsSlotA ? [a.teamId, b.teamId] : [b.teamId, a.teamId];
  checks.eq(BigInt(active.teamIdA), slotATeam, `teamIdA bound on-chain (${aIsSlotA ? 'A' : 'B'} is slot A)`);
  checks.eq(BigInt(active.teamIdB), slotBTeam, 'teamIdB bound on-chain');

  // 6. Live session: indexer → phase 4, API claims a session, both agents play.
  await waitFor(async () => (await db.sql`select 1 from battle_sessions where id = ${battleId}`).length > 0, { timeoutMs: 30_000, label: 'API claims the battle session' });
  checks.check(true, 'battle session started');
  const [ra, rbb] = await Promise.all([a.agent.playBattle(battleId), b.agent.playBattle(battleId)]);
  checks.eq(ra.winner, rbb.winner, 'both clients saw the same winner');
  checks.check(!!ra.finalStateHash && ra.finalStateHash === rbb.finalStateHash, 'final state hash agreed', ra.finalStateHash.slice(0, 18));
  console.log(`battle #${battleId}: winner ${ra.winner} by ${ra.reason} after ${ra.turns} turns`);

  // 7. settle_battle job → chain phase AwaitingFinalize.
  const proposed = await waitFor(async () => { const x = await chain.getBattle(BigInt(battleId)); return Number(x.phase) === PHASE.AwaitingFinalize ? x : null; }, { timeoutMs: 60_000, label: 'settle() mined (AwaitingFinalize)' });
  checks.check(true, 'settle submitted by the engine', `payoutDeadline ${proposed.payoutDeadline}`);
  checks.eq(String(proposed.finalStateHash).toLowerCase(), ra.finalStateHash.toLowerCase(), 'on-chain finalStateHash matches the session');
  await waitFor(async () => (await db.sql`select phase from battles where battle_id = ${battleId}`)[0]?.phase === PHASE.AwaitingFinalize, { timeoutMs: 30_000, label: 'indexer mirrors AwaitingFinalize' });

  // 8. Warp past the dispute window; the FinalizeWatcher pays out.
  const now = await chain.latestTimestamp();
  const ahead = Number(BigInt(proposed.payoutDeadline) - now) + 5;
  await anvil.increaseTime(Math.max(ahead, 1));
  await waitFor(async () => { const x = await chain.getBattle(BigInt(battleId)); return Number(x.phase) === PHASE.Settled ? x : null; }, { timeoutMs: 60_000, label: 'finalizeBattle mined (Settled)' });
  checks.check(true, 'finalizeBattle submitted by the engine after the dispute window');
  await waitFor(async () => (await db.sql`select phase from battles where battle_id = ${battleId}`)[0]?.phase === PHASE.Settled, { timeoutMs: 30_000, label: 'indexer mirrors Settled' });

  return { battleId, stake, ...ra, balancesBefore, revealLatencyChainSec, revealLatencyWallMs, payoutDeadline: BigInt(proposed.payoutDeadline) };
}
