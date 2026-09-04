import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { ContractFunctionRevertedError } from 'viem';

// ── Mock @clawbada/chain ──
//
// Handler surface: getBoostAdminClient (writeContract), getPublicClient
// (waitForTransactionReceipt), getMiningPool (simulate.setTeamBoosts). The `calls`
// log records the order so the simulate → write → recordTxHash → receipt contract
// can be asserted.
const calls: string[] = [];
const mockAccount = { address: '0xBoostAdmin' };
const mockWriteContract = mock((_req: unknown) => {
  calls.push('write');
  return Promise.resolve('0xsetHash');
});
const mockWaitForReceipt = mock<any>();
const mockSimulate = mock<any>();
const mockRead = mock<any>();

mock.module('@clawbada/chain', () => ({
  getBoostAdminClient: () => ({ account: mockAccount, writeContract: mockWriteContract }),
  getPublicClient: () => ({
    waitForTransactionReceipt: (...args: unknown[]) => {
      calls.push('receipt');
      return mockWaitForReceipt(...args);
    },
  }),
  getMiningPool: () => ({
    simulate: {
      setTeamBoosts: (...args: unknown[]) => {
        calls.push('simulate');
        return mockSimulate(...args);
      },
    },
    read: { currentBoostEpoch: mockRead },
  }),
}));

// ── Import after mocks ──
import { parseSetTeamBoostsPayload, setTeamBoostsHandler, type SetTeamBoostsPayload } from '../../operator/jobs/set-team-boosts';
import { TxHashPersistError, type JobContext } from '../../operator/types';

function makeCtx(overrides: Partial<JobContext> = {}): JobContext {
  return {
    jobId: 11n,
    jobType: 'set_team_boosts',
    attempts: 1,
    priorTxHash: null,
    recordTxHash: mock(() => {
      calls.push('record');
      return Promise.resolve();
    }),
    ...overrides,
  };
}

function makePayload(overrides: Partial<SetTeamBoostsPayload> = {}): SetTeamBoostsPayload {
  return {
    epoch: 5,
    entries: [
      { teamId: '12', bps: 5000, power: 5 },
      { teamId: '34', bps: 1000, power: 3 },
    ],
    ...overrides,
  };
}

function makeRevert(errorName: string): Error {
  const err = Object.create(ContractFunctionRevertedError.prototype);
  err.message = `reverted: ${errorName}`;
  err.data = { errorName };
  return err as Error;
}

describe('parseSetTeamBoostsPayload', () => {
  test('accepts a well-formed batch', () => {
    expect(parseSetTeamBoostsPayload(makePayload())).toEqual(makePayload());
  });

  test('rejects malformed batches with a reason', () => {
    expect(parseSetTeamBoostsPayload(null)).toBe('not_an_object');
    expect(parseSetTeamBoostsPayload(makePayload({ epoch: 0 }))).toBe('epoch_out_of_range');
    expect(parseSetTeamBoostsPayload(makePayload({ entries: [] }))).toBe('entries_empty');
    expect(parseSetTeamBoostsPayload(makePayload({ entries: Array.from({ length: 201 }, () => ({ teamId: '1', bps: 1000, power: 5 })) }))).toBe(
      'entries_exceed_200',
    );
    expect(parseSetTeamBoostsPayload(makePayload({ entries: [{ teamId: '1', bps: 5001, power: 5 }] }))).toBe('entry_0_bps');
    expect(parseSetTeamBoostsPayload(makePayload({ entries: [{ teamId: '1', bps: 1000, power: 10 }] }))).toBe('entry_0_power');
    expect(parseSetTeamBoostsPayload(makePayload({ entries: [{ teamId: 'abc', bps: 1000, power: 5 }] }))).toBe('entry_0_team_id');
    expect(parseSetTeamBoostsPayload(makePayload({ entries: [{ teamId: 1 as unknown as string, bps: 1000, power: 5 }] }))).toBe('entry_0_team_id');
  });
});

