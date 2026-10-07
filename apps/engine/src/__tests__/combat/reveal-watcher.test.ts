import { describe, test, expect, mock } from 'bun:test';
import { RevealWatcher, ACCUSE_LEAD_SEC, decodeRevert, type RevealWatcherDeps, type RevealOnChain } from '../../combat/reveal-watcher';
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
const ARENA = '0x00000000000000000000000000000000000000a1' as const;
const CHAIN_ID = 84532;
const row = (over: Record<string, unknown> = {}) => ({ battleId: 42n, teamA: 11n, teamB: 22n, queuedTeamA: 11n, queuedTeamB: 22n, revealSaltA: SALT_A, revealSaltB: SALT_B, phase: 3, ...over });
const chain = (over: Partial<RevealOnChain> = {}): RevealOnChain => ({
  phase: 3, playerA: ALICE, playerB: BOB,
  teamCommitA: teamCommitHash(CHAIN_ID, ARENA, 42n, ALICE, 11n, SALT_A), teamCommitB: teamCommitHash(CHAIN_ID, ARENA, 42n, BOB, 22n, SALT_B),
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
    battleArenaAddress: ARENA,
    chainId: CHAIN_ID,
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
    const d = makeDeps([[row({ revealSaltA: WRONG })]], chain({ teamCommitA: teamCommitHash(CHAIN_ID, ARENA, 42n, ALICE, 99n, other), accusedA: true, openedA: true, phaseDeadline: 1_100n }), 1_050n);
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

// ── Review 2026-10-03: reveal failures that are the server's (or the chain's), not the player's ──

/** `makeDeps` with a log that records (message, fields) pairs. */
function makeDepsLogged(selectResults: unknown[], onChain: RevealOnChain, now?: bigint) {
  const lines: Array<{ level: string; msg: string; fields: any }> = [];
  const rec = (level: string) => (fields: any, msg: string) => { lines.push({ level, msg, fields }); };
  const log = { child: () => ({ info: rec('info'), warn: rec('warn'), error: rec('error'), debug: rec('debug') }) } as any;
  const d = makeDeps(selectResults, onChain, now);
  d.deps.log = log;
  return { ...d, lines };
}
const revertWith = (errorName: string, args: unknown[]) => Object.assign(new Error(`reverted: ${errorName}`), { cause: { data: { errorName, args } } });

describe('RevealWatcher — a reveal the API refused (D-17) is never accused', () => {
  test('no usable salt but a recorded refusal, late in the window: no accusation, reveal_refused_not_accused logged', async () => {
    const d = makeDepsLogged([[row({ revealSaltB: null, teamB: 0n, revealRefusedB: 'teamId 7 is not the queued team' })]], chain(), 1_000n - ACCUSE_LEAD_SEC);
    await new RevealWatcher(d.deps).tick();
    expect(d.writeContract).not.toHaveBeenCalled();
    const line = d.lines.find((l) => l.msg.startsWith('reveal_refused_not_accused'));
    expect(line).toBeDefined();
    expect(line!.fields).toMatchObject({ battleId: '42', side: 'B', reason: 'teamId 7 is not the queued team' });
  });

  test('a refusal on record does not shield a WRONG salt that is on record too — but it does: no usable salt is no usable salt', async () => {
    // Belt and braces: a stale wrong salt plus a later refusal still counts as "the server
    // refused this side's reveal"; the player had no path to a usable salt through the API.
    const d = makeDepsLogged([[row({ revealSaltA: WRONG, revealRefusedA: 'no queued team on record' })]], chain(), 500n);
    await new RevealWatcher(d.deps).tick();
    expect(d.writeContract).not.toHaveBeenCalled();
  });

  test('a refused side whose usable salt arrives later is revealed normally (the refusal is moot)', async () => {
    const d = makeDeps([[row({ revealRefusedA: 'teamId 7 is not the queued team' })]], chain());
    await new RevealWatcher(d.deps).tick();
    expect(calls(d.writeContract)[0].functionName).toBe('revealTeams');
  });

  test('the other side is still held to the clock: the silent side is accused, the refused one is not', async () => {
    const d = makeDeps([[row({ revealSaltA: null, teamA: 0n, revealSaltB: null, teamB: 0n, revealRefusedB: 'no queued team on record' })]], chain(), 1_000n - ACCUSE_LEAD_SEC);
    await new RevealWatcher(d.deps).tick();
    expect(calls(d.writeContract)).toEqual([expect.objectContaining({ functionName: 'accuseRevealFailure', args: [42n, ALICE] })]);
  });
});

describe('RevealWatcher — revealTeams is simulated before it is sent', () => {
  function withSimulate(d: ReturnType<typeof makeDepsLogged>, impl: (args: unknown[], opts: unknown) => Promise<unknown>) {
    const simulate = mock(impl);
    d.deps.arena = { ...d.deps.arena, simulate: { revealTeams: simulate } };
    d.deps.resolverAddress = '0x00000000000000000000000000000000000000ee';
    return simulate;
  }

  test('a clean simulation sends the reveal, with the resolver as the simulated account', async () => {
    const d = makeDepsLogged([[row()]], chain());
    const simulate = withSimulate(d, async () => ({}));
    await new RevealWatcher(d.deps).tick();
    expect(simulate).toHaveBeenCalledTimes(1);
    const [args, opts] = simulate.mock.calls[0] as unknown as [unknown[], { account: string }];
    expect(args.slice(0, 5)).toEqual([42n, 11n, SALT_A, 22n, SALT_B]);
    expect(opts.account).toBe('0x00000000000000000000000000000000000000ee');
    expect(calls(d.writeContract)[0].functionName).toBe('revealTeams');
  });

  test('TeamPowerChanged naming B\'s team: B is accused at once (plenty of window left), nothing is sent', async () => {
    const d = makeDepsLogged([[row()]], chain(), 500n);
    withSimulate(d, async () => { throw revertWith('TeamPowerChanged', [22n, 3, 4]); });
    await new RevealWatcher(d.deps).tick();
    expect(calls(d.writeContract)).toEqual([expect.objectContaining({ functionName: 'accuseRevealFailure', args: [42n, BOB] })]);
    const line = d.lines.find((l) => l.msg.startsWith('reveal_failure_reported'));
    expect(line!.fields.why).toBe('team not playable: TeamPowerChanged(22, 3, 4)');
  });

  test('TeamNotOwned / TeamAlreadyInBattle naming A\'s team: A is accused', async () => {
    for (const name of ['TeamNotOwned', 'TeamAlreadyInBattle']) {
      const d = makeDepsLogged([[row()]], chain(), 500n);
      withSimulate(d, async () => { throw revertWith(name, [11n]); });
      await new RevealWatcher(d.deps).tick();
      expect(calls(d.writeContract)).toEqual([expect.objectContaining({ functionName: 'accuseRevealFailure', args: [42n, ALICE] })]);
    }
  });

  test('a lobster-level revert is attributed through the team roster: LobsterDamageTooHigh(5) with 5 in team 22 accuses B', async () => {
    const d = makeDepsLogged([[row()]], chain(), 500n);
    withSimulate(d, async () => { throw revertWith('LobsterDamageTooHigh', [5n, 90]); });
    d.deps.readTeamLobsters = async (teamId) => (teamId === 11n ? [1n, 2n, 3n] : [4n, 5n, 6n]);
    await new RevealWatcher(d.deps).tick();
    expect(calls(d.writeContract)).toEqual([expect.objectContaining({ functionName: 'accuseRevealFailure', args: [42n, BOB] })]);
    expect(d.lines.find((l) => l.msg.startsWith('reveal_failure_reported'))!.fields.why).toBe('team not playable: LobsterDamageTooHigh(5, 90)');
  });

  test('a lobster-level revert that matches neither roster accuses nobody', async () => {
    const d = makeDepsLogged([[row()]], chain(), 500n);
    withSimulate(d, async () => { throw revertWith('LobsterTierTooLow', [99n, 1, 0]); });
    d.deps.readTeamLobsters = async () => [1n, 2n, 3n];
    await new RevealWatcher(d.deps).tick();
    expect(d.writeContract).not.toHaveBeenCalled();
    expect(d.lines.some((l) => l.msg.startsWith('reveal_simulation_failed'))).toBe(true);
  });

  test('InvalidSeedCommit (or any other revert, or a plain RPC error): nobody is accused, nothing is sent, reveal_simulation_failed', async () => {
    for (const thrown of [revertWith('InvalidSeedCommit', [42n]), revertWith('PhaseTimedOut', [42n]), new Error('fetch failed')]) {
      const d = makeDepsLogged([[row()]], chain(), 500n);
      withSimulate(d, async () => { throw thrown; });
      await new RevealWatcher(d.deps).tick();
      expect(d.writeContract).not.toHaveBeenCalled();
      const line = d.lines.find((l) => l.msg.startsWith('reveal_simulation_failed'));
      expect(line).toBeDefined();
      expect(line!.fields.battleId).toBe('42');
    }
  });

  test('an unplayable side that is already accused is not accused twice', async () => {
    const d = makeDepsLogged([[row()]], chain({ accusedB: true, phaseDeadline: 1_100n }), 1_050n);
    withSimulate(d, async () => { throw revertWith('TeamPowerChanged', [22n, 3, 4]); });
    await new RevealWatcher(d.deps).tick();
    expect(d.writeContract).not.toHaveBeenCalled();
  });

  test('decodeRevert finds the custom error anywhere down the cause chain', () => {
    expect(decodeRevert(revertWith('TeamNotOwned', [11n]))).toEqual({ name: 'TeamNotOwned', args: [11n] });
    expect(decodeRevert({ cause: { cause: { data: { errorName: 'X' } } } })).toEqual({ name: 'X', args: [] });
    expect(decodeRevert(new Error('nope'))).toBeNull();
    expect(decodeRevert(null)).toBeNull();
  });
});
