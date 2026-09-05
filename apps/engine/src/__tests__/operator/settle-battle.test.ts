import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Mock @clawbada/chain ──
const mockWriteContract = mock(() => Promise.resolve('0xsettleHash'));
const mockWaitForReceipt = mock<any>();
const mockGetBattle = mock<any>();
const mockSimulateSettle = mock<any>();

mock.module('@clawbada/chain', () => ({
  getResolverClient: () => ({ account: { address: '0xResolver' }, writeContract: mockWriteContract }),
  getPublicClient: () => ({ waitForTransactionReceipt: mockWaitForReceipt }),
  getBattleArena: () => ({ read: { getBattle: mockGetBattle }, simulate: { settle: mockSimulateSettle } }),
  addresses: { battleArena: '0xBattleArenaAddress' },
  BattleArenaAbi: [],
}));

// ── Import after mocks ──
import { settleBattleHandler, type SettleBattlePayload } from '../../operator/jobs/settle-battle';
import type { JobContext } from '../../operator/types';

const HASH_A = ('0x' + 'a1'.repeat(32)) as `0x${string}`;
const HASH_B = ('0x' + 'b2'.repeat(32)) as `0x${string}`;
const ALICE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function makeCtx(overrides: Partial<JobContext> = {}): JobContext {
  return { jobId: 9n, jobType: 'settle_battle', attempts: 1, priorTxHash: null, recordTxHash: mock(() => Promise.resolve()), ...overrides };
}
function payload(overrides: Partial<SettleBattlePayload> = {}): SettleBattlePayload {
  return { battleId: '42', winner: ALICE, finalStateHash: HASH_A, turnLogHash: HASH_B, damageA: [5, 6, 7], damageB: [20, 25, 30], ...overrides };
}

beforeEach(() => {
  mockWriteContract.mockClear();
  mockWaitForReceipt.mockReset();
  mockGetBattle.mockReset();
  mockSimulateSettle.mockReset();
  mockSimulateSettle.mockImplementation(async () => ({ request: { fn: 'settle' } }));
  mockWaitForReceipt.mockImplementation(async () => ({ status: 'success' }));
});

describe('settleBattleHandler', () => {
  test('Active battle: simulates, submits with the resolver key, records the hash before the receipt, succeeds', async () => {
    mockGetBattle.mockImplementation(async () => ({ phase: 4 }));
    const ctx = makeCtx();
    const order: string[] = [];
    (ctx.recordTxHash as any).mockImplementation(async () => { order.push('record'); });
    mockWaitForReceipt.mockImplementation(async () => { order.push('receipt'); return { status: 'success' }; });

    const res = await settleBattleHandler(payload(), ctx);

    expect(res).toEqual({ ok: true, txHash: '0xsettleHash' });
    expect(mockSimulateSettle).toHaveBeenCalledTimes(1);
    const args = (mockSimulateSettle.mock.calls as any)[0][0];
    expect(args).toEqual([42n, ALICE, HASH_A, HASH_B, [5, 6, 7], [20, 25, 30]]);
    expect(mockWriteContract).toHaveBeenCalledWith({ fn: 'settle' });
    expect(ctx.recordTxHash).toHaveBeenCalledWith('0xsettleHash');
    expect(order).toEqual(['record', 'receipt']);
  });

  test("a draw settles with winner = address(0)", async () => {
    mockGetBattle.mockImplementation(async () => ({ phase: 4 }));
    const res = await settleBattleHandler(payload({ winner: 'draw', damageA: [5, 5, 5], damageB: [6, 6, 6] }), makeCtx());
    expect(res.ok).toBe(true);
    expect((mockSimulateSettle.mock.calls as any)[0][0][1]).toBe('0x0000000000000000000000000000000000000000');
  });

  test('already AwaitingFinalize or Settled on chain: idempotent success without a tx', async () => {
    for (const phase of [5, 6]) {
      mockGetBattle.mockImplementation(async () => ({ phase }));
      const res = await settleBattleHandler(payload(), makeCtx());
      expect(res).toEqual({ ok: true });
    }
    expect(mockSimulateSettle).not.toHaveBeenCalled();
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  test('a battle that is not Active (cancelled, still in reveal) is dead — nothing to settle', async () => {
    for (const phase of [3, 7]) {
      mockGetBattle.mockImplementation(async () => ({ phase }));
      const res = await settleBattleHandler(payload(), makeCtx());
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.retry).toBe('dead');
    }
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  test('priorTxHash that succeeded: reconciled from the receipt, never resubmitted', async () => {
    mockGetBattle.mockImplementation(async () => ({ phase: 4 }));
    mockWaitForReceipt.mockImplementation(async () => ({ status: 'success' }));
    const res = await settleBattleHandler(payload(), makeCtx({ priorTxHash: '0xprior' }));
    expect(res).toEqual({ ok: true, txHash: '0xprior' });
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  test('priorTxHash receipt timeout: transient, retry later', async () => {
    mockGetBattle.mockImplementation(async () => ({ phase: 4 }));
    mockWaitForReceipt.mockImplementation(async () => { throw new Error('timed out'); });
    const res = await settleBattleHandler(payload(), makeCtx({ priorTxHash: '0xprior' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.retry).toBe('transient');
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  test('a reverted receipt after our own submit is dead', async () => {
    mockGetBattle.mockImplementation(async () => ({ phase: 4 }));
    mockWaitForReceipt.mockImplementation(async () => ({ status: 'reverted' }));
    const res = await settleBattleHandler(payload(), makeCtx());
    expect(res).toEqual({ ok: false, retry: 'dead', error: 'settle_reverted' });
  });

  test('RPC failure on the phase read is transient', async () => {
    mockGetBattle.mockImplementation(async () => { throw new Error('ECONNRESET'); });
    const res = await settleBattleHandler(payload(), makeCtx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.retry).toBe('transient');
  });

  test('malformed payloads are dead without touching the chain', async () => {
    const bad: unknown[] = [
      null,
      payload({ battleId: 'abc' }),
      payload({ winner: 'bob' }),
      payload({ finalStateHash: ('0x' + '0'.repeat(64)) as `0x${string}` }),
      payload({ turnLogHash: '0x1234' as `0x${string}` }),
      payload({ damageA: [1, 2] as any }),
      payload({ damageB: [1, 2, 300] as any }),
    ];
    for (const p of bad) {
      const res = await settleBattleHandler(p, makeCtx());
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.retry).toBe('dead');
    }
    expect(mockGetBattle).not.toHaveBeenCalled();
  });
});
