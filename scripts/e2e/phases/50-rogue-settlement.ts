/**
 * FREEZE DRILL (owner decision 2026-10-01: player disputes removed). A stolen RESOLVER key settles
 * battles the moment the server starts them; the engine's WATCHDOG has to notice during the
 * review window and FREEZE each result with the guardian key, and the frozen battle then ends one
 * of three ways. Also covers a draw's fee, the boost not counting draws, and the deposit consent.
 *
 * Runs AFTER the assert phase, so the main run's "every operator job succeeded" and its money
 * assertions are untouched: these battles are SUPPOSED to leave dead settle jobs behind.
 *
 *   1. resolve  rogue DRAW settled mid-battle → no boost credit for it → watchdog freezes (guardian
 *               key) → past the review window nothing pays → the Safe resolveFrozen()s the TRUE
 *               result from the honest job's payload
 *   2. expire   rogue win → frozen → nobody acts → warp 72 h → expireFrozen burns 2·stake and pays
 *               both players back from the refund reserve (+ a ConsentMismatch deposit revert)
 *   3. drained  the Safe withdraws the reserve → rogue win → frozen → 72 h → expire returns the held
 *               stakes, nothing is burned
 *   4. draw     rogue draw → frozen → the Safe resolves it AS a draw: each side pays 10% of its own
 *               stake (the normal fee in total); the indexer mirrors the fee; never counted played.
 *               Run with the guardian's role REVOKED first: the freeze fails LOUDLY
 *               (`battle_freeze_failed`, M3) every tick until the Safe restores the role, then lands
 *   5. unplayable a player deposits a commit to a team that can no longer play (disbanded after the
 *               deposit) → the resolver's dry run of revealTeams names that team → that side is
 *               accused at once (D-A) → never opens → the WATCHDOG sweeps the lapsed reveal
 *               (`handleTimeout`, L3): ForfeitB, the 5% anti-grief slashed, the opponent refunded
 *
 * ASSUMED from the deploy scripts (another change): Configure grants BattleArena.GUARDIAN_ROLE to
 * GUARDIAN_ADDRESS (anvil key 4 here) and funds the refund reserve on a test chain; the deployer
 * holds DEFAULT_ADMIN_ROLE on the local chain (it plays "the Safe"). The drill tops the reserve up
 * itself (fundReserve is permissionless) and grants the guardian role if Configure did not, with a
 * check that says so.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hex } from 'viem';
import { deriveSeedSecret } from '@clawbada/chain';
import { waitFor } from '../lib/wait';
import { WEI, PHASE, FREEZE_LONG_STOP_SEC, BattleArenaAbi, GoldTokenAbi, TeamManagerAbi, PauseSwitchAbi } from '../lib/chain';
import { KEYS } from '../lib/env';
import type { Checks } from '../lib/checks';
import type { Stack } from './00-infra';
import type { Players } from './10-onboarding';
import type { Flags } from '../run';

const ZERO = '0x0000000000000000000000000000000000000000';
const FAKE_STATE = `0x${'de'.repeat(32)}` as const;
const FAKE_LOG = `0x${'ad'.repeat(32)}` as const;
/** Same value scripts/e2e/lib/env.ts hands the API and the engine. */
const SEED_MASTER = 'e2e-harness-battle-seed-secret-0123456789abcdef';

