import { describe, test, expect, mock } from 'bun:test';
import { FaucetFinalizeWatcher, type FaucetFinalizeWatcherDeps, type FaucetClaimView } from '../../faucet/finalize-watcher';

const quiet = { child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) } as any;
const ALICE = '0x00000000000000000000000000000000000000aa' as const;

/** A tiny in-memory Faucet: claims by id, a head block, and a 256-block hash window. */
function chain(claims: Record<number, FaucetClaimView>, startHead: bigint) {
  let head = startHead;
  const sent: string[] = [];
  const reads: number[] = [];
  const vetoes = new Set<number>();
  const finalizeClaim = mock(async ([id]: [bigint]) => {
    const c = claims[Number(id)]!;
    if (c.finalized) throw new Error('ClaimAlreadyFinalized(' + id + ')');
    if (head <= BigInt(c.targetBlock)) throw new Error('TooEarlyToFinalize');
    if (head - BigInt(c.targetBlock) > 256n) throw new Error('ClaimExpired(' + id + ')');
    if (vetoes.has(Number(id))) throw new Error('BadRoll()');
    return { request: { fn: 'finalizeClaim', id } };
  });
  const rearmClaim = mock(async ([id]: [bigint]) => ({ request: { fn: 'rearmClaim', id } }));
  const deps: FaucetFinalizeWatcherDeps = {
    publicClient: { getBlockNumber: async () => head, waitForTransactionReceipt: async () => ({ status: 'success' }) },
    faucet: {
      read: {
        nextClaimId: async () => BigInt(Math.max(0, ...Object.keys(claims).map(Number)) + 1),
        getClaim: async ([id]) => { reads.push(Number(id)); return claims[Number(id)]!; },
      },
      simulate: { finalizeClaim, rearmClaim },
    },
    walletClient: {
      account: { address: '0x00000000000000000000000000000000000000ee' },
      writeContract: async (req: any) => {
        const c = claims[Number(req.id)]!;
        if (req.fn === 'finalizeClaim') c.finalized = true;
        if (req.fn === 'rearmClaim') c.targetBlock = head + 2n;
        sent.push(`${req.fn}:${req.id}`);
        return '0xhash';
      },
    },
    log: quiet,
    pollMs: 1,
  };
  return { deps, sent, reads, vetoes, setHead: (h: bigint) => { head = h; } };
}

const claim = (targetBlock: bigint, finalized = false): FaucetClaimView => ({ claimer: ALICE, targetBlock, finalized });

describe('FaucetFinalizeWatcher (D-10)', () => {
  test('finalizes a claim once a block AFTER its target exists — not before', async () => {
    const c = chain({ 1: claim(100n) }, 100n);
    const w = new FaucetFinalizeWatcher(c.deps);
    await w.tick();
    expect(c.sent).toEqual([]); // blockhash(100) does not exist while 100 is the head
    c.setHead(101n);
    await w.tick();
    expect(c.sent).toEqual(['finalizeClaim:1']);
    await w.tick();
    expect(c.sent).toEqual(['finalizeClaim:1']); // once
  });

  test('walks every open claim in one pass', async () => {
    const c = chain({ 1: claim(100n), 2: claim(100n), 3: claim(101n) }, 105n);
    await new FaucetFinalizeWatcher(c.deps).tick();
    expect(c.sent).toEqual(['finalizeClaim:1', 'finalizeClaim:2', 'finalizeClaim:3']);
  });

  test('an expired claim is RE-ARMED, not lost — then finalized on its new block', async () => {
    const c = chain({ 1: claim(100n) }, 100n + 300n); // the keeper was down for ten minutes
    const w = new FaucetFinalizeWatcher(c.deps);
    await w.tick();
    expect(c.sent).toEqual(['rearmClaim:1']);
    await w.tick();
    expect(c.sent).toEqual(['rearmClaim:1']); // new target = head + 2: too early
    c.setHead(100n + 303n);
    await w.tick();
    expect(c.sent).toEqual(['rearmClaim:1', 'finalizeClaim:1']);
  });

  test('a re-armed OLD claim does not block newer ones (targets are not monotonic in the id)', async () => {
    const c = chain({ 1: claim(100n), 2: claim(400n) }, 401n);
    const w = new FaucetFinalizeWatcher(c.deps);
    await w.tick();
    // #1 expired -> re-armed to 403 (not ready); #2 is ready and must not wait behind it.
    expect(c.sent).toEqual(['rearmClaim:1', 'finalizeClaim:2']);
    c.setHead(404n);
    await w.tick();
    expect(c.sent).toEqual(['rearmClaim:1', 'finalizeClaim:2', 'finalizeClaim:1']);
  });

  test('a wallet that vetoes its roll stalls only itself, and gets no new roll', async () => {
    const c = chain({ 1: claim(100n), 2: claim(100n) }, 105n);
    c.vetoes.add(1);
    const w = new FaucetFinalizeWatcher(c.deps);
    await w.tick();
    await w.tick();
    expect(c.sent).toEqual(['finalizeClaim:2']); // #1 never re-armed while its hash is reachable
  });

  test('someone else finalized first: treated as done', async () => {
    const claims = { 1: claim(100n) };
    const c = chain(claims, 105n);
    const w = new FaucetFinalizeWatcher(c.deps);
    claims[1].finalized = true;
    await w.tick();
    expect(c.sent).toEqual([]);
  });

  test('restart: scans back only until a run of finalized claims, not the whole history', async () => {
    const claims: Record<number, FaucetClaimView> = {};
    for (let i = 1; i <= 400; i++) claims[i] = claim(BigInt(i), true);
    claims[399] = claim(399n); // one recent claim still open
    const c = chain(claims, 1_000n + 399n);
    await new FaucetFinalizeWatcher(c.deps).tick();
    expect(Math.min(...c.reads)).toBeGreaterThan(300); // stopped after 50 finalized in a row
    expect(c.sent[0]).toMatch(/:399$/);
  });

  test('no claims at all: nothing happens', async () => {
    const c = chain({}, 10n);
    await new FaucetFinalizeWatcher(c.deps).tick();
    expect(c.sent).toEqual([]);
  });
});
