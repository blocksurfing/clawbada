import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { ContractFunctionRevertedError } from 'viem';

// ── Mock @clawbada/chain ──
//
// The handler's chain surface: getOperatorClient (writeContract),
// getPublicClient (waitForTransactionReceipt / getTransactionReceipt),
// getBattleArena (simulate.createBattle), plus addresses.battleArena +
// BattleArenaAbi for log decoding.

const mockOperatorAccount = { address: '0xOperator' };
const mockWriteContract = mock(() => Promise.resolve('0xhandlerHash'));
const mockWaitForReceipt = mock<any>();
const mockGetReceipt = mock<any>();
const mockSimulate = mock<any>();

mock.module('@clawbada/chain', () => ({
  getOperatorClient: () => ({
    account: mockOperatorAccount,
    writeContract: mockWriteContract,
  }),
  // Codex cross-cutting HIGH-1: handlers now use role-specific clients;
  // mock them to the same writeContract spy so the test fixtures keep
  // working without rewriting per-test setup.
  getMatchmakerClient: () => ({
    account: mockOperatorAccount,
    writeContract: mockWriteContract,
  }),
  getResolverClient: () => ({
    account: mockOperatorAccount,
    writeContract: mockWriteContract,
  }),
  getPublicClient: () => ({
    waitForTransactionReceipt: mockWaitForReceipt,
    getTransactionReceipt: mockGetReceipt,
  }),
  getBattleArena: () => ({
    simulate: { createBattle: mockSimulate },
  }),
  addresses: { battleArena: '0xBattleArenaAddress' },
  BattleArenaAbi: [],
}));

// ── Mock @clawbada/db ──
const dbUpdates: { table: string; set: Record<string, unknown> }[] = [];
mock.module('@clawbada/db', () => ({
  db: {
    update: (table: any) => ({
      set: (args: Record<string, unknown>) => ({
        where: () => {
          dbUpdates.push({ table: table?._?.name ?? 'unknown', set: args });
          return Promise.resolve();
        },
      }),
    }),
  },
  battles: { _: { name: 'battles' }, battleId: 'battle_id' },
}));

// ── Import after mocks ──
import { createBattleHandler, type CreateBattlePayload } from '../../operator/jobs/create-battle';
import type { JobContext } from '../../operator/types';

function makeCtx(overrides: Partial<JobContext> = {}): JobContext {
  return {
    jobId: 1n,
    jobType: 'create_battle',
    attempts: 1,
    priorTxHash: null,
    recordTxHash: mock(() => Promise.resolve()),
    ...overrides,
  };
}

function makePayload(overrides: Partial<CreateBattlePayload> = {}): CreateBattlePayload {
  return {
    predictedBattleId: '42',
    playerA: '0xaaaa',
    playerB: '0xbbbb',
    stakeWei: '2500000000000000000000',
    stakeBracket: 0,
    powerA: 5,
    powerB: 5,
    enqueuedAtMsA: 1000,
    enqueuedAtMsB: 2000,
    queueIdA: 'qA',
    queueIdB: 'qB',
    ...overrides,
  };
}

function makeRevert(errorName: string): Error {
  const err = Object.create(ContractFunctionRevertedError.prototype);
  err.message = `reverted: ${errorName}`;
  err.data = { errorName };
  return err as Error;
}

