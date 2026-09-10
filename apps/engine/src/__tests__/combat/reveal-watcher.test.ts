import { describe, test, expect, mock } from 'bun:test';
import { RevealWatcher, type RevealWatcherDeps } from '../../combat/reveal-watcher';

function makeChain(result: unknown) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const proxy: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, ko);
      if (prop === 'calls') return calls;
      if (typeof prop === 'symbol') return undefined;
      return (...args: unknown[]) => { calls.push({ method: String(prop), args }); return proxy; };
    },
  });
  return proxy;
}
const quiet = { child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) } as any;
const SALT_A = ('0x' + 'aa'.repeat(32)) as `0x${string}`;
const SALT_B = ('0x' + 'bb'.repeat(32)) as `0x${string}`;
const row = (over: Record<string, unknown> = {}) => ({ battleId: 42n, teamA: 11n, teamB: 22n, revealSaltA: SALT_A, revealSaltB: SALT_B, phase: 3, ...over });

function makeDeps(selectResults: unknown[], chainPhase: number) {
  const selectChains: any[] = []; const updateChains: any[] = [];
  const writeContract = mock(async () => '0xrevealHash' as `0x${string}`);
  const waitForTransactionReceipt = mock(async () => ({ status: 'success' }));
  const getBattle = mock(async () => ({ phase: chainPhase }));
  const deps: RevealWatcherDeps = {
    db: {
      select: () => { const c = makeChain(selectResults.shift() ?? []); selectChains.push(c); return c; },
      update: () => { const c = makeChain([]); updateChains.push(c); return c; },
    },
    battles: { battleId: 'battle_id', phase: 'phase', revealSaltA: 'reveal_salt_a', revealSaltB: 'reveal_salt_b', teamA: 'team_a', teamB: 'team_b' },
    publicClient: { waitForTransactionReceipt },
    arena: { read: { getBattle } },
    walletClient: { writeContract },
    battleArenaAddress: '0x00000000000000000000000000000000000000a1',
    abi: [],
    log: quiet,
    pollMs: 1,
  };
  return { deps, selectChains, updateChains, writeContract, waitForTransactionReceipt, getBattle };
}

describe('RevealWatcher', () => {
  test('submits the atomic reveal with the injected RESOLVER signer and clears both salts after the receipt', async () => {
    const d = makeDeps([[row()]], 3);
    await new RevealWatcher(d.deps).tick();
    expect(d.writeContract).toHaveBeenCalledTimes(1);
    const req = (d.writeContract.mock.calls as any)[0][0];
    expect(req.functionName).toBe('revealTeams');
    expect(req.args).toEqual([42n, 11n, SALT_A, 22n, SALT_B]);
    expect(d.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: '0xrevealHash' });
    expect(d.updateChains).toHaveLength(1);
    expect(d.updateChains[0].calls.find((c: any) => c.method === 'set')?.args[0]).toEqual({ revealSaltA: null, revealSaltB: null });
  });

  test('stale row (battle no longer in TeamReveal on-chain): clears salts without a transaction', async () => {
    const d = makeDeps([[row()]], 4);
    await new RevealWatcher(d.deps).tick();
    expect(d.writeContract).not.toHaveBeenCalled();
    expect(d.updateChains).toHaveLength(1);
  });

  test('a failed submission keeps the salts so the next tick retries', async () => {
    const d = makeDeps([[row()]], 3);
    d.writeContract.mockRejectedValueOnce(new Error('nonce too low'));
    await new RevealWatcher(d.deps).tick(); // must not throw
    expect(d.updateChains).toHaveLength(0);
  });

  test('overlapping ticks do not double-submit the same battle', async () => {
    const d = makeDeps([[row()], [row()]], 3);
    let release!: () => void;
    d.getBattle.mockImplementationOnce(() => new Promise((res) => { release = () => res({ phase: 3 }); }));
    const w = new RevealWatcher(d.deps);
    const first = w.tick();
    await new Promise((r) => setTimeout(r, 5));
    await w.tick();
    release();
    await first;
    expect(d.writeContract).toHaveBeenCalledTimes(1);
  });

  test('the query only asks for battles the indexer still shows in TeamReveal', async () => {
    const d = makeDeps([[]], 3);
    await new RevealWatcher(d.deps).tick();
    const where = d.selectChains[0].calls.find((c: any) => c.method === 'where');
    expect(where).toBeDefined();
    expect(JSON.stringify(where.args)).toContain('phase');
  });
});
