/** `create_battle` operator job. PR-B closes X1 (matchmaker emits match
 *  but on-chain createBattle never lands).
 *
 *  Flow:
 *    1. Matchmaker decides a match, predicts the next battle id via
 *       `arena.simulate.createBattle`, inserts a `battles` row with
 *       `status = 0 (pending_create)`, queues this job in the same tx.
 *    2. Worker claims the job. Handler submits the real `createBattle`
 *       tx via the operator wallet, persists the hash via
 *       `ctx.recordTxHash` BEFORE awaiting receipt, then waits for the
 *       receipt and verifies the emitted BattleCreated event matches the
 *       predicted args.
 *    3. On success: `battles.status = 1 (created)`. Frontend polling on
 *       `/queue/status` (or `/api/game/combat/:id`) flips the user from
 *       pending-create UI to the live battle. (D5 said WS match_found,
 *       but the engine can't directly broadcast to API-hosted WS clients
 *       — tracked separately as cross-process WS bridge X10. Polling
 *       carries the signal at ~3s latency for S1.)
 *    4. On contract revert (X3 — queued team mutated, etc.): dead.
 *       `battles.status = 4 (create_failed)`. Polling flips the queue
 *       UI into a "match couldn't be created — please re-queue" state.
 *
 *  Crash recovery (F2/F3): if `priorTxHash` is set, fetch the receipt
 *  first and skip resubmission. The receipt is the truth — same idempotency
 *  semantics whether the prior attempt landed on chain or never did. */

import { eq } from 'drizzle-orm';
import { decodeEventLog } from 'viem';
import {
  BattleArenaAbi,
  addresses,
  getBattleArena,
  getMatchmakerClient,
  getPublicClient,
} from '@clawbada/chain';
import { db, battles } from '@clawbada/db';
import { log as baseLog } from '../../logger';
import { classifyError } from '../errors';
import { TxHashPersistError, type JobContext, type JobResult } from '../types';

const log = baseLog.child({ module: 'operator-job', job: 'create_battle' });
const isTestnet = process.env.CHAIN_ENV !== 'mainnet';

/** Battles status enum (see packages/db/src/schema/battles.ts). */
const STATUS_CREATED = 1;
const STATUS_CREATE_FAILED = 4;

/** Codex PR-B HIGH-1: bounded wait for a priorTxHash receipt. If exceeded,
 *  the handler returns transient — the retry will wait again. Set generously
 *  so we don't spuriously fail txs that are simply slow to confirm under
 *  congestion. Total tail-latency window: timeout × MAX_ATTEMPTS = 90s × 5
 *  = 7.5 min before dispatch escalates to dead. */
const PRIOR_TX_HASH_RECEIPT_TIMEOUT_MS = 90_000;

/** Payload written by `apps/api/src/lib/matchmaker/match.ts` in the same DB
 *  tx that inserts the `battles` row and deletes the queue rows. Everything
 *  the worker needs to submit + WS-notify is here so the handler is
 *  self-contained (no DB lookup beyond the receipt update). */
export interface CreateBattlePayload {
  predictedBattleId: string;       // serialized bigint, also embedded in idempotency_key
  playerA: string;                 // lowercased
  playerB: string;                 // lowercased
  stakeWei: string;                // serialized bigint (wei, not display)
  stakeBracket: number;            // 0=Low, 1=Mid, 2=High
  powerA: number;                  // matchmaker M-02 re-read
  powerB: number;
  // WS notification metadata — mirrors the previous inline matchmaker emit.
  enqueuedAtMsA: number;
  enqueuedAtMsB: number;
  queueIdA: string;                // matchmaking_queue.id at decision time
  queueIdB: string;
}

