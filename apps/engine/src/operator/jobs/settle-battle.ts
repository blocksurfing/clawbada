/** `settle_battle` operator job — the engine's only V3 settlement duty.
 *
 *  The API's battle-session manager runs the off-chain ATB battle. When it ends
 *  (wipeout, turn cap, or forfeit) the API enqueues this job in `operator_jobs`
 *  with everything the contract needs; the worker submits
 *  `BattleArena.settle(battleId, winner, finalStateHash, turnLogHash, damageA, damageB)`
 *  with the RESOLVER key. `winner === 'draw'` maps to address(0).
 *
 *  Idempotent: a battle already past Active (AwaitingFinalize / Settled) is a
 *  success, and a prior attempt's tx hash is reconciled by receipt before any
 *  resubmission (same F2/F3 pattern as create_battle). Contract reverts are
 *  classified dead by wrapHandler (InvalidSettlementHash, PhaseTimedOut, ...). */

import { zeroAddress } from 'viem';
import { getBattleArena, getPublicClient, getResolverClient } from '@clawbada/chain';
import { log as baseLog } from '../../logger';
import { classifyError } from '../errors';
import { TxHashPersistError, type JobContext, type JobResult } from '../types';

const log = baseLog.child({ module: 'operator-job', job: 'settle_battle' });
const isTestnet = process.env.CHAIN_ENV !== 'mainnet';

/** BattleArena.BattlePhase numerics (contract enum). */
const PHASE_ACTIVE = 4;
const PHASE_AWAITING_FINALIZE = 5;
const PHASE_SETTLED = 6;

const PRIOR_TX_HASH_RECEIPT_TIMEOUT_MS = 90_000;

export interface SettleBattlePayload {
  battleId: string;
  /** Winner wallet, or 'draw'. */
  winner: string;
  finalStateHash: `0x${string}`;
  turnLogHash: `0x${string}`;
  damageA: [number, number, number];
  damageB: [number, number, number];
}

function validatePayload(raw: unknown): SettleBattlePayload {
  const p = raw as Partial<SettleBattlePayload>;
  if (!p || typeof p.battleId !== 'string' || !/^\d+$/.test(p.battleId)) throw new Error('settle_battle: bad battleId');
  if (typeof p.winner !== 'string' || (p.winner !== 'draw' && !/^0x[0-9a-fA-F]{40}$/.test(p.winner))) throw new Error('settle_battle: bad winner');
  for (const k of ['finalStateHash', 'turnLogHash'] as const) {
    if (typeof p[k] !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(p[k]!) || /^0x0{64}$/.test(p[k]!)) throw new Error(`settle_battle: bad ${k}`);
  }
  for (const k of ['damageA', 'damageB'] as const) {
    const arr = p[k];
    if (!Array.isArray(arr) || arr.length !== 3 || arr.some((d) => !Number.isInteger(d) || d < 0 || d > 255)) throw new Error(`settle_battle: bad ${k}`);
  }
  return p as SettleBattlePayload;
}

export async function settleBattleHandler(rawPayload: unknown, ctx: JobContext): Promise<JobResult> {
  let payload: SettleBattlePayload;
  try {
    payload = validatePayload(rawPayload);
  } catch (err) {
    return { ok: false, retry: 'dead', error: (err as Error).message };
  }
  const battleId = BigInt(payload.battleId);
  const winner = (payload.winner === 'draw' ? zeroAddress : payload.winner) as `0x${string}`;

  try {
    const publicClient = getPublicClient(isTestnet);
    const arena = getBattleArena(publicClient);

    // Idempotency: if the chain already moved past Active, our work is done
    // (a prior attempt landed, or the admin path already ran).
    const b = await arena.read.getBattle([battleId]);
    const phase = Number(b.phase);
    if (phase === PHASE_AWAITING_FINALIZE || phase === PHASE_SETTLED) {
      log.info({ battleId: payload.battleId, phase, jobId: ctx.jobId.toString() }, 'battle already settled/proposed; nothing to do');
      return { ok: true };
    }
    if (phase !== PHASE_ACTIVE) {
      return { ok: false, retry: 'dead', error: `battle_not_active:phase=${phase}` };
    }

    if (ctx.priorTxHash) {
      let receipt;
      try {
        receipt = await publicClient.waitForTransactionReceipt({
          hash: ctx.priorTxHash as `0x${string}`,
          timeout: PRIOR_TX_HASH_RECEIPT_TIMEOUT_MS,
        });
      } catch (err) {
        return { ok: false, retry: 'transient', error: `prior_tx_receipt_timeout: ${(err as Error).message}` };
      }
      if (receipt.status === 'success') return { ok: true, txHash: ctx.priorTxHash };
      // Reverted prior tx: the chain is still Active (checked above), so a
      // fresh submit is safe and correct — fall through.
      log.warn({ battleId: payload.battleId, priorTxHash: ctx.priorTxHash }, 'prior settle tx reverted; resubmitting');
    }

    const walletClient = getResolverClient(isTestnet) as any;
    const sim = await arena.simulate.settle(
      [battleId, winner, payload.finalStateHash, payload.turnLogHash, payload.damageA, payload.damageB],
      { account: walletClient.account },
    );
    const hash = (await walletClient.writeContract(sim.request)) as `0x${string}`;
    await ctx.recordTxHash(hash);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') return { ok: false, retry: 'dead', error: 'settle_reverted' };

    log.info({ battleId: payload.battleId, winner: payload.winner, hash, jobId: ctx.jobId.toString() }, 'settle submitted; battle AwaitingFinalize');
    return { ok: true, txHash: hash };
  } catch (err) {
    if (err instanceof TxHashPersistError) throw err;
    return classifyError(err);
  }
}
