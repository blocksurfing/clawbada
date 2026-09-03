/** `set_team_boosts` operator job — posts one batch (<= 200 entries) of the weekly
 *  boost table via `MiningPool.setTeamBoosts(epoch, entries)` with the BOOST_ADMIN key.
 *
 *  Enqueued by the engine's boost epoch job (`boost/epoch-job.ts` stageEpoch) with
 *  key `boost:set:<chainEpoch>:<batchIndex>`. The contract accepts `epoch` equal to
 *  `currentBoostEpoch` (amend) or `currentBoostEpoch + 1` (stage), so re-posting the
 *  same batch is safe right up to activation. After activation of a later epoch the
 *  call reverts `InvalidBoostEpoch`; that must NOT retry into the wrong epoch, so
 *  every revert is dead and only transport errors are transient.
 *
 *  Crash recovery mirrors create-battle: a persisted `priorTxHash` is reconciled
 *  from its receipt (bounded wait) before anything is resubmitted. */

import { getBoostAdminClient, getMiningPool, getPublicClient } from '@clawbada/chain';
import { BOOST_ENTRIES_PER_TX, BOOST_MAX_BPS } from '@clawbada/game-logic';
import { log as baseLog } from '../../logger';
import { classifyError } from '../errors';
import { TxHashPersistError, type JobContext, type JobResult } from '../types';

const log = baseLog.child({ module: 'operator-job', job: 'set_team_boosts' });
const isTestnet = process.env.CHAIN_ENV !== 'mainnet';

/** Same bounded wait as create-battle: a receipt miss is not proof the tx failed. */
export const PRIOR_TX_HASH_RECEIPT_TIMEOUT_MS = 90_000;

export interface BoostEntryPayload {
  /** Serialized bigint. */
  teamId: string;
  /** 0..BOOST_MAX_BPS. */
  bps: number;
  /** Team Power 3..9 the boost was earned at; the contract returns 0 on mismatch. */
  power: number;
}

export interface SetTeamBoostsPayload {
  /** Chain epoch (window index + 1). */
  epoch: number;
  entries: BoostEntryPayload[];
}

const MAX_UINT32 = 0xffff_ffff;

/** Validate the outbox payload. Returns the typed payload or a reason string. */
export function parseSetTeamBoostsPayload(raw: unknown): SetTeamBoostsPayload | string {
  if (!raw || typeof raw !== 'object') return 'not_an_object';
  const p = raw as { epoch?: unknown; entries?: unknown };
  if (!isChainEpoch(p.epoch)) return 'epoch_out_of_range';
  if (!Array.isArray(p.entries)) return 'entries_not_array';
  if (p.entries.length === 0) return 'entries_empty';
  if (p.entries.length > BOOST_ENTRIES_PER_TX) return `entries_exceed_${BOOST_ENTRIES_PER_TX}`;
  const entries: BoostEntryPayload[] = [];
  for (const [i, e] of p.entries.entries()) {
    if (!e || typeof e !== 'object') return `entry_${i}_not_an_object`;
    const { teamId, bps, power } = e as { teamId?: unknown; bps?: unknown; power?: unknown };
    if (typeof teamId !== 'string' || !/^\d+$/.test(teamId)) return `entry_${i}_team_id`;
    if (!Number.isInteger(bps) || (bps as number) < 0 || (bps as number) > BOOST_MAX_BPS) return `entry_${i}_bps`;
    if (!Number.isInteger(power) || (power as number) < 3 || (power as number) > 9) return `entry_${i}_power`;
    entries.push({ teamId, bps: bps as number, power: power as number });
  }
  return { epoch: p.epoch as number, entries };
}

export function isChainEpoch(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_UINT32;
}

export async function setTeamBoostsHandler(rawPayload: unknown, ctx: JobContext): Promise<JobResult> {
  const parsed = parseSetTeamBoostsPayload(rawPayload);
  if (typeof parsed === 'string') {
    return { ok: false, retry: 'dead', error: `invalid_payload: ${parsed}` };
  }

  try {
    const publicClient = getPublicClient(isTestnet);

    if (ctx.priorTxHash) {
      const prior = await reconcilePriorTx(publicClient, ctx);
      if (prior) return prior;
    }

    const walletClient = getBoostAdminClient(isTestnet) as any;
    const pool = getMiningPool(publicClient);
    const entries = parsed.entries.map((e) => ({ teamId: BigInt(e.teamId), bps: e.bps, power: e.power }));

    const sim = await pool.simulate.setTeamBoosts([parsed.epoch, entries], { account: walletClient.account });
    const hash = (await walletClient.writeContract(sim.request)) as `0x${string}`;
    // Persist BEFORE awaiting the receipt so a crash here cannot double-submit.
    await ctx.recordTxHash(hash);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      log.error({ jobId: ctx.jobId.toString(), epoch: parsed.epoch, txHash: hash }, 'setTeamBoosts reverted on chain');
      return { ok: false, retry: 'dead', error: 'tx_reverted' };
    }

    log.info(
      { jobId: ctx.jobId.toString(), epoch: parsed.epoch, entries: entries.length, txHash: hash },
      'setTeamBoosts confirmed',
    );
    return { ok: true, txHash: hash };
  } catch (err) {
    if (err instanceof TxHashPersistError) throw err;
    // Every revert (InvalidBoostEpoch, BoostTooHigh, BatchTooLarge, AccessControl)
    // is deterministic → dead. RPC / network → transient.
    return classifyError(err);
  }
}

/** Shared priorTxHash reconciliation for the boost jobs. Returns a result to hand
 *  back (success or terminal), or null when the caller should submit fresh (never —
 *  a null here only happens when there is no prior hash). */
export async function reconcilePriorTx(publicClient: any, ctx: JobContext): Promise<JobResult | null> {
  if (!ctx.priorTxHash) return null;
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({
      hash: ctx.priorTxHash as `0x${string}`,
      timeout: PRIOR_TX_HASH_RECEIPT_TIMEOUT_MS,
    });
  } catch (err) {
    log.warn({ err, jobId: ctx.jobId.toString(), txHash: ctx.priorTxHash }, 'priorTxHash receipt wait timed out; transient retry');
    return { ok: false, retry: 'transient', error: 'prior_tx_receipt_timeout' };
  }
  if (receipt.status === 'success') {
    log.info({ jobId: ctx.jobId.toString(), txHash: ctx.priorTxHash }, 'priorTxHash receipt success; finalizing without resubmit');
    return { ok: true, txHash: ctx.priorTxHash };
  }
  log.warn({ jobId: ctx.jobId.toString(), txHash: ctx.priorTxHash }, 'priorTxHash receipt is reverted (no resubmit)');
  return { ok: false, retry: 'dead', error: 'prior_tx_reverted' };
}
