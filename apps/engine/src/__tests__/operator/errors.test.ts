import { describe, test, expect } from 'bun:test';
import { ContractFunctionRevertedError } from 'viem';
import { classifyError, wrapHandler } from '../../operator/errors';
import { TxHashPersistError, type JobContext, type JobResult } from '../../operator/types';

// Construct a viem-compatible ContractFunctionRevertedError with a given
// error name. viem's constructor signature is unstable across versions, so
// we cast to bypass strict typing — only `data.errorName` matters for
// classifyError's matching path.
function makeRevert(errorName: string): Error {
  const err = Object.create(ContractFunctionRevertedError.prototype);
  err.message = `reverted: ${errorName}`;
  err.data = { errorName };
  return err as Error;
}

function makeCtx(overrides: Partial<JobContext> = {}): JobContext {
  return {
    jobId: 1n,
    jobType: 'test',
    attempts: 1,
    priorTxHash: null,
    recordTxHash: async () => {},
    ...overrides,
  };
}

describe('classifyError', () => {
  test('permanent revert names → dead', () => {
    const result = classifyError(makeRevert('InvalidPowerScore'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retry).toBe('dead');
      expect(result.error).toBe('revert:InvalidPowerScore');
    }
  });

  test('unknown revert name → still dead (contract said no)', () => {
    const result = classifyError(makeRevert('SomeUnregisteredError'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retry).toBe('dead');
      expect(result.error).toBe('revert:SomeUnregisteredError');
    }
  });

  test('plain Error → transient', () => {
    const result = classifyError(new Error('rpc timeout'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retry).toBe('transient');
      expect(result.error).toBe('rpc timeout');
    }
  });

  test('non-Error → transient with stringified message', () => {
    const result = classifyError('weird');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retry).toBe('transient');
      expect(result.error).toBe('weird');
    }
  });

  test('TxHashPersistError → dead with explicit marker (defensive)', () => {
    // classifyError shouldn't be the catcher for TxHashPersistError —
    // dispatch handles that specifically. But if it ends up here, return
    // dead with a clear marker so a buggy caller produces an obvious
    // failure instead of silent transient-retry-then-lose-hash.
    const result = classifyError(new TxHashPersistError('0xabc', new Error('db down')));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retry).toBe('dead');
      expect(result.error).toContain('tx_hash_persist_in_classify');
    }
  });

  test('walks the error cause chain', () => {
    const inner = makeRevert('TeamPowerChanged');
    const outer = new Error('outer wrapper');
    (outer as { cause?: unknown }).cause = inner;
    const result = classifyError(outer);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retry).toBe('dead');
      expect(result.error).toBe('revert:TeamPowerChanged');
    }
  });
});

describe('wrapHandler', () => {
  test('passes through ok results', async () => {
    const inner = async () => ({ ok: true, txHash: '0xabc' }) satisfies JobResult;
    const wrapped = wrapHandler(inner);
    const result = await wrapped({}, makeCtx());
    expect(result.ok).toBe(true);
  });

  test('passes through explicit dead results', async () => {
    const inner = async () => ({ ok: false, retry: 'dead', error: 'explicit_dead' }) satisfies JobResult;
    const wrapped = wrapHandler(inner);
    const result = await wrapped({}, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('explicit_dead');
  });

  test('thrown revert classifies as dead', async () => {
    const inner = async () => {
      throw makeRevert('InvalidPowerScore');
    };
    const wrapped = wrapHandler(inner);
    const result = await wrapped({}, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retry).toBe('dead');
      expect(result.error).toBe('revert:InvalidPowerScore');
    }
  });

  test('thrown plain Error classifies as transient', async () => {
    const inner = async () => {
      throw new Error('network');
    };
    const wrapped = wrapHandler(inner);
    const result = await wrapped({}, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retry).toBe('transient');
  });

  test('TxHashPersistError propagates (dispatch handles separately)', async () => {
    const inner = async () => {
      throw new TxHashPersistError('0xdeadbeef', new Error('db down'));
    };
    const wrapped = wrapHandler(inner);
    await expect(wrapped({}, makeCtx())).rejects.toBeInstanceOf(TxHashPersistError);
  });

  describe('FU-4: malformed return validation', () => {
    test.each([
      ['undefined', undefined as unknown],
      ['null', null as unknown],
      ['empty object', {} as unknown],
      ['ok=string', { ok: 'true' } as unknown],
      ['ok=false missing retry', { ok: false, error: 'x' } as unknown],
      ['ok=false invalid retry', { ok: false, retry: 'maybe', error: 'x' } as unknown],
      ['ok=false missing error', { ok: false, retry: 'dead' } as unknown],
      ['ok=true with non-string txHash', { ok: true, txHash: 123 } as unknown],
    ])('rejects %s as dead malformed_handler_result', async (_label, badResult) => {
      const inner = async () => badResult as JobResult;
      const wrapped = wrapHandler(inner);
      const result = await wrapped({}, makeCtx());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.retry).toBe('dead');
        expect(result.error).toContain('malformed_handler_result');
      }
    });

    test('valid {ok: true} passes', async () => {
      const inner = async () => ({ ok: true }) satisfies JobResult;
      const wrapped = wrapHandler(inner);
      const result = await wrapped({}, makeCtx());
      expect(result.ok).toBe(true);
    });

    test('valid {ok: true, txHash}', async () => {
      const inner = async () => ({ ok: true, txHash: '0xabc' }) satisfies JobResult;
      const wrapped = wrapHandler(inner);
      const result = await wrapped({}, makeCtx());
      expect(result.ok).toBe(true);
    });

    test('valid {ok: false, retry: dead, error}', async () => {
      const inner = async () => ({ ok: false, retry: 'dead', error: 'x' }) satisfies JobResult;
      const wrapped = wrapHandler(inner);
      const result = await wrapped({}, makeCtx());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('x');
    });
  });
});
