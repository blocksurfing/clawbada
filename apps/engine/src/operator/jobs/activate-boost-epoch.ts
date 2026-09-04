/** `activate_boost_epoch` operator job — flips the staged boost table live via
 *  `MiningPool.activateBoostEpoch(epoch)` with the BOOST_ADMIN key.
 *
 *  Enqueued by the engine's boost epoch job (`boost/epoch-job.ts` activateEpoch) with
 *  key `boost:activate:<chainEpoch>` once every set_team_boosts batch succeeded. The
 *  contract only accepts `currentBoostEpoch + 1`, so the job is naturally idempotent:
 *  if a prior attempt (or an operator) already activated this epoch the simulate
 *  reverts `InvalidBoostEpoch` and `currentBoostEpoch() >= epoch` — that is success,
 *  not failure. Any other revert is dead; transport errors are transient. */

import { getBoostAdminClient, getMiningPool, getPublicClient } from '@clawbada/chain';
import { log as baseLog } from '../../logger';
import { classifyError } from '../errors';
import { TxHashPersistError, type JobContext, type JobResult } from '../types';
import { isChainEpoch, reconcilePriorTx } from './set-team-boosts';

const log = baseLog.child({ module: 'operator-job', job: 'activate_boost_epoch' });
const isTestnet = process.env.CHAIN_ENV !== 'mainnet';

/** classifyError's rendering of the contract's InvalidBoostEpoch(requested, current). */
const REVERT_INVALID_BOOST_EPOCH = 'revert:InvalidBoostEpoch';

export interface ActivateBoostEpochPayload {
  /** Chain epoch (window index + 1). */
  epoch: number;
}

export function parseActivateBoostEpochPayload(raw: unknown): ActivateBoostEpochPayload | string {
  if (!raw || typeof raw !== 'object') return 'not_an_object';
  const p = raw as { epoch?: unknown };
  if (!isChainEpoch(p.epoch)) return 'epoch_out_of_range';
  return { epoch: p.epoch as number };
}

export async function activateBoostEpochHandler(rawPayload: unknown, ctx: JobContext): Promise<JobResult> {
  const parsed = parseActivateBoostEpochPayload(rawPayload);
  if (typeof parsed === 'string') {
    return { ok: false, retry: 'dead', error: `invalid_payload: ${parsed}` };
  }
  const { epoch } = parsed;

  try {
    const publicClient = getPublicClient(isTestnet);
    const pool = getMiningPool(publicClient);

    if (ctx.priorTxHash) {
      const prior = await reconcilePriorTx(publicClient, ctx);
      // A reverted prior tx is still success if the epoch is live by now (someone
      // else activated it between our submit and its inclusion).
      if (prior && !prior.ok && prior.error === 'prior_tx_reverted' && (await isLive(pool, epoch))) {
        log.info({ jobId: ctx.jobId.toString(), epoch }, 'prior activate reverted but epoch is live; treating as done');
        return { ok: true };
      }
      if (prior) return prior;
    }

    const walletClient = getBoostAdminClient(isTestnet) as any;

    let sim;
    try {
      sim = await pool.simulate.activateBoostEpoch([epoch], { account: walletClient.account });
    } catch (err) {
      if (err instanceof TxHashPersistError) throw err;
      const result = classifyError(err);
      if (!result.ok && result.error === REVERT_INVALID_BOOST_EPOCH && (await isLive(pool, epoch))) {
        log.info({ jobId: ctx.jobId.toString(), epoch }, 'activateBoostEpoch already done on chain');
        return { ok: true };
      }
      return result;
    }

    const hash = (await walletClient.writeContract(sim.request)) as `0x${string}`;
    // Persist BEFORE awaiting the receipt so a crash here cannot double-submit.
    await ctx.recordTxHash(hash);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      if (await isLive(pool, epoch)) {
        log.warn({ jobId: ctx.jobId.toString(), epoch, txHash: hash }, 'activateBoostEpoch reverted but epoch is live; treating as done');
        return { ok: true, txHash: hash };
      }
      log.error({ jobId: ctx.jobId.toString(), epoch, txHash: hash }, 'activateBoostEpoch reverted on chain');
      return { ok: false, retry: 'dead', error: 'tx_reverted' };
    }

    log.info({ jobId: ctx.jobId.toString(), epoch, txHash: hash }, 'activateBoostEpoch confirmed');
    return { ok: true, txHash: hash };
  } catch (err) {
    if (err instanceof TxHashPersistError) throw err;
    return classifyError(err);
  }
}

/** True once the contract's live epoch has reached `epoch`. */
async function isLive(pool: any, epoch: number): Promise<boolean> {
  return Number(await pool.read.currentBoostEpoch()) >= epoch;
}