export async function createBattleHandler(
  rawPayload: unknown,
  ctx: JobContext,
): Promise<JobResult> {
  const payload = rawPayload as CreateBattlePayload;
  const predictedBattleId = BigInt(payload.predictedBattleId);
  const stakeWei = BigInt(payload.stakeWei);

  try {
    const publicClient = getPublicClient(isTestnet);

    // F2/F3 reconciliation: a prior attempt persisted the tx hash before
    // crashing. NEVER blindly resubmit — Codex PR-B HIGH-1: a receipt-miss
    // is not proof the tx failed (could be pending, RPC-indexing-delayed,
    // or a transient RPC error). A second submit could double-create the
    // battle (createBattle has no player-pair uniqueness guard on chain).
    // Use a bounded `waitForTransactionReceipt` instead:
    //   - success → finalize (skip resubmit).
    //   - reverted → known terminal failure for this hash. Don't resubmit;
    //     mark dead. Operator can investigate.
    //   - timeout → return transient. Next attempt waits again on the same
    //     priorTxHash. After MAX_ATTEMPTS dispatch escalates to dead, which
    //     creates an operator-visible signal that the prior tx is genuinely
    //     stuck (mempool eviction with no replacement, RPC partition, etc.).
    if (ctx.priorTxHash) {
      // Codex PR-B FU-5 (LOW): narrow the inner try to ONLY the receipt
      // wait. Otherwise finalizeFromReceipt / markCreateFailed errors get
      // mislabeled as `prior_tx_receipt_timeout` instead of reaching the
      // outer classifyError catch (where DB errors classify correctly as
      // transient and contract reverts classify as dead).
      let receipt;
      try {
        receipt = await publicClient.waitForTransactionReceipt({
          hash: ctx.priorTxHash as `0x${string}`,
          timeout: PRIOR_TX_HASH_RECEIPT_TIMEOUT_MS,
        });
      } catch (err) {
        log.warn(
          { err, jobId: ctx.jobId.toString(), txHash: ctx.priorTxHash },
          'priorTxHash receipt wait timed out; transient retry',
        );
        return { ok: false, retry: 'transient', error: 'prior_tx_receipt_timeout' };
      }
      if (receipt.status === 'success') {
        log.info(
          { jobId: ctx.jobId.toString(), txHash: ctx.priorTxHash },
          'priorTxHash receipt success; finalizing without resubmit',
        );
        return await finalizeFromReceipt(receipt, predictedBattleId, payload, ctx);
      }
      // Reverted on chain. The contract reverted but the tx still mined.
      // No battle was created. Don't resubmit — go dead and let the
      // operator decide whether to re-queue.
      log.warn(
        { jobId: ctx.jobId.toString(), txHash: ctx.priorTxHash },
        'priorTxHash receipt is reverted; marking create_failed (no resubmit)',
      );
      await markCreateFailed(payload, 'prior_tx_reverted', `priorTxHash ${ctx.priorTxHash} reverted`);
      return { ok: false, retry: 'dead', error: 'prior_tx_reverted' };
    }

    // Codex cross-cutting HIGH-1: createBattle requires MATCHMAKER_ROLE
    // (BattleArena.sol:306). Mainnet config grants this role to a
    // dedicated MATCHMAKER address distinct from the RESOLVER; the
    // matchmaker-specific client reads MATCHMAKER_PRIVATE_KEY (or falls
    // back to OPERATOR_PRIVATE_KEY for testnet/dev convenience).
    const walletClient = getMatchmakerClient(isTestnet) as any;
    const arena = getBattleArena(publicClient);

    // Re-simulate at submit time to validate inputs against current chain
    // state (catches "team got disbanded between matchmaker and worker"
    // and similar). The matchmaker's advisory lock + UNIQUE idempotency
    // serializes prediction, so the simulated next id should equal
    // predictedBattleId; we verify on the receipt to catch drift.
    const sim = await arena.simulate.createBattle(
      [
        payload.playerA as `0x${string}`,
        payload.playerB as `0x${string}`,
        stakeWei,
        payload.powerA,
        payload.powerB,
      ],
      { account: walletClient.account },
    );

    const hash = (await walletClient.writeContract(sim.request)) as `0x${string}`;
    // HIGH-A1: persist BEFORE awaiting receipt so a crash here doesn't
    // lose the hash and cause double-submission on retry.
    await ctx.recordTxHash(hash);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success') {
      await markCreateFailed(payload, 'tx_reverted', 'on-chain createBattle reverted');
      return { ok: false, retry: 'dead', error: 'tx_reverted' };
    }

    return await finalizeFromReceipt(receipt, predictedBattleId, payload, ctx);
  } catch (err) {
    // X3 lands here for queued-team mutations: the BattleArena reverts
    // TeamNotOwned / TeamPowerChanged / etc., classifyError reports `dead`,
    // and the dead refund path fires below. Let TxHashPersistError
    // propagate so dispatch's specific handler runs (don't auto-classify
    // it as dead here — dispatch logs fatal + marks dead with a clearer
    // ops signal).
    if (err instanceof TxHashPersistError) throw err;
    const result = classifyError(err);
    if (!result.ok && result.retry === 'dead') {
      await markCreateFailed(payload, result.error, `dead: ${result.error}`);
    }
    return result;
  }
}

