/** Error classification for operator-worker handlers. PR-B X8 (was deferred
 *  from PR-A MEDIUM-A4).
 *
 *  Closes a footgun in the dispatch contract: thrown handler exceptions
 *  default to `transient`, which means a permanent contract revert (e.g.
 *  `InvalidPowerScore` because the queued team's lobsters were swapped out)
 *  would burn all 5 retry slots before going dead. Handlers SHOULD return
 *  a `JobResult` explicitly, but enforcing that for every revert path is
 *  noisy. `wrapHandler` lets a handler throw freely and pushes the
 *  classification into one shared helper. */
import { ContractFunctionRevertedError } from 'viem';
import { TxHashPersistError, type JobHandler, type JobResult } from './types';

/** Contract custom-error names that are deterministic-permanent — there is
 *  no point retrying these. Sourced from BattleArena.sol. PR-C will add
 *  the resolver / settlement entries once those handlers land. */
const PERMANENT_REVERT_NAMES = new Set<string>([
  // createBattle preconditions
  'PlayerCannotBeSelf',
  'ZeroAddress',
  'InvalidStakeAmount',
  'InvalidPowerScore',
  // Team-power binding (matchmaker → revealTeam smurfing guard)
  'TeamPowerChanged',
  'TeamNotOwned',
  'TeamAlreadyInBattle',
  // State-machine guards that won't resolve by waiting
  'InvalidBattlePhase',
  'BattleDoesNotExist',
  'NotBattleParticipant',
  // Reveal mismatches (frontend hash bugs we've already shipped fixes for)
  'InvalidCommitHash',
  'AlreadyDeposited',
  'AlreadyCommitted',
  'AlreadyRevealed',
  // Resolver / lobster-tier guards
  'LobsterTierTooLow',
  'LobsterDamageTooHigh',
  // Settlement guards
  'InvalidWinner',
  'SettlementRequiresVerifiedRound',
  'BothCommitsRequired',
  'BothRevealsRequired',
  'MaxRoundsReached',
  // Timeout / emergency / dispute guards
  'PhaseNotTimedOut',
  'EmergencyWithdrawTooEarly',
  'DisputeWindowOpen',
  'DisputeWindowClosed',
]);

/** Walk the error cause chain looking for a viem `ContractFunctionRevertedError`.
 *  viem wraps reverts inside `ContractFunctionExecutionError` (and sometimes
 *  further inside `CallExecutionError`), so a direct `instanceof` against the
 *  caught exception misses the revert. */
function findContractRevert(err: unknown): ContractFunctionRevertedError | null {
  let current: unknown = err;
  let depth = 0;
  while (current && depth < 10) {
    if (current instanceof ContractFunctionRevertedError) return current;
    current = (current as { cause?: unknown }).cause;
    depth++;
  }
  return null;
}

/** Convert a thrown error into a structured `JobResult`. Permanent contract
 *  reverts → `dead`. Everything else (RPC errors, network timeouts, viem
 *  validation, etc.) → `transient`. Bubble up `TxHashPersistError` so
 *  dispatch's existing handler classifies it separately. */
export function classifyError(err: unknown): JobResult {
  if (err instanceof TxHashPersistError) {
    // Caller should re-throw this; classifyError shouldn't swallow it.
    // Returning a transient result would be wrong (would lose the tx hash
    // and trigger re-submission). Return dead with a clear marker so a
    // misbehaving caller produces an obvious failure instead of silently
    // re-submitting.
    return { ok: false, retry: 'dead', error: `tx_hash_persist_in_classify: ${err.message}` };
  }
  const reverted = findContractRevert(err);
  if (reverted) {
    const errorName = reverted.data?.errorName ?? null;
    if (errorName && PERMANENT_REVERT_NAMES.has(errorName)) {
      return { ok: false, retry: 'dead', error: `revert:${errorName}` };
    }
    // Unknown revert: still dead. Re-attempts will hit the same contract
    // state and revert identically. The error name (or 'unknown' if
    // unparseable) is preserved for ops diagnosis.
    return { ok: false, retry: 'dead', error: `revert:${errorName ?? 'unknown'}` };
  }
  // Non-revert error path — RPC, network, viem validation, etc. Transient.
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, retry: 'transient', error: msg };
}

/** Higher-order helper that lets a handler `throw` freely. The wrapper
 *  routes `TxHashPersistError` through (dispatch handles it specifically)
 *  and runs every other throw through `classifyError`. Handlers that want
 *  fine-grained control can still return a `JobResult` directly.
 *
 *  Codex PR-B LOW-5: also validates the return shape so a handler that
 *  accidentally returns `undefined` (TS prevents it but JS allows it under
 *  bad mocks / runtime drift) doesn't crash dispatch's `result.ok` access
 *  with an unhandled throw — that would leave the job stuck in `running`
 *  until the next stale-recovery sweep. */
export function wrapHandler(inner: JobHandler): JobHandler {
  return async (payload, ctx) => {
    let result: JobResult;
    try {
      result = await inner(payload, ctx);
    } catch (err) {
      if (err instanceof TxHashPersistError) throw err;
      return classifyError(err);
    }
    if (!isValidJobResult(result)) {
      return {
        ok: false,
        retry: 'dead',
        error: `malformed_handler_result: ${String(result)}`,
      };
    }
    return result;
  };
}

/** Codex PR-B FU-4 (LOW): validate the full discriminated-union shape.
 *  Pre-FU-4 we only checked `result.ok` was boolean — a handler returning
 *  `{ ok: false }` (missing `retry` + `error`) would slip through and
 *  cause dispatch to write an `undefined` error / treat it as transient
 *  unintentionally. */
function isValidJobResult(value: unknown): value is JobResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as { ok?: unknown; retry?: unknown; error?: unknown; txHash?: unknown };
  if (typeof v.ok !== 'boolean') return false;
  if (v.ok) {
    // `{ ok: true, txHash?: string }`
    return v.txHash === undefined || typeof v.txHash === 'string';
  }
  // `{ ok: false, retry: 'dead' | 'transient', error: string }`
  if (v.retry !== 'dead' && v.retry !== 'transient') return false;
  if (typeof v.error !== 'string') return false;
  return true;
}