describe('setTeamBoostsHandler', () => {
  beforeEach(() => {
    calls.length = 0;
    mockWriteContract.mockClear();
    mockWaitForReceipt.mockReset();
    mockSimulate.mockReset();
    mockRead.mockReset();
    mockSimulate.mockImplementation(() => Promise.resolve({ request: { functionName: 'setTeamBoosts' } }));
    mockWaitForReceipt.mockImplementation(() => Promise.resolve({ status: 'success', logs: [] }));
  });

  test('simulate → write → recordTxHash → receipt, with bigint team ids', async () => {
    const ctx = makeCtx();
    const result = await setTeamBoostsHandler(makePayload(), ctx);

    expect(result).toEqual({ ok: true, txHash: '0xsetHash' });
    expect(calls).toEqual(['simulate', 'write', 'record', 'receipt']);
    expect(mockSimulate.mock.calls[0][0]).toEqual([
      5,
      [
        { teamId: 12n, bps: 5000, power: 5 },
        { teamId: 34n, bps: 1000, power: 3 },
      ],
    ]);
    expect(mockSimulate.mock.calls[0][1]).toEqual({ account: mockAccount });
    expect(mockWriteContract).toHaveBeenCalledWith({ functionName: 'setTeamBoosts' });
    expect(ctx.recordTxHash).toHaveBeenCalledWith('0xsetHash');
    expect(mockWaitForReceipt.mock.calls[0][0]).toEqual({ hash: '0xsetHash' });
  });

  test('invalid payload → dead without touching the chain', async () => {
    const result = await setTeamBoostsHandler({ epoch: 5, entries: [] }, makeCtx());
    expect(result).toEqual({ ok: false, retry: 'dead', error: 'invalid_payload: entries_empty' });
    expect(calls).toEqual([]);
  });

  test('priorTxHash with a success receipt → ok without resubmitting', async () => {
    const result = await setTeamBoostsHandler(makePayload(), makeCtx({ priorTxHash: '0xPrior' }));
    expect(result).toEqual({ ok: true, txHash: '0xPrior' });
    expect(calls).toEqual(['receipt']);
    expect(mockWaitForReceipt.mock.calls[0][0]).toMatchObject({ hash: '0xPrior', timeout: 90_000 });
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  test('priorTxHash with a reverted receipt → dead, no resubmit', async () => {
    mockWaitForReceipt.mockImplementation(() => Promise.resolve({ status: 'reverted', logs: [] }));
    const result = await setTeamBoostsHandler(makePayload(), makeCtx({ priorTxHash: '0xPrior' }));
    expect(result).toEqual({ ok: false, retry: 'dead', error: 'prior_tx_reverted' });
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  test('priorTxHash receipt timeout → transient, no resubmit', async () => {
    mockWaitForReceipt.mockImplementation(() => Promise.reject(new Error('timeout')));
    const result = await setTeamBoostsHandler(makePayload(), makeCtx({ priorTxHash: '0xPrior' }));
    expect(result).toEqual({ ok: false, retry: 'transient', error: 'prior_tx_receipt_timeout' });
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  test('InvalidBoostEpoch on simulate → dead (never retry into the wrong epoch)', async () => {
    mockSimulate.mockImplementation(() => Promise.reject(makeRevert('InvalidBoostEpoch')));
    const result = await setTeamBoostsHandler(makePayload(), makeCtx());
    expect(result).toEqual({ ok: false, retry: 'dead', error: 'revert:InvalidBoostEpoch' });
    expect(mockWriteContract).not.toHaveBeenCalled();
    expect(mockRead).not.toHaveBeenCalled();
  });

  test('BoostTooHigh / unknown reverts → dead', async () => {
    mockSimulate.mockImplementation(() => Promise.reject(makeRevert('BoostTooHigh')));
    expect(await setTeamBoostsHandler(makePayload(), makeCtx())).toEqual({ ok: false, retry: 'dead', error: 'revert:BoostTooHigh' });
    mockSimulate.mockImplementation(() => Promise.reject(makeRevert('AccessControlUnauthorizedAccount')));
    expect(await setTeamBoostsHandler(makePayload(), makeCtx())).toEqual({
      ok: false,
      retry: 'dead',
      error: 'revert:AccessControlUnauthorizedAccount',
    });
  });

  test('transport error → transient', async () => {
    mockSimulate.mockImplementation(() => Promise.reject(new Error('fetch failed')));
    expect(await setTeamBoostsHandler(makePayload(), makeCtx())).toEqual({ ok: false, retry: 'transient', error: 'fetch failed' });
  });

  test('mined-but-reverted tx → dead with tx_reverted (hash was recorded first)', async () => {
    mockWaitForReceipt.mockImplementation(() => Promise.resolve({ status: 'reverted', logs: [] }));
    const ctx = makeCtx();
    expect(await setTeamBoostsHandler(makePayload(), ctx)).toEqual({ ok: false, retry: 'dead', error: 'tx_reverted' });
    expect(calls).toEqual(['simulate', 'write', 'record', 'receipt']);
  });

  test('TxHashPersistError propagates to dispatch', async () => {
    const ctx = makeCtx({ recordTxHash: mock(() => Promise.reject(new TxHashPersistError('0xsetHash', 'db down'))) });
    await expect(setTeamBoostsHandler(makePayload(), ctx)).rejects.toBeInstanceOf(TxHashPersistError);
    expect(calls).toEqual(['simulate', 'write']);
  });
});
