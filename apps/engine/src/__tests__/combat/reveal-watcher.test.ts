import { describe, test, expect, mock } from 'bun:test';
import { RevealWatcher, ACCUSE_LEAD_SEC, type RevealWatcherDeps, type RevealOnChain } from '../../combat/reveal-watcher';
import { deriveSeedSecret, seedCommitment, teamCommitHash } from '@clawbada/chain';

const MASTER = 'reveal-watcher-test-master-secret-0123456789';

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
const ALICE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const BOB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const SALT_A = ('0x' + 'aa'.repeat(32)) as `0x${string}`;
const SALT_B = ('0x' + 'bb'.repeat(32)) as `0x${string}`;
const WRONG = ('0x' + 'cc'.repeat(32)) as `0x${string}`;
const row = (over: Record<string, unknown> = {}) => ({ battleId: 42n, teamA: 11n, teamB: 22n, queuedTeamA: 11n, queuedTeamB: 22n, revealSaltA: SALT_A, revealSaltB: SALT_B, phase: 3, ...over });
const chain = (over: Partial<RevealOnChain> = {}): RevealOnChain => ({
  phase: 3, playerA: ALICE, playerB: BOB,
  teamCommitA: teamCommitHash(42n, ALICE, 11n, SALT_A), teamCommitB: teamCommitHash(42n, BOB, 22n, SALT_B),
  phaseDeadline: 1_000n, accusedA: false, accusedB: false, openedA: false, openedB: false, ...over,
});

function makeDeps(selectResults: unknown[], onChain: RevealOnChain, now = 990n - ACCUSE_LEAD_SEC) {
  const selectChains: any[] = []; const updateChains: any[] = [];
  const writeContract = mock(async (_req: any) => '0xtxHash' as `0x${string}`);
  const waitForTransactionReceipt = mock(async () => ({ status: 'success' }));
  const getBattle = mock(async () => onChain);
  const readOpenedCommit = mock(async (_id: bigint, _p: `0x${string}`) => null as { teamId: bigint; salt: `0x${string}` } | null);
  const deps: RevealWatcherDeps = {
    db: {
      select: () => { const c = makeChain(selectResults.shift() ?? []); selectChains.push(c); return c; },
      update: () => { const c = makeChain([]); updateChains.push(c); return c; },
    },
    battles: { battleId: 'battle_id', phase: 'phase', revealSaltA: 'reveal_salt_a', revealSaltB: 'reveal_salt_b', teamA: 'team_a', teamB: 'team_b' },
    publicClient: { waitForTransactionReceipt, getBlock: async () => ({ timestamp: now }) },
    arena: { read: { getBattle } },
    readOpenedCommit,
    walletClient: { writeContract },
    battleArenaAddress: '0x00000000000000000000000000000000000000a1',
    abi: [],
    seedMasterSecret: MASTER,
    log: quiet,
    pollMs: 1,
  };
  return { deps, selectChains, updateChains, writeContract, waitForTransactionReceipt, getBattle, readOpenedCommit };
}
const calls = (w: any) => (w.mock.calls as any[]).map((c) => c[0]);

describe('RevealWatcher', () => {
  test('both stored salts open their on-chain commits: submits the atomic reveal and clears both salts', async () => {
    const d = makeDeps([[row()]], chain());
    await new RevealWatcher(d.deps).tick();
    expect(d.writeContract).toHaveBeenCalledTimes(1);
    const req = calls(d.writeContract)[0];
    expect(req.functionName).toBe('revealTeams');
    // D-01: the reveal also commits to this battle's seed secret — keccak(battleId, secret).
    expect(req.args).toEqual([42n, 11n, SALT_A, 22n, SALT_B, seedCommitment(42n, deriveSeedSecret(MASTER, 42n))]);
    expect(d.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: '0xtxHash' });
    expect(d.updateChains).toHaveLength(1);
    expect(d.updateChains[0].calls.find((c: any) => c.method === 'set')?.args[0]).toEqual({ revealSaltA: null, revealSaltB: null });
  });

  test('stale row (battle no longer in TeamReveal on-chain): clears salts without a transaction', async () => {
    const d = makeDeps([[row()]], chain({ phase: 4 }));
    await new RevealWatcher(d.deps).tick();
    expect(d.writeContract).not.toHaveBeenCalled();
    expect(d.updateChains).toHaveLength(1);
  });

  test('a failed submission keeps the salts so the next tick retries', async () => {
    const d = makeDeps([[row()]], chain());
    d.writeContract.mockRejectedValueOnce(new Error('nonce too low'));
    await new RevealWatcher(d.deps).tick(); // must not throw
    expect(d.updateChains).toHaveLength(0);
  });

  test('overlapping ticks do not double-submit the same battle', async () => {
    const d = makeDeps([[row()], [row()]], chain());
    let release!: () => void;
    d.getBattle.mockImplementationOnce(() => new Promise((res) => { release = () => res(chain()); }));
    const w = new RevealWatcher(d.deps);
    const first = w.tick();
    await new Promise((r) => setTimeout(r, 5));
    await w.tick();
    release();
    await first;
    expect(d.writeContract).toHaveBeenCalledTimes(1);
  });

  test('the query asks for every battle the indexer shows in TeamReveal', async () => {
    const d = makeDeps([[]], chain());
    await new RevealWatcher(d.deps).tick();
    const where = d.selectChains[0].calls.find((c: any) => c.method === 'where');
    expect(where).toBeDefined();
    expect(JSON.stringify(where.args)).toContain('phase');
  });
});

