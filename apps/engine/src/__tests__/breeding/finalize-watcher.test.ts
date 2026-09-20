import { describe, test, expect, mock } from 'bun:test';
import { BreedFinalizeWatcher, BLOCKHASH_WINDOW, type BreedFinalizeWatcherDeps, type BreedRequestView } from '../../breeding/finalize-watcher';

const quiet = { child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) } as any;
const REQUESTER = '0x00000000000000000000000000000000000000a1' as const;

/** A fake BreedingLab: requests by id, a head block, and a record of what the keeper did. */
function world(requests: Record<number, Partial<BreedRequestView>>, head: bigint) {
  const reqs = new Map<bigint, BreedRequestView>();
  for (const [id, r] of Object.entries(requests)) reqs.set(BigInt(id), { requester: REQUESTER, finalized: false, targetBlock: 0n, ...r });
  const reads: bigint[] = [];
  const finalized: bigint[] = [];
  const state = { head, simulateError: null as null | ((id: bigint) => string | null), receiptStatus: 'success' };
  const deps: BreedFinalizeWatcherDeps = {
    publicClient: {
      getBlockNumber: async () => state.head,
      waitForTransactionReceipt: mock(async () => ({ status: state.receiptStatus })),
    },
    lab: {
      read: {
        nextRequestId: async () => BigInt(Math.max(0, ...[...reqs.keys()].map(Number)) + 1),
        getBreedRequest: async ([id]) => { reads.push(id); return reqs.get(id)!; },
      },
      simulate: {
        finalizeBreed: async ([id], opts) => {
          const e = state.simulateError?.(id);
          if (e) throw new Error(e);
          return { request: { id, gas: opts.gas } };
        },
      },
    },
    walletClient: {
      account: { address: REQUESTER },
      writeContract: mock(async (request: any) => {
        if (state.receiptStatus === 'success') { reqs.get(request.id)!.finalized = true; finalized.push(request.id); }
        return '0xhash' as `0x${string}`;
      }),
    },
    log: quiet,
  };
  return { deps, reqs, reads, finalized, state };
}

describe('BreedFinalizeWatcher (D-21)', () => {
  test('finalizes every request whose target block has passed, oldest first, and leaves the early one', async () => {
    const w = world({ 1: { finalized: true, targetBlock: 90n }, 2: { targetBlock: 95n }, 3: { targetBlock: 98n }, 4: { targetBlock: 100n } }, 100n);
    await new BreedFinalizeWatcher(w.deps).tick();
    expect(w.finalized).toEqual([2n, 3n]);              // 4: head == targetBlock → its blockhash does not exist yet (B-01)
    w.state.head = 101n;
    await new BreedFinalizeWatcher(w.deps).tick();
    expect(w.finalized).toEqual([2n, 3n, 4n]);
  });

  test('sends enough gas for the contract\'s D-22 floor', async () => {
    const w = world({ 1: { targetBlock: 95n } }, 100n);
    await new BreedFinalizeWatcher(w.deps).tick();
    const req = (w.deps.walletClient.writeContract as any).mock.calls[0][0];
    expect(req.gas).toBeGreaterThanOrEqual(500_000n);
  });

  test('a request past the 256-block window is reported as forfeited and skipped — it cannot block the queue', async () => {
    const head = 1_000n;
    const w = world({ 1: { targetBlock: head - BLOCKHASH_WINDOW - 1n }, 2: { targetBlock: head - 5n } }, head);
    const watcher = new BreedFinalizeWatcher(w.deps);
    await watcher.tick();
    expect(w.finalized).toEqual([2n]);
  });

  test('exactly at the edge of the window it still finalizes', async () => {
    const head = 1_000n;
    const w = world({ 1: { targetBlock: head - BLOCKHASH_WINDOW } }, head);
    await new BreedFinalizeWatcher(w.deps).tick();
    expect(w.finalized).toEqual([1n]);
  });

  test('restart: scans back only as far as requests that can still be saved, not the whole history', async () => {
    const head = 100_000n;
    const old: Record<number, Partial<BreedRequestView>> = {};
    for (let i = 1; i <= 500; i++) old[i] = { finalized: true, targetBlock: BigInt(i) };   // ancient history
    old[501] = { targetBlock: head - 10n };
    old[502] = { targetBlock: head - 3n };
    const w = world(old, head);
    await new BreedFinalizeWatcher(w.deps).tick();
    expect(w.finalized).toEqual([501n, 502n]);
    expect(w.reads.length).toBeLessThan(10);             // not 500+
  });

  test('someone else finalizing first is fine; a transient failure is retried in order, never skipped', async () => {
    const w = world({ 1: { targetBlock: 95n }, 2: { targetBlock: 96n } }, 100n);
    w.state.simulateError = (id) => (id === 1n ? 'RequestAlreadyFinalized(1)' : null);
    const watcher = new BreedFinalizeWatcher(w.deps);
    await watcher.tick();
    expect(w.finalized).toEqual([2n]);

    const w2 = world({ 1: { targetBlock: 95n }, 2: { targetBlock: 96n } }, 100n);
    w2.state.simulateError = (id) => (id === 1n ? 'rpc timeout' : null);
    const watcher2 = new BreedFinalizeWatcher(w2.deps);
    await watcher2.tick();
    expect(w2.finalized).toEqual([]);                    // did NOT jump ahead to #2 and forget #1
    w2.state.simulateError = null;
    await watcher2.tick();
    expect(w2.finalized).toEqual([1n, 2n]);
  });

  test('a reverted transaction is retried', async () => {
    const w = world({ 1: { targetBlock: 95n } }, 100n);
    w.state.receiptStatus = 'reverted';
    const watcher = new BreedFinalizeWatcher(w.deps);
    await watcher.tick();
    expect(w.finalized).toEqual([]);
    w.state.receiptStatus = 'success';
    await watcher.tick();
    expect(w.finalized).toEqual([1n]);
  });

  test('no requests at all is a no-op', async () => {
    const w = world({}, 100n);
    await new BreedFinalizeWatcher(w.deps).tick();
    expect(w.finalized).toEqual([]);
  });
});
