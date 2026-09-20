/**
 * D-28 verification against a REAL Postgres (the unit tests use a fake db, which cannot tell
 * whether the drizzle queries, the transaction or the row shapes are right).
 *
 *   bun run scripts/e2e/verify-settle-reconcile.ts
 *
 * Needs the local dev Postgres the e2e harness uses (E2E_PG_ADMIN_URL to override). Creates a
 * throwaway database, migrates it, and drops it afterwards. The chain is faked — the
 * reconciler only reads a phase and a deadline from it.
 *
 * Checks:
 *   1. SessionStore.finishAndEnqueueSettle writes the 'settling' status AND the settle job;
 *   2. ... and writes NEITHER when the job insert fails (one transaction, rolled back);
 *   3. SettleReconciler recreates a missing settle job with the payload the API would have sent;
 *   4. ... revives a job that died from exhausted retries;
 *   5. ... never revives a job that died from a permanent contract revert;
 *   6. ... leaves everything alone once the battle has left Active on-chain.
 */
import { join } from 'node:path';
import { v3 } from '@clawbada/game-logic';
import { createRunDb } from './lib/db';

const repoRoot = join(import.meta.dir, '..', '..');
const run = await createRunDb(repoRoot, `d28_${Date.now()}`);
process.env.DATABASE_URL = run.url; // before @clawbada/db is imported: its client is built at import

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
};

try {
  // Paths held in variables on purpose: this workspace's tsconfig has rootDir = scripts/e2e,
  // and a literal import would pull the API and engine sources into its typecheck. They are
  // typechecked in their own workspaces; here they are exercised at runtime.
  const storePath = '../../apps/api/src/lib/battle-session/store';
  const reconcilerPath = '../../apps/engine/src/operator/settle-reconciler';
  const { SessionStore } = await import(storePath);
  const { SettleReconciler } = await import(reconcilerPath);
  const dbMod = await import('@clawbada/db');

  const team = (s: string) => [0, 1, 2].map((i) => ({ id: `${s}${i}`, class: i, tier: 1, purity: 0 })) as any;
  const state = v3.createBattle({ battleId: '7', vrfSeed: 7n, tier: 'evolved', teamA: team('A'), teamB: team('B') } as any);
  v3.runBattle(state, { A: v3.BOTS.aggressive, B: v3.BOTS.aggressive });
  const stateJson = v3.serializeState(state);
  const damage = v3.repairDamage(state);
  const A = '0x00000000000000000000000000000000000000aa';
  const B = '0x00000000000000000000000000000000000000bb';
  const H1 = `0x${'11'.repeat(32)}`;
  const H2 = `0x${'22'.repeat(32)}`;
  const winnerSide = state.winner ?? 'draw';
  const winnerWallet = winnerSide === 'draw' ? 'draw' : winnerSide === 'A' ? A : B;

  const newSession = (id: string) =>
    run.sql`insert into battle_sessions (id, kind, player_a, player_b, tier, roster, state_json, status)
            values (${id}, 'real', ${A}, ${B}, 'evolved', ${run.sql.json({})}, ${stateJson}, 'active')`;
  const session = async (id: string) => (await run.sql`select status, winner from battle_sessions where id = ${id}`)[0]!;
  const job = async (id: string) => (await run.sql`select * from operator_jobs where idempotency_key = ${'settle_battle:' + id}`)[0];

  const store = new SessionStore();
  const patch = { status: 'settling' as const, winner: winnerSide, finalStateHash: H1, turnLogHash: H2, stateJson, turn: state.turn };
  const payload = { battleId: '7', winner: winnerWallet, finalStateHash: H1, turnLogHash: H2, damageA: damage.damageA, damageB: damage.damageB };

  // 1. both writes land
  await newSession('7');
  await store.finishAndEnqueueSettle('7', patch, payload as any);
  check((await session('7')).status === 'settling', 'finish+enqueue: session is settling');
  check((await job('7'))?.job_type === 'settle_battle', 'finish+enqueue: settle job exists');

  // 2. one transaction: a failing job insert rolls the status change back
  await newSession('8');
  let threw = false;
  try {
    await store.finishAndEnqueueSettle('8', patch, undefined as any); // payload is NOT NULL
  } catch {
    threw = true;
  }
  check(threw, 'finish+enqueue: a failing job insert rejects');
  check((await session('8')).status === 'active', 'finish+enqueue: ...and the session is NOT left settling (rolled back)', `status=${(await session('8')).status}`);
  check((await job('8')) === undefined, 'finish+enqueue: ...and no job row exists');

  // Reconciler against the same database, chain faked.
  let chain = { phase: 4, phaseDeadline: 10_000n };
  const quiet = { child: () => ({ info() {}, warn() {}, error() {}, debug() {} }) } as any;
  const reconciler = new SettleReconciler({
    db: dbMod.db,
    battleSessions: dbMod.battleSessions,
    operatorJobs: dbMod.operatorJobs,
    publicClient: { getBlock: async () => ({ timestamp: 1_000n }) },
    arena: { read: { getBattle: async () => chain } },
    log: quiet,
    graceMs: 0,
  });

  // 3. the lost-enqueue case: settling, no job
  await run.sql`delete from operator_jobs where idempotency_key = 'settle_battle:7'`;
  await run.sql`update battle_sessions set updated_at = now() - interval '5 minutes' where id = '7'`;
  await reconciler.tick();
  const recreated = await job('7');
  check(recreated !== undefined && Number(recreated.status) === 0, 'reconciler: recreates the missing settle job as pending');
  // jsonb does not keep key order, so compare with keys sorted.
  const canon = (o: unknown) => JSON.stringify(o, Object.keys((o ?? {}) as object).sort());
  check(canon(recreated?.payload) === canon(payload), 'reconciler: rebuilt payload is identical to what the API enqueues', canon(recreated?.payload));

  // 4. exhausted retries → revived
  await run.sql`update operator_jobs set status = 3, attempts = 5, completed_at = now(), last_error = 'max_attempts_exceeded: fetch failed' where idempotency_key = 'settle_battle:7'`;
  await reconciler.tick();
  const revived = (await job('7'))!;
  check(Number(revived.status) === 0 && Number(revived.attempts) === 0 && revived.completed_at === null, 'reconciler: revives a job whose retries ran out', `status=${revived.status} attempts=${revived.attempts}`);
  check(String(revived.last_error).startsWith('revived: max_attempts_exceeded'), 'reconciler: keeps the original error, marked revived');

  // 5. permanent revert → untouched
  await run.sql`update operator_jobs set status = 3, attempts = 1, completed_at = now(), last_error = 'revert:InvalidSettlementHash' where idempotency_key = 'settle_battle:7'`;
  await reconciler.tick();
  check(Number((await job('7'))!.status) === 3, 'reconciler: never revives a permanently dead job');

  // 6. battle left Active → hands off
  await run.sql`update operator_jobs set last_error = 'max_attempts_exceeded: fetch failed' where idempotency_key = 'settle_battle:7'`;
  chain = { phase: 5, phaseDeadline: 10_000n };
  await reconciler.tick();
  check(Number((await job('7'))!.status) === 3, 'reconciler: does nothing once the battle is no longer Active on-chain');

} finally {
  await run.drop();
}

console.log(failed === 0 ? '\nD-28 verification PASSED' : `\nD-28 verification FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