export async function rogueSettlementDrill(stack: Stack, players: Players, flags: Flags, checks: Checks): Promise<void> {
  const { chain, db, anvil } = stack;
  const { a, b } = players;
  const arena = stack.deployment.contracts.BattleArena;
  // D-E: the bracket's current quote; every battle below is checked to have bound exactly this.
  const stake = BigInt((await a.agent.stakeQuote()).brackets[flags.bracket].stakeWei);
  const antiGrief = stake / 20n;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const logOf = (name: string) => readFileSync(join(stack.runDir, `${name}.log`), 'utf8');
  const dbPhase = async (battleId: string) => Number((await db.sql`select phase from battles where battle_id = ${battleId}`)[0]?.phase);
  const participation = async (battleId: string) => Number((await db.sql`select count(*)::int as n from battle_participation where battle_id = ${battleId}`)[0]?.n ?? 0);

  // Four more battles' stakes for both players.
  await chain.transferGold(KEYS.deployer.key, a.agent.address, 4n * (stake + antiGrief) + 1_000n * WEI);
  await chain.transferGold(KEYS.deployer.key, b.agent.address, 4n * (stake + antiGrief) + 1_000n * WEI);

  // ── the guardian key the watchdog freezes with ──
  const guardianRole = await chain.read<Hex>(arena, BattleArenaAbi, 'GUARDIAN_ROLE');
  const guardianHasRole = await chain.read<boolean>(arena, BattleArenaAbi, 'hasRole', [guardianRole, KEYS.guardian.address]);
  checks.check(guardianHasRole, 'Configure granted GUARDIAN_ROLE to GUARDIAN_ADDRESS', KEYS.guardian.address);
  if (!guardianHasRole) await chain.tx(KEYS.deployer.key, arena, BattleArenaAbi, 'grantRole', [guardianRole, KEYS.guardian.address]);

  // ── PAUSE-I1: the same guardian key can stop every money-in entry point; only the admin (the
  //    deployer here, the Safe on mainnet) reopens. Exercised on the matchmaker's own call. ──
  const pauseSwitch = stack.deployment.contracts.PauseSwitch;
  await chain.tx(KEYS.guardian.key, pauseSwitch, PauseSwitchAbi, 'pause');
  checks.check(await chain.read<boolean>(pauseSwitch, PauseSwitchAbi, 'paused'), 'PAUSE: the guardian key paused the protocol');
  const pausedCreate = await chain.pub.simulateContract({ address: arena, abi: BattleArenaAbi as any, functionName: 'createBattle', args: [a.agent.address, b.agent.address, flags.bracket, 3, 3], account: KEYS.deployer.address as Hex })
    .then(() => 'no revert', (e: any) => {
      // The custom error's name sits on the ContractFunctionRevertedError down the cause chain.
      for (let x = e, depth = 0; x && depth < 8; x = x.cause, depth++) {
        if (x.data?.errorName) return String(x.data.errorName);
        if (typeof x.signature === 'string') return `undecoded ${x.signature}`;
      }
      return String(e?.shortMessage ?? e?.message ?? e).slice(0, 200);
    });
  checks.check(pausedCreate === 'ProtocolPaused', 'PAUSE: createBattle reverts ProtocolPaused while paused', pausedCreate);
  await chain.tx(KEYS.deployer.key, pauseSwitch, PauseSwitchAbi, 'unpause');
  checks.check(!(await chain.read<boolean>(pauseSwitch, PauseSwitchAbi, 'paused')), 'PAUSE: the admin reopened the protocol');

  /** Match → deposits (each carrying its commit) → revealed → the API is running the session. */
  async function liveBattle(label: string, beforeDeposit?: (battleId: string) => Promise<void>) {
    await a.agent.joinQueue(a.teamId, flags.bracket);
    const qb = await b.agent.joinQueue(b.teamId, flags.bracket);
    const battleId = qb.battleId ?? (await a.agent.waitMatched());
    const id = BigInt(battleId);
    await waitFor(async () => { const r = await a.agent.battle(battleId); return r.db?.status === 1 && Number(r.chain?.phase) === PHASE.Deposit ? r : null; }, { timeoutMs: 60_000, label: `${label}: createBattle on-chain` });
    checks.eq(BigInt((await chain.getBattle(id)).stakeAmount), stake, `${label}: the chain bound the bracket's quoted stake`);
    if (beforeDeposit) await beforeDeposit(battleId);
    await a.agent.deposit(battleId);
    await b.agent.deposit(battleId);
    const active = await waitFor(async () => { const x = await chain.getBattle(id); return Number(x.phase) === PHASE.Active ? x : null; }, { timeoutMs: 40_000, everyMs: 300, label: `${label}: revealTeams mined` });
    await waitFor(async () => (await db.sql`select 1 from battle_sessions where id = ${battleId} and status = 'active'`).length > 0, { timeoutMs: 30_000, label: `${label}: API is running the battle` });
    return { battleId, id, active };
  }

  /** THE ATTACK: settle() with the resolver key while the battle is live and nobody has moved. */
  async function rogueSettle(id: bigint, winner: string, active: any) {
    // Small damage: settle applies it immediately now, and these lobsters keep battling.
    const victimIsSlotA = String(active.playerA).toLowerCase() === a.agent.address.toLowerCase();
    const dmg = winner === ZERO ? [[0, 0, 0], [0, 0, 0]] : victimIsSlotA ? [[5, 5, 5], [0, 0, 0]] : [[0, 0, 0], [5, 5, 5]];
    // D-01: settle() must also disclose the seed secret; it lives next to the resolver key.
    await chain.tx(KEYS.deployer.key, arena, BattleArenaAbi, 'settle', [id, winner, FAKE_STATE, FAKE_LOG, dmg[0], dmg[1], deriveSeedSecret(SEED_MASTER, id), ZERO]);
  }

  /** The watchdog freezes it inside the review window, with the GUARDIAN key. */
  async function awaitFrozen(label: string, id: bigint) {
    const fromBlock = await chain.pub.getBlockNumber();
    const frozen = await waitFor(async () => { const x = await chain.getBattle(id); return Number(x.phase) === PHASE.Frozen ? x : null; }, { timeoutMs: 30_000, label: `${label}: watchdog freezes the result` });
    const evs = await chain.pub.getContractEvents({ address: arena, abi: BattleArenaAbi as any, eventName: 'BattleFrozen', args: { battleId: id }, fromBlock: fromBlock > 50n ? fromBlock - 50n : 0n });
    const by = String((evs.at(-1) as any)?.args?.by ?? '').toLowerCase();
    checks.eq(by, KEYS.guardian.address.toLowerCase(), `${label}: frozen by the GUARDIAN key (not the resolver / operator)`);
    checks.check(BigInt(frozen.frozenAt) <= BigInt(frozen.payoutDeadline), `${label}: frozen inside the review window`);
    await waitFor(async () => ((await dbPhase(String(id))) === PHASE.Frozen ? true : null), { timeoutMs: 30_000, label: `${label}: indexer mirrors Frozen` });
    return frozen;
  }

  /** Play the honest battle to its end (the session the Safe reviews), then read the dead job. */
  async function playAndReadHonestJob(label: string, battleId: string) {
    const [ra, rb] = await Promise.all([a.agent.playBattle(battleId), b.agent.playBattle(battleId)]);
    checks.eq(ra.winner, rb.winner, `${label}: the honest battle was still played to its real end`);
    const job = await waitFor(async () => { const j = (await db.sql`select status, last_error, payload from operator_jobs where idempotency_key = ${'settle_battle:' + battleId}`)[0]; return j && Number(j.status) === 3 ? j : null; }, { timeoutMs: 60_000, label: `${label}: honest settle job goes dead` });
    checks.check(String(job.last_error).startsWith('proposal_mismatch'), `${label}: the honest settle job refuses to call this "already settled"`, String(job.last_error).slice(0, 60));
    return { ra, rb, job: job.payload as { winner: string; finalStateHash: string; turnLogHash: string; forfeiter?: string | null } };
  }

  // ═══ 1. rogue DRAW → frozen → the Safe resolves the true result ═══
  {
    const L = 'resolve';
    const { battleId, id, active } = await liveBattle(L);
    await rogueSettle(id, ZERO, active);
    checks.eq(Number((await chain.getBattle(id)).phase), PHASE.AwaitingFinalize, `${L}: ATTACK — a rogue draw was settled while the battle is being played`);
    checks.check(!(await chain.teamInBattle(a.teamId)) && !(await chain.teamInBattle(b.teamId)), `${L}: the teams are free at settle, whatever the result`);
    await waitFor(async () => ((await dbPhase(battleId)) >= PHASE.AwaitingFinalize ? true : null), { timeoutMs: 30_000, label: `${L}: indexer mirrors the proposal` });
    checks.eq(await participation(battleId), 0, `${L}: a draw is NOT counted as a played battle for the boost`);
    const frozen = await awaitFrozen(L, id);
    await waitFor(async () => (logOf('engine').includes('"msg":"battle_frozen"') ? true : null), { timeoutMs: 10_000, everyMs: 500, label: `${L}: engine logs battle_frozen` });
    checks.check(true, `${L}: engine raised battle_frozen`);
    // Two bots finish in seconds: let the API's alarm stand before they connect (told on join).
    await waitFor(async () => (logOf('api').includes('rogue_settlement_proposal') ? true : null), { timeoutMs: 30_000, everyMs: 500, label: `${L}: API raises the alarm for the live battle` });

    const { ra, job } = await playAndReadHonestJob(L, battleId);
    checks.check(ra.alerted, `${L}: the players were told (informational settlement_alert, no action asked)`);
    const view = await a.agent.settlementStatus(battleId);
    checks.check(view?.status === 'frozen_for_review' && view?.rogue === true, `${L}: GET /combat/:id says frozen_for_review`, `${view?.status} ${view?.verdict}`);

    // CONTAIN: past the review window nothing can pay the frozen result.
    const now = await chain.latestTimestamp();
    await anvil.increaseTime(Number(BigInt(frozen.payoutDeadline) - now) + 30);
    await sleep(6_000); // a few watchdog ticks
    checks.eq(Number((await chain.getBattle(id)).phase), PHASE.Frozen, `${L}: CONTAIN — past the window the frozen result has not paid out`);

    // REPAIR: the Safe pays the TRUE result, taken from the honest job's payload.
    const trueWinner = job.winner === 'draw' ? ZERO : job.winner;
    await chain.tx(KEYS.deployer.key, arena, BattleArenaAbi, 'resolveFrozen', [id, trueWinner, job.forfeiter ?? ZERO, false]);
    const resolved = await chain.getBattle(id);
    checks.eq(Number(resolved.phase), PHASE.Settled, `${L}: REPAIR — resolveFrozen settled the battle`);
    checks.eq(String(resolved.winner).toLowerCase(), trueWinner.toLowerCase(), `${L}: REPAIR — the winner paid is the one the real battle produced`);
    await waitFor(async () => ((await dbPhase(battleId)) === PHASE.Settled ? true : null), { timeoutMs: 30_000, label: `${L}: indexer mirrors Settled` });
    for (const svc of ['api', 'engine', 'indexer']) {
      checks.check(logOf(svc).includes('rogue_settlement_proposal') || logOf(svc).includes('battle_frozen'), `${svc}: raised an alarm`);
    }
  }

  // Reserve: make sure it can cover one expiry (Configure funds it on a test chain; top up if not).
  const needed = 2n * stake;
  const reserve0 = await chain.refundReserve();
  checks.check(reserve0 >= needed, 'refund reserve funded by Configure', `${reserve0 / WEI} GOLD`);
  if (reserve0 < needed) {
    await chain.tx(KEYS.deployer.key, chain.gold, GoldTokenAbi, 'approve', [arena, needed - reserve0]);
    await chain.tx(KEYS.deployer.key, arena, BattleArenaAbi, 'fundReserve', [needed - reserve0]);
  }

  // ═══ 2. rogue win → frozen → nobody acts → 72 h → expire: burn + pay from the reserve ═══
  {
    const L = 'expire';
    const { battleId, id, active } = await liveBattle(L, async (bid) => {
      // D-08 consent, on-chain: a deposit that agrees to a different stake, or to a weaker
      // opponent than the one matched, reverts — whatever calldata a client is handed.
      const tryDeposit = (expectedStake: bigint, maxOpponentPower: number) =>
        chain.pub.simulateContract({ address: arena, abi: BattleArenaAbi as any, functionName: 'deposit', args: [BigInt(bid), expectedStake, maxOpponentPower, `0x${'11'.repeat(32)}`], account: a.agent.address as Hex })
          .then(() => 'ok', (e: unknown) => String((e as Error)?.message ?? e));
      const wrongStake = await tryDeposit(stake + 1n, 9);
      checks.check(wrongStake.includes('ConsentMismatch'), `${L}: a deposit consenting to another stake reverts ConsentMismatch`, wrongStake.slice(0, 80));
      const tooWeak = await tryDeposit(stake, 2);
      checks.check(tooWeak.includes('ConsentMismatch'), `${L}: a deposit accepting only a weaker opponent reverts ConsentMismatch`, tooWeak.slice(0, 80));
    });
    await rogueSettle(id, b.agent.address, active);
    const frozen = await awaitFrozen(L, id);
    await playAndReadHonestJob(L, battleId);

    const before = { a: await chain.balance(a.agent.address), b: await chain.balance(b.agent.address), supply: await chain.totalSupply(), reserve: await chain.refundReserve() };
    const now = await chain.latestTimestamp();
    await anvil.increaseTime(Number(BigInt(frozen.frozenAt) + BigInt(FREEZE_LONG_STOP_SEC) - now) + 60);
    const settled = await waitFor(async () => { const x = await chain.getBattle(id); return Number(x.phase) === PHASE.Settled ? x : null; }, { timeoutMs: 60_000, label: `${L}: the watchdog expires the frozen battle` });
    checks.eq(String(settled.winner).toLowerCase(), ZERO, `${L}: an expired battle has no winner`);
    const after = { a: await chain.balance(a.agent.address), b: await chain.balance(b.agent.address), supply: await chain.totalSupply(), reserve: await chain.refundReserve() };
    checks.eq(before.supply - after.supply, 2n * stake, `${L}: the held stakes (2·stake) were BURNED`);
    checks.eq(before.reserve - after.reserve, 2n * stake, `${L}: the players were paid back from the refund reserve`);
    checks.eq(after.a - before.a, stake + antiGrief, `${L}: player A got stake + anti-grief back`);
    checks.eq(after.b - before.b, stake + antiGrief, `${L}: player B got stake + anti-grief back`);
    checks.check(logOf('engine').includes('frozen_battle_expired'), `${L}: engine logged frozen_battle_expired`);
    await waitFor(async () => ((await dbPhase(battleId)) === PHASE.Settled ? true : null), { timeoutMs: 30_000, label: `${L}: indexer mirrors Settled` });
  }

  // ═══ 3. the Safe drains the reserve → expire returns the held stakes, nothing burned ═══
  {
    const L = 'drained';
    const reserve = await chain.refundReserve();
    if (reserve > 0n) await chain.tx(KEYS.deployer.key, arena, BattleArenaAbi, 'withdrawReserve', [KEYS.deployer.address, reserve]);
    checks.eq(await chain.refundReserve(), 0n, `${L}: the Safe withdrew the whole reserve`);
    const { battleId, id, active } = await liveBattle(L);
    await rogueSettle(id, b.agent.address, active);
    const frozen = await awaitFrozen(L, id);
    await playAndReadHonestJob(L, battleId);
    const before = { a: await chain.balance(a.agent.address), b: await chain.balance(b.agent.address), supply: await chain.totalSupply() };
    const now = await chain.latestTimestamp();
    await anvil.increaseTime(Number(BigInt(frozen.frozenAt) + BigInt(FREEZE_LONG_STOP_SEC) - now) + 60);
    await waitFor(async () => { const x = await chain.getBattle(id); return Number(x.phase) === PHASE.Settled ? x : null; }, { timeoutMs: 60_000, label: `${L}: the watchdog expires the frozen battle` });
    const after = { a: await chain.balance(a.agent.address), b: await chain.balance(b.agent.address), supply: await chain.totalSupply() };
    checks.eq(after.supply, before.supply, `${L}: reserve short — nothing burned`);
    checks.eq(after.a - before.a, stake + antiGrief, `${L}: player A got the held stake + anti-grief back`);
    checks.eq(after.b - before.b, stake + antiGrief, `${L}: player B got the held stake + anti-grief back`);
    await waitFor(async () => ((await dbPhase(battleId)) === PHASE.Settled ? true : null), { timeoutMs: 30_000, label: `${L}: indexer mirrors Settled` });
  }

  // ═══ 4. a draw's fee: each side pays half the normal fee; never counted for the boost ═══
  {
    const L = 'draw';
    const { battleId, id, active } = await liveBattle(L);
    // M3 (review 2026-10-03): with the guardian's role gone, the watchdog must NOT fail silently.
    await chain.tx(KEYS.deployer.key, arena, BattleArenaAbi, 'revokeRole', [guardianRole, KEYS.guardian.address]);
    const failedBefore = logOf('engine').split('battle_freeze_failed').length - 1;
    await rogueSettle(id, ZERO, active);
    await waitFor(async () => (logOf('engine').split('battle_freeze_failed').length - 1 > failedBefore ? true : null), { timeoutMs: 20_000, everyMs: 500, label: `${L}: engine raises battle_freeze_failed (guardian role revoked)` });
    checks.check(true, `${L}: freeze failed LOUDLY while the guardian had no role (battle_freeze_failed)`);
    checks.eq(Number((await chain.getBattle(id)).phase), PHASE.AwaitingFinalize, `${L}: the rogue result is still in review, not frozen, while the guardian cannot act`);
    await chain.tx(KEYS.deployer.key, arena, BattleArenaAbi, 'grantRole', [guardianRole, KEYS.guardian.address]);
    await awaitFrozen(L, id); // the next tick retries and lands
    checks.check(true, `${L}: the freeze landed on the first tick after the Safe restored the role`);
    await playAndReadHonestJob(L, battleId);
    const before = { a: await chain.balance(a.agent.address), b: await chain.balance(b.agent.address) };
    const { receipt } = await chain.tx(KEYS.deployer.key, arena, BattleArenaAbi, 'resolveFrozen', [id, ZERO, ZERO, false]);
    const ev = chain.events<{ winner: string; protocolFee: bigint }>(receipt, BattleArenaAbi, 'BattleSettled')[0];
    const sideFee = stake / 10n;
    checks.eq(BigInt(ev.protocolFee), 2n * sideFee, `${L}: total fee = 10% of each stake (the normal fee for one pot)`);
    checks.eq((await chain.balance(a.agent.address)) - before.a, stake - sideFee + antiGrief, `${L}: player A gets stake − 10% + anti-grief`);
    checks.eq((await chain.balance(b.agent.address)) - before.b, stake - sideFee + antiGrief, `${L}: player B gets stake − 10% + anti-grief`);
    const row = await waitFor(async () => { const r = (await db.sql`select phase, winner, protocol_fee from battles where battle_id = ${battleId}`)[0]; return r && Number(r.phase) === PHASE.Settled ? r : null; }, { timeoutMs: 30_000, label: `${L}: indexer mirrors Settled` });
    checks.eq(String(row.protocol_fee), ((2n * sideFee) / WEI).toString(), `${L}: indexer mirrors the draw fee`);
    checks.check(row.winner == null, `${L}: no winner recorded`);
    checks.eq(await participation(battleId), 0, `${L}: the draw never counted as played for the boost`);
  }

  // ═══ 5. D-A: a commit to a team that cannot play → accused at once → never opened → swept + slashed ═══
  {
    const L = 'unplayable';
    await a.agent.joinQueue(a.teamId, flags.bracket);
    const qb = await b.agent.joinQueue(b.teamId, flags.bracket);
    const battleId = qb.battleId ?? (await a.agent.waitMatched());
    const id = BigInt(battleId);
    await waitFor(async () => { const r = await a.agent.battle(battleId); return r.db?.status === 1 && Number(r.chain?.phase) === PHASE.Deposit ? r : null; }, { timeoutMs: 60_000, label: `${L}: createBattle on-chain` });
    const before = { a: await chain.balance(a.agent.address), b: await chain.balance(b.agent.address) };
    // The queue decides who is on-chain player A; the drill's "B" may be either side.
    const bIsSideA = String((await chain.getBattle(id)).playerA).toLowerCase() === b.agent.address.toLowerCase();
    const accusedB = (x: any) => Boolean(bIsSideA ? x.accusedA : x.accusedB);
    const accusedA = (x: any) => Boolean(bIsSideA ? x.accusedB : x.accusedA);
    // B deposits (commit + salt handed to the server), then disbands the committed team: the arena
    // only locks a team at reveal, so the chain allows it — and B's commit now names a team B does
    // not own. (The kit never does this by itself; this is the walk-away griefer.)
    await b.agent.deposit(battleId);
    const disband = await b.agent.post(`/api/game/teams/${b.teamId}/disband`);
    await b.agent.executeSteps(disband.steps);
    checks.check(!(await chain.read<boolean>(chain.teams, TeamManagerAbi, 'teamExists', [b.teamId])), `${L}: B disbanded its committed team after depositing`);
    await a.agent.deposit(battleId); // → TeamReveal; the resolver dry-runs revealTeams and the chain names B's team
    const accused = await waitFor(async () => { const x = await chain.getBattle(id); return accusedB(x) ? x : null; }, { timeoutMs: 40_000, everyMs: 300, label: `${L}: the resolver accuses B` });
    checks.check(!accusedA(accused), `${L}: A, whose team can play, is not accused`);
    checks.eq(Number(accused.phase), PHASE.TeamReveal, `${L}: still TeamReveal — B has REVEAL_GRACE to open a commit that can play`);
    await waitFor(async () => (logOf('engine').includes('team not playable') ? true : null), { timeoutMs: 10_000, everyMs: 500, label: `${L}: engine logs the reason` });
    checks.check(true, `${L}: engine logged reveal_failure_reported with "team not playable"`);
    // B walks away. Past the grace the WATCHDOG sweeps the battle (L3) — nobody has to wait for B.
    const fromBlock = await chain.pub.getBlockNumber();
    const now = await chain.latestTimestamp();
    await anvil.increaseTime(Number(BigInt(accused.phaseDeadline) - now) + 30);
    await waitFor(async () => { const x = await chain.getBattle(id); return Number(x.phase) === PHASE.Cancelled ? x : null; }, { timeoutMs: 60_000, label: `${L}: the watchdog sweeps the lapsed reveal (handleTimeout)` });
    checks.check(logOf('engine').includes('battle_timed_out_by_watchdog'), `${L}: engine logged battle_timed_out_by_watchdog`);
    const evs = await chain.pub.getContractEvents({ address: arena, abi: BattleArenaAbi as any, eventName: 'BattleCancelled', args: { battleId: id }, fromBlock: fromBlock > 50n ? fromBlock - 50n : 0n });
    checks.eq(Number((evs.at(-1) as any)?.args?.reason), bIsSideA ? 1 : 2, `${L}: cancelled as Forfeit${bIsSideA ? 'A' : 'B'} (the accused side that never opened)`);
    const after = { a: await chain.balance(a.agent.address), b: await chain.balance(b.agent.address) };
    checks.eq(after.a, before.a, `${L}: A got stake + anti-grief back in full`);
    checks.eq(before.b - after.b, antiGrief, `${L}: B lost exactly its 5% anti-grief deposit`);
    checks.check(!(await chain.teamInBattle(a.teamId)), `${L}: A's team is free again`);
    await waitFor(async () => ((await dbPhase(battleId)) === PHASE.Cancelled ? true : null), { timeoutMs: 30_000, label: `${L}: indexer mirrors Cancelled` });
  }
}
