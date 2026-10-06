import { waitFor } from '../lib/wait';
import { WEI, PHASE } from '../lib/chain';
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

export async function battlePhase(stack: Stack, players: Players, flags: Flags, checks: Checks): Promise<BattleOutcome> {
  const { chain, db, anvil } = stack;
  const { a, b } = players;
  // D-E: the stake is the chain's quote for the bracket — at the launch peg (reference 1,250) the
  // launch amount. The battle binds it at createBattle; everything below reads it from the chain.
  const LAUNCH = [2_500n, 10_000n, 50_000n] as const;
  const quote = await a.agent.stakeQuote();
  const quotedStake = BigInt(quote.brackets[flags.bracket].stakeWei);
  checks.eq(quotedStake, LAUNCH[flags.bracket] * WEI, `D-E quote: ${quote.brackets[flags.bracket].label} bracket quotes its launch amount at the launch peg`);
  checks.eq(BigInt(quote.peg.effectiveReferenceWei), 1_250n * WEI, 'D-E quote: the peg reference is the S1 launch reward');

  const balancesBefore = { a: await chain.balance(a.agent.address), b: await chain.balance(b.agent.address), dev: await chain.balance(KEYS.devWallet.address), supply: await chain.totalSupply() };

  // 1. Queue: A waits, B pairs (same power 3, baseline rating) — synchronous match on join.
  const qa = await a.agent.joinQueue(a.teamId, flags.bracket);
  checks.eq(qa.status, 'queued', 'A queued');
  const qb = await b.agent.joinQueue(b.teamId, flags.bracket);
  const battleId = qb.battleId ?? (await a.agent.waitMatched());
  checks.check(!!battleId, `matched → battle #${battleId}`, qb.status);

  // 2. Engine create_battle → DB status 1, chain phase Deposit.
  await waitFor(async () => { const r = await a.agent.battle(battleId); return r.db?.status === 1 && Number(r.chain?.phase) === PHASE.Deposit ? r : null; }, { timeoutMs: 60_000, label: 'createBattle on-chain (status 1, phase Deposit)' });
  checks.check(true, 'createBattle submitted by the engine (status=1, phase=Deposit)');
  const created = await chain.getBattle(BigInt(battleId));
  const stake = BigInt(created.stakeAmount);
  checks.eq(Number(created.bracket), flags.bracket, 'D-E: the chain bound the bracket queued for');
  checks.eq(stake, quotedStake, 'D-E: the chain bound the quoted amount');
  const dbRow = await a.agent.battle(battleId);
  checks.eq(String(dbRow.db?.stakeAmount), (stake / WEI).toString(), 'D-E: the battles row carries the bound amount (display units)');

  // 3. Deposits: approve + deposit(battleId, expectedStake, maxOpponentPower, commitHash). The
  //    commit rides in the deposit (D-13) and the consent is bound on-chain (D-08). A also hands
  //    the server its salt with the deposit; B sends only the hash and reveals separately, so both
  //    reveal paths are exercised.
  const ca = await a.agent.deposit(battleId);
  checks.eq(BigInt(ca.consent.expectedStake), stake, 'deposit consent: the stake of the queued bracket');
  const cb = await b.agent.deposit(battleId, { prepareReveal: false });
  const afterDeposit = await chain.getBattle(BigInt(battleId));
  checks.eq(Number(afterDeposit.phase), PHASE.TeamReveal, 'both deposits (each carrying its commit) → phase TeamReveal');
  checks.check(BigInt(afterDeposit.teamCommitA) !== 0n && BigInt(afterDeposit.teamCommitB) !== 0n, 'both team commits recorded by the deposits');
  const t0Chain = await chain.latestTimestamp();
  const t0Wall = Date.now();

  // 4. Reveal: A's salt is already server-side; B posts its salt; the engine's RevealWatcher
  //    checks both against the commits on-chain and submits the atomic revealTeams.
  await waitFor(async () => (await db.sql`select phase from battles where battle_id = ${battleId}`)[0]?.phase >= PHASE.TeamReveal, { timeoutMs: 30_000, label: 'indexer mirrors TeamReveal' });
  const rb = await b.agent.reveal(battleId, cb.teamId, cb.salt).catch((err) => `error: ${String(err).slice(0, 120)}`);
  checks.check(rb === 'both_revealed' || rb === 'waiting_for_opponent' || rb.includes('not in the team-reveal phase'), 'B posted its salt', rb);
  const active = await waitFor(async () => { const x = await chain.getBattle(BigInt(battleId)); return Number(x.phase) === PHASE.Active ? x : null; }, { timeoutMs: 30_000, everyMs: 300, label: 'revealTeams mined (phase Active)' });
  const t1Chain = await chain.latestTimestamp();
  const revealLatencyChainSec = Number(t1Chain - t0Chain);
  const revealLatencyWallMs = Date.now() - t0Wall;
  checks.check(revealLatencyChainSec < 60, `reveal landed inside the 60 s window`, `${revealLatencyChainSec} s chain / ${revealLatencyWallMs} ms wall`);
  checks.check(!active.accusedA && !active.accusedB, 'nobody was reported for an unopenable commit');
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

  // 7. settle_battle job → chain phase AwaitingFinalize ("in review"). Damage is applied and both
  //    teams are released at settle: the lobsters are free before any money moves.
  const proposed = await waitFor(async () => { const x = await chain.getBattle(BigInt(battleId)); return Number(x.phase) === PHASE.AwaitingFinalize ? x : null; }, { timeoutMs: 60_000, label: 'settle() mined (AwaitingFinalize)' });
  checks.check(true, 'settle submitted by the engine', `payoutDeadline ${proposed.payoutDeadline}`);
  checks.eq(String(proposed.finalStateHash).toLowerCase(), ra.finalStateHash.toLowerCase(), 'on-chain finalStateHash matches the session');
  const loserSlot = ra.winner === 'draw' ? null : (ra.winner === 'A') === aIsSlotA ? 'B' : 'A';
  checks.check(ra.reason !== 'forfeit' || String(proposed.proposedForfeiter).toLowerCase() !== '0x0000000000000000000000000000000000000000', 'a forfeit names its forfeiter on-chain', `${ra.reason}, loser slot ${loserSlot}`);
  checks.check(!(await chain.teamInBattle(a.teamId)) && !(await chain.teamInBattle(b.teamId)), 'both teams released at settle — no lobster waits for the payout');
  checks.check(!(await chain.getTeam(a.teamId)).active && !(await chain.getTeam(b.teamId)).active, 'TeamManager shows both teams inactive while the result is in review');
  await waitFor(async () => (await db.sql`select phase from battles where battle_id = ${battleId}`)[0]?.phase === PHASE.AwaitingFinalize, { timeoutMs: 30_000, label: 'indexer mirrors AwaitingFinalize' });

  // 8. The watchdog replays the battle during the review window and finds it clean: nothing is
  //    frozen. Wait a few of its ticks inside the window, then warp past it; it pays out.
  await new Promise((r) => setTimeout(r, 3_000));
  checks.eq(Number((await chain.getBattle(BigInt(battleId))).phase), PHASE.AwaitingFinalize, 'the watchdog did not freeze an honest result');
  const now = await chain.latestTimestamp();
  const ahead = Number(BigInt(proposed.payoutDeadline) - now) + 5;
  await anvil.increaseTime(Math.max(ahead, 1));
  await waitFor(async () => { const x = await chain.getBattle(BigInt(battleId)); return Number(x.phase) === PHASE.Settled ? x : null; }, { timeoutMs: 60_000, label: 'finalizeBattle mined (Settled)' });
  checks.check(true, 'finalizeBattle submitted by the engine after the review window');
  await waitFor(async () => (await db.sql`select phase from battles where battle_id = ${battleId}`)[0]?.phase === PHASE.Settled, { timeoutMs: 30_000, label: 'indexer mirrors Settled' });

  return { battleId, stake, ...ra, balancesBefore, revealLatencyChainSec, revealLatencyWallMs, payoutDeadline: BigInt(proposed.payoutDeadline) };
}