describe('createBattleHandler', () => {
  beforeEach(() => {
    dbUpdates.length = 0;
    mockWriteContract.mockReset();
    mockWaitForReceipt.mockReset();
    mockGetReceipt.mockReset();
    mockSimulate.mockReset();
    mockWriteContract.mockImplementation(() => Promise.resolve('0xhandlerHash'));
    mockSimulate.mockImplementation(() => Promise.resolve({ request: { functionName: 'createBattle' } }));
  });

  test('receipt status=reverted → dead with tx_reverted + markCreateFailed UPDATE', async () => {
    mockWaitForReceipt.mockImplementation(() => Promise.resolve({ status: 'reverted', logs: [] }));

    const result = await createBattleHandler(makePayload(), makeCtx());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retry).toBe('dead');
      expect(result.error).toBe('tx_reverted');
    }
    const failedUpdate = dbUpdates.find((u) => u.set.status === 4);
    expect(failedUpdate).toBeDefined();
  });

  test('receipt missing BattleCreated event → dead with event_missing', async () => {
    // Receipt is successful but has no decodable BattleArena logs.
    mockWaitForReceipt.mockImplementation(() =>
      Promise.resolve({
        status: 'success',
        // Log from a different address — findBattleCreatedEvent skips it.
        logs: [{ address: '0xOtherContract', data: '0x', topics: ['0xtopic'] }],
      }),
    );

    const result = await createBattleHandler(makePayload(), makeCtx());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retry).toBe('dead');
      expect(result.error).toBe('event_missing');
    }
    const failedUpdate = dbUpdates.find((u) => u.set.status === 4);
    expect(failedUpdate).toBeDefined();
  });

  test('simulate revert with permanent error name → dead + markCreateFailed', async () => {
    // Simulate the contract reverting with InvalidPowerScore (e.g., team's
    // lobsters were swapped between matchmaker prediction and worker run).
    mockSimulate.mockImplementation(() => Promise.reject(makeRevert('InvalidPowerScore')));

    const result = await createBattleHandler(makePayload(), makeCtx());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retry).toBe('dead');
      expect(result.error).toBe('revert:InvalidPowerScore');
    }
    const failedUpdate = dbUpdates.find((u) => u.set.status === 4);
    expect(failedUpdate).toBeDefined();
  });

  test('RPC failure → transient, NO markCreateFailed UPDATE', async () => {
    // Plain Error (not a revert) — transient. Should NOT mark the row failed
    // because the next attempt may succeed.
    mockSimulate.mockImplementation(() => Promise.reject(new Error('network timeout')));

    const result = await createBattleHandler(makePayload(), makeCtx());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retry).toBe('transient');
      expect(result.error).toBe('network timeout');
    }
    const failedUpdate = dbUpdates.find((u) => u.set.status === 4);
    expect(failedUpdate).toBeUndefined();
  });

  test('priorTxHash with successful receipt → reconciles, skips resubmit', async () => {
    // HIGH-1 fix: handler now uses waitForTransactionReceipt for the
    // priorTxHash path. Mock it to return success so the handler skips
    // the resubmit path entirely. The receipt has no decodable
    // BattleCreated event for simplicity → finalize lands at
    // event_missing → markCreateFailed. The point of this test is just
    // that writeContract is NOT called.
    mockWaitForReceipt.mockImplementation(() =>
      Promise.resolve({ status: 'success', logs: [] }),
    );

    await createBattleHandler(
      makePayload(),
      makeCtx({ priorTxHash: '0xPriorHash' }),
    );

    expect(mockWriteContract).not.toHaveBeenCalled();
    const failedUpdate = dbUpdates.find((u) => u.set.status === 4);
    expect(failedUpdate).toBeDefined();
  });

  test('HIGH-1: priorTxHash with reverted receipt → dead with prior_tx_reverted (no resubmit)', async () => {
    mockWaitForReceipt.mockImplementation(() =>
      Promise.resolve({ status: 'reverted', logs: [] }),
    );

    const result = await createBattleHandler(
      makePayload(),
      makeCtx({ priorTxHash: '0xRevertedHash' }),
    );

    expect(mockWriteContract).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retry).toBe('dead');
      expect(result.error).toBe('prior_tx_reverted');
    }
    const failedUpdate = dbUpdates.find((u) => u.set.status === 4);
    expect(failedUpdate).toBeDefined();
  });

  test('HIGH-1: priorTxHash with receipt-wait timeout → transient (no resubmit)', async () => {
    // Bounded waitForTransactionReceipt timed out — the tx may still be
    // pending. NEVER resubmit; return transient so the next attempt waits
    // again on the same hash. Pre-fix this fell through to a fresh
    // writeContract, risking double-create on chain.
    mockWaitForReceipt.mockImplementation(() => Promise.reject(new Error('timeout')));

    const result = await createBattleHandler(
      makePayload(),
      makeCtx({ priorTxHash: '0xPendingHash' }),
    );

    expect(mockWriteContract).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retry).toBe('transient');
      expect(result.error).toBe('prior_tx_receipt_timeout');
    }
    // No markCreateFailed UPDATE — transient retries shouldn't poison
    // the row.
    const failedUpdate = dbUpdates.find((u) => u.set.status === 4);
    expect(failedUpdate).toBeUndefined();
  });
});
