import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { FinalizeWatcher, type FinalizeWatcherDeps } from '../../combat/finalize-watcher';

function makeChain(result: unknown) {
  const proxy: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, ko);
      if (typeof prop === 'symbol') return undefined;
      return () => proxy;
    },
  });
  return proxy;
}

const quiet = { child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) } as any;

function makeDeps(rows: Array<{ battleId: bigint }>, chain: { phase: number; payoutDeadline: bigint; disputed?: boolean }, now: bigint) {
  const writeContract = mock(async () => '0xfinalizeHash' as `0x${string}`);
  const waitForTransactionReceipt = mock(async () => ({ status: 'success' }));
  const finalizeBattle = mock(async () => ({ request: { fn: 'finalizeBattle' } }));
  const getBattle = mock(async () => ({ disputed: false, ...chain }));
  const deps: FinalizeWatcherDeps = {
    db: { select: () => makeChain(rows) },
    battles: { battleId: 'battle_id', phase: 'phase', settledAt: 'settled_at' },
    publicClient: { getBlock: async () => ({ timestamp: now }), waitForTransactionReceipt },
    arena: { read: { getBattle }, simulate: { finalizeBattle } },
    walletClient: { account: { address: '0x00000000000000000000000000000000000000ee' }, writeContract },
    log: quiet,
    pollMs: 1,
  };
  return { deps, writeContract, waitForTransactionReceipt, finalizeBattle, getBattle };
}

describe('FinalizeWatcher', () => {
  test('dispute window still open (chain time): no transaction', async () => {
    const { deps, finalizeBattle, writeContract } = makeDeps([{ battleId: 7n }], { phase: 5, payoutDeadline: 1_000n }, 900n);
    await new FinalizeWatcher(deps).tick();
    expect(finalizeBattle).not.toHaveBeenCalled();
    expect(writeContract).not.toHaveBeenCalled();
  });

  test('window closed: simulates as the operator, submits finalizeBattle once, waits for the receipt', async () => {
    const { deps, finalizeBattle, writeContract, waitForTransactionReceipt } = makeDeps([{ battleId: 7n }], { phase: 5, payoutDeadline: 1_000n }, 1_001n);
    await new FinalizeWatcher(deps).tick();
    expect(finalizeBattle).toHaveBeenCalledTimes(1);
    expect((finalizeBattle.mock.calls as any)[0][0]).toEqual([7n]);
    expect((finalizeBattle.mock.calls as any)[0][1]).toEqual({ account: deps.walletClient.account });
    expect(writeContract).toHaveBeenCalledWith({ fn: 'finalizeBattle' });
    expect(waitForTransactionReceipt).toHaveBeenCalledWith({ hash: '0xfinalizeHash' });
  });

  test('disputed battle is left to adminResolveDispute', async () => {
    const { deps, writeContract } = makeDeps([{ battleId: 7n }], { phase: 5, payoutDeadline: 1_000n, disputed: true }, 5_000n);
    await new FinalizeWatcher(deps).tick();
    expect(writeContract).not.toHaveBeenCalled();
  });

  test('already settled on-chain (indexer lagging): skipped', async () => {
    const { deps, writeContract } = makeDeps([{ battleId: 7n }], { phase: 6, payoutDeadline: 1_000n }, 5_000n);
    await new FinalizeWatcher(deps).tick();
    expect(writeContract).not.toHaveBeenCalled();
  });

  test('a benign revert in simulation (someone else finalized) is swallowed; other errors are logged and retried', async () => {
    const a = makeDeps([{ battleId: 7n }], { phase: 5, payoutDeadline: 1_000n }, 5_000n);
    a.finalizeBattle.mockRejectedValueOnce(new Error('execution reverted: InvalidBattlePhase(7, 5, 6)'));
    await new FinalizeWatcher(a.deps).tick();
    expect(a.writeContract).not.toHaveBeenCalled();

    const b = makeDeps([{ battleId: 8n }], { phase: 5, payoutDeadline: 1_000n }, 5_000n);
    b.finalizeBattle.mockRejectedValueOnce(new Error('connection refused'));
    await new FinalizeWatcher(b.deps).tick(); // must not throw
    expect(b.writeContract).not.toHaveBeenCalled();
    await new FinalizeWatcher(b.deps).tick(); // next tick retries
    expect(b.writeContract).toHaveBeenCalledTimes(1);
  });

  test('overlapping ticks do not double-finalize the same battle', async () => {
    const { deps, writeContract, getBattle } = makeDeps([{ battleId: 7n }], { phase: 5, payoutDeadline: 1_000n }, 5_000n);
    let release!: () => void;
    getBattle.mockImplementationOnce(() => new Promise((res) => { release = () => res({ phase: 5, payoutDeadline: 1_000n, disputed: false }); }));
    const w = new FinalizeWatcher(deps);
    const first = w.tick();
    await new Promise((r) => setTimeout(r, 5));
    await w.tick();
    release();
    await first;
    expect(writeContract).toHaveBeenCalledTimes(1);
  });
});