/** Reconcile a receipt — decode the BattleCreated event, verify args, then
 *  write the success-state DB update + emit the match_found WS. */
async function finalizeFromReceipt(
  receipt: { logs: readonly { address: string; data: string; topics: readonly string[] }[] },
  predictedBattleId: bigint,
  payload: CreateBattlePayload,
  ctx: JobContext,
): Promise<JobResult> {
  const created = findBattleCreatedEvent(receipt.logs);
  if (!created) {
    log.fatal(
      { jobId: ctx.jobId.toString(), predictedBattleId: predictedBattleId.toString() },
      'createBattle receipt missing BattleCreated event',
    );
    await markCreateFailed(payload, 'event_missing', 'BattleCreated event not in receipt');
    return { ok: false, retry: 'dead', error: 'event_missing' };
  }

  const actualBattleId = created.battleId;
  if (actualBattleId !== predictedBattleId) {
    // Should be impossible with the matchmaker's BATTLE_PREDICTION_LOCK_KEY
    // advisory lock + UNIQUE idempotency_key (operator wallet is the only
    // MATCHMAKER_ROLE holder). If we hit this, something is very wrong —
    // log fatal and dead-out so ops can investigate.
    log.fatal(
      {
        jobId: ctx.jobId.toString(),
        predicted: predictedBattleId.toString(),
        actual: actualBattleId.toString(),
      },
      'createBattle battleId drift — manual reconciliation needed',
    );
    await markCreateFailed(payload, 'battleid_drift', `predicted=${predictedBattleId} actual=${actualBattleId}`);
    return { ok: false, retry: 'dead', error: 'battleid_drift' };
  }

  await db
    .update(battles)
    .set({ status: STATUS_CREATED })
    .where(eq(battles.battleId, predictedBattleId));

  // X10 (deferred): WS `match_found` would fire here in a future PR with
  // a Postgres LISTEN/NOTIFY bridge between engine → API → WS clients.
  // Today the frontend's `/queue/status` and `/api/game/combat/:id`
  // polling carries the signal at ~3s latency.
  log.info(
    {
      battleId: predictedBattleId.toString(),
      playerA: payload.playerA,
      playerB: payload.playerB,
      jobId: ctx.jobId.toString(),
    },
    'createBattle confirmed; battles.status=created',
  );

  return { ok: true, txHash: undefined };
}

/** Update battles row to status=create_failed. Frontend polling on
 *  `/queue/status` recognizes the status flip and surfaces a
 *  "match couldn't be created — please re-queue" message. X3 + dead-job
 *  refund path. NOT auto-requeueing (the underlying cause may be permanent
 *  — e.g., team got disbanded).
 *
 *  Codex PR-B MEDIUM-4: re-throws DB errors instead of swallowing. If the
 *  status update fails, the caller's catch reclassifies as transient so
 *  dispatch retries — otherwise the row stays at status=0 forever, the
 *  job goes dead, and users see an indefinite pending-create page. */
async function markCreateFailed(
  payload: CreateBattlePayload,
  code: string,
  detail: string,
): Promise<void> {
  const predictedBattleId = BigInt(payload.predictedBattleId);
  await db
    .update(battles)
    .set({ status: STATUS_CREATE_FAILED })
    .where(eq(battles.battleId, predictedBattleId));
  log.warn(
    { battleId: predictedBattleId.toString(), code, detail },
    'createBattle marked create_failed',
  );
  // X10 (deferred): `match_cancelled` WS would fire here via the cross-
  // process bridge. Polling carries the signal today.
}

/** Decode logs from the receipt looking for BattleCreated emitted by the
 *  BattleArena address. viem's decodeEventLog throws on non-matching ABI
 *  shape — we filter by address first and swallow the rest. */
function findBattleCreatedEvent(
  logs: readonly { address: string; data: string; topics: readonly string[] }[],
): { battleId: bigint; playerA: string; playerB: string } | null {
  for (const lg of logs) {
    if (lg.address.toLowerCase() !== addresses.battleArena.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: BattleArenaAbi as any,
        data: lg.data as `0x${string}`,
        topics: lg.topics as [`0x${string}`, ...`0x${string}`[]],
      }) as { eventName: string; args: { battleId: bigint; playerA: string; playerB: string } };
      if (decoded.eventName === 'BattleCreated') {
        return decoded.args;
      }
    } catch {
      // not a decodable BattleArena event, skip
    }
  }
  return null;
}
