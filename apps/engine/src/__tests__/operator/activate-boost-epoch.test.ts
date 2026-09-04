import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { ContractFunctionRevertedError } from 'viem';

// ── Mock @clawbada/chain ──
const calls: string[] = [];
const mockAccount = { address: '0xBoostAdmin' };
const mockWriteContract = mock((_req: unknown) => {
  calls.push('write');
  return Promise.resolve('0xactHash');
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
      activateBoostEpoch: (...args: unknown[]) => {
        calls.push('simulate');
        return mockSimulate(...args);
      },
    },
    read: {
      currentBoostEpoch: (...args: unknown[]) => {
        calls.push('read');
        return mockRead(...args);
      },
    },
  }),
}));

// ── Import after mocks ──
import { activateBoostEpochHandler, parseActivateBoostEpochPayload } from '../../operator/jobs/activate-boost-epoch';
import type { JobContext } from '../../operator/types';

function makeCtx(overrides: Partial<JobContext> = {}): JobContext {
  return {
    jobId: 12n,
    jobType: 'activate_boost_epoch',
    attempts: 1,
    priorTxHash: null,
    recordTxHash: mock(() => {
      calls.push('record');
      return Promise.resolve();
    }),
    ...overrides,
  };
}

function makeRevert(errorName: string): Error {
  const err = Object.create(ContractFunctionRevertedError.prototype);
  err.message = `reverted: ${errorName}`;
  err.data = { errorName };
  return err as Error;
}

describe('parseActivateBoostEpochPayload', () => {
  test('validates the chain epoch', () => {
    expect(parseActivateBoostEpochPayload({ epoch: 5 })).toEqual({ epoch: 5 });
    expect(parseActivateBoostEpochPayload({ epoch: 0 })).toBe('epoch_out_of_range');
    expect(parseActivateBoostEpochPayload({ epoch: '5' })).toBe('epoch_out_of_range');
    expect(parseActivateBoostEpochPayload(undefined)).toBe('not_an_object');
  });
});

describe('activateBoostEpochHandler', () => {
  beforeEach(() => {
    calls.length = 0;
    mockWriteContract.mockClear();
    mockWaitForReceipt.mockReset();
    mockSimulate.mockReset();
    mockRead.mockReset();
    mockSimulate.mockImplementation(() => Promise.resolve({ request: { functionName: 'activateBoostEpoch' } }));
    mockWaitForReceipt.mockImplementation(() => Promise.resolve({ status: 'success', logs: [] }));
  });

  test('happy path: simulate → write → recordTxHash → receipt', async () => {
    const ctx = makeCtx();
    const result = await activateBoostEpochHandler({ epoch: 5 }, ctx);
    expect(result).toEqual({ ok: true, txHash: '0xactHash' });
    expect(calls).toEqual(['simulate', 'write', 'record', 'receipt']);
    expect(mockSimulate.mock.calls[0][0]).toEqual([5]);
    expect(mockSimulate.mock.calls[0][1]).toEqual({ account: mockAccount });
    expect(ctx.recordTxHash).toHaveBeenCalledWith('0xactHash');
  });

  test('InvalidBoostEpoch with currentBoostEpoch >= epoch → already done, ok without a tx', async () => {
    mockSimulate.mockImplementation(() => Promise.reject(makeRevert('InvalidBoostEpoch')));
    mockRead.mockImplementation(() => Promise.resolve(5));
    const result = await activateBoostEpochHandler({ epoch: 5 }, makeCtx());
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(['simulate', 'read']);
    expect(mockWriteContract).not.toHaveBeenCalled();

    // Also past it (a later epoch went live meanwhile).
    mockRead.mockImplementation(() => Promise.resolve(7n));
    expect(await activateBoostEpochHandler({ epoch: 5 }, makeCtx())).toEqual({ ok: true });
  });

  test('InvalidBoostEpoch with currentBoostEpoch < epoch - 1 → dead', async () => {
    mockSimulate.mockImplementation(() => Promise.reject(makeRevert('InvalidBoostEpoch')));
    mockRead.mockImplementation(() => Promise.resolve(3));
    const result = await activateBoostEpochHandler({ epoch: 5 }, makeCtx());
    expect(result).toEqual({ ok: false, retry: 'dead', error: 'revert:InvalidBoostEpoch' });
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  test('other reverts → dead without consulting the chain; transport → transient', async () => {
    mockSimulate.mockImplementation(() => Promise.reject(makeRevert('AccessControlUnauthorizedAccount')));
    expect(await activateBoostEpochHandler({ epoch: 5 }, makeCtx())).toEqual({
      ok: false,
      retry: 'dead',
      error: 'revert:AccessControlUnauthorizedAccount',
    });
    expect(calls).toEqual(['simulate']);

    calls.length = 0;
    mockSimulate.mockImplementation(() => Promise.reject(new Error('socket hang up')));
    expect(await activateBoostEpochHandler({ epoch: 5 }, makeCtx())).toEqual({ ok: false, retry: 'transient', error: 'socket hang up' });
  });

  test('a failing currentBoostEpoch read during classification is transient', async () => {
    mockSimulate.mockImplementation(() => Promise.reject(makeRevert('InvalidBoostEpoch')));
    mockRead.mockImplementation(() => Promise.reject(new Error('rpc 503')));
    expect(await activateBoostEpochHandler({ epoch: 5 }, makeCtx())).toEqual({ ok: false, retry: 'transient', error: 'rpc 503' });
  });

  test('priorTxHash: success → ok; reverted but live → ok; reverted and not live → dead', async () => {
    expect(await activateBoostEpochHandler({ epoch: 5 }, makeCtx({ priorTxHash: '0xPrior' }))).toEqual({ ok: true, txHash: '0xPrior' });
    expect(mockWriteContract).not.toHaveBeenCalled();

    mockWaitForReceipt.mockImplementation(() => Promise.resolve({ status: 'reverted', logs: [] }));
    mockRead.mockImplementation(() => Promise.resolve(5));
    expect(await activateBoostEpochHandler({ epoch: 5 }, makeCtx({ priorTxHash: '0xPrior' }))).toEqual({ ok: true });

    mockRead.mockImplementation(() => Promise.resolve(4));
    expect(await activateBoostEpochHandler({ epoch: 5 }, makeCtx({ priorTxHash: '0xPrior' }))).toEqual({
      ok: false,
      retry: 'dead',
      error: 'prior_tx_reverted',
    });
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  test('mined-but-reverted tx: ok if the epoch is live, otherwise dead', async () => {
    mockWaitForReceipt.mockImplementation(() => Promise.resolve({ status: 'reverted', logs: [] }));
    mockRead.mockImplementation(() => Promise.resolve(5));
    expect(await activateBoostEpochHandler({ epoch: 5 }, makeCtx())).toEqual({ ok: true, txHash: '0xactHash' });

    mockRead.mockImplementation(() => Promise.resolve(4));
    expect(await activateBoostEpochHandler({ epoch: 5 }, makeCtx())).toEqual({ ok: false, retry: 'dead', error: 'tx_reverted' });
  });

  test('invalid payload → dead without touching the chain', async () => {
    expect(await activateBoostEpochHandler({ epoch: -1 }, makeCtx())).toEqual({
      ok: false,
      retry: 'dead',
      error: 'invalid_payload: epoch_out_of_range',
    });
    expect(calls).toEqual([]);
  });
});