describe('RevealWatcher — D-14 reveal-failure attribution', () => {
  test("a stored salt that does not open the player's commit: accuses THAT player at once, does not reveal", async () => {
    const d = makeDeps([[row({ revealSaltB: WRONG })]], chain(), 500n);
    await new RevealWatcher(d.deps).tick();
    expect(d.writeContract).toHaveBeenCalledTimes(1);
    expect(calls(d.writeContract)[0]).toMatchObject({ functionName: 'accuseRevealFailure', args: [42n, BOB] });
  });

  test('no salt yet with plenty of window left: waits', async () => {
    const d = makeDeps([[row({ revealSaltA: null, teamA: 0n })]], chain(), 1_000n - ACCUSE_LEAD_SEC - 1n);
    await new RevealWatcher(d.deps).tick();
    expect(d.writeContract).not.toHaveBeenCalled();
  });

  test('no salt with ACCUSE_LEAD_SEC left: accuses the silent side only', async () => {
    const d = makeDeps([[row({ revealSaltA: null, teamA: 0n })]], chain(), 1_000n - ACCUSE_LEAD_SEC);
    await new RevealWatcher(d.deps).tick();
    expect(calls(d.writeContract)).toEqual([expect.objectContaining({ functionName: 'accuseRevealFailure', args: [42n, ALICE] })]);
  });

  test('already accused: not accused again', async () => {
    const d = makeDeps([[row({ revealSaltA: WRONG })]], chain({ accusedA: true, phaseDeadline: 1_100n }), 1_095n);
    await new RevealWatcher(d.deps).tick();
    expect(d.writeContract).not.toHaveBeenCalled();
  });

  test('the window has lapsed: nothing (handleTimeout settles it)', async () => {
    const d = makeDeps([[row({ revealSaltA: WRONG })]], chain(), 1_001n);
    await new RevealWatcher(d.deps).tick();
    expect(d.writeContract).not.toHaveBeenCalled();
  });

  test('the accused player opened their own commit: reveals with the opened (teamId, salt)', async () => {
    const d = makeDeps([[row({ revealSaltA: WRONG })]], chain({ accusedA: true, openedA: true, phaseDeadline: 1_100n }), 1_050n);
    d.readOpenedCommit.mockImplementation(async (_id, p) => (p === ALICE ? { teamId: 11n, salt: SALT_A } : null));
    await new RevealWatcher(d.deps).tick();
    const req = calls(d.writeContract)[0];
    expect(req.functionName).toBe('revealTeams');
    expect(req.args.slice(0, 5)).toEqual([42n, 11n, SALT_A, 22n, SALT_B]);
  });

  test('D-17: an opened commit for a team the player did NOT queue with is never revealed', async () => {
    const other = ('0x' + 'dd'.repeat(32)) as `0x${string}`;
    const d = makeDeps([[row({ revealSaltA: WRONG })]], chain({ teamCommitA: teamCommitHash(42n, ALICE, 99n, other), accusedA: true, openedA: true, phaseDeadline: 1_100n }), 1_050n);
    d.readOpenedCommit.mockImplementation(async () => ({ teamId: 99n, salt: other }));
    await new RevealWatcher(d.deps).tick();
    expect(d.writeContract).not.toHaveBeenCalled();
  });

  test('an accused player whose correct salt arrives through the API during the grace: revealed normally', async () => {
    const d = makeDeps([[row()]], chain({ accusedA: true, phaseDeadline: 1_100n }), 1_050n);
    await new RevealWatcher(d.deps).tick();
    expect(calls(d.writeContract)[0].functionName).toBe('revealTeams');
  });
});
