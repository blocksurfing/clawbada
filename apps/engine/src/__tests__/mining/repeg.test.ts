/**
 * The glide re-peg keeper (mining/repeg.ts): MiningPool.repeg() once per hourly epoch, so the
 * rate — and RepairShop prices, basis points of it — never go stale while nobody mines.
 */
import { describe, test, expect, mock } from 'bun:test';
import { RepegJob, type RepegJobDeps } from '../../mining/repeg';

const EPOCH = 3_600n;
const START = 1_000_000n;
const OPERATOR = '0x00000000000000000000000000000000000000ee' as const;

function world(opts: { season?: bigint; lastRepegEpoch?: bigint; now: bigint; receiptStatus?: string }) {
  const infos: Array<{ msg: string; fields: any }> = [];
  const errors: Array<{ msg: string; fields: any }> = [];
  const log = {
    child: () => ({
      info: (fields: any, msg: string) => infos.push({ msg, fields }),
      debug: () => {},
      warn: () => {},
      error: (fields: any, msg: string) => errors.push({ msg, fields }),
    }),
  } as any;
  const simulate = mock(async (_args: [], _o: { account: unknown }) => ({ request: { fn: 'repeg' } }));
  const write = mock(async (_req: any) => '0xrepeg' as `0x${string}`);
  const deps: RepegJobDeps = {
    publicClient: {
      getBlock: async () => ({ timestamp: opts.now }),
      waitForTransactionReceipt: mock(async () => ({ status: opts.receiptStatus ?? 'success' })),
    },
    pool: {
      read: {
        currentSeason: async () => opts.season ?? 1n,
        getSeasonConfig: mock(async () => ({ startTime: START, lastRepegEpoch: opts.lastRepegEpoch ?? 0n })),
        REPEG_EPOCH: mock(async () => EPOCH),
      },
      simulate: { repeg: simulate },
    },
    walletClient: { account: { address: OPERATOR }, writeContract: write },
    log,
    pollMs: 1,
  };
  return { deps, infos, errors, simulate, write };
}

describe('RepegJob', () => {
  test('a new epoch nobody has touched: simulates as the operator, sends repeg, logs repeg_submitted', async () => {
    const w = world({ lastRepegEpoch: 2n, now: START + 3n * EPOCH + 5n });
    expect(await new RepegJob(w.deps).tick()).toBe('sent');
    expect(w.simulate).toHaveBeenCalledWith([], { account: { address: OPERATOR } });
    expect(w.write).toHaveBeenCalledWith({ fn: 'repeg' });
    expect(w.infos.map((i) => i.msg)).toEqual(['repeg_submitted']);
    expect(w.infos[0]!.fields).toMatchObject({ season: '1', epoch: '3', lastRepegEpoch: '2', tx: '0xrepeg' });
  });

  test('the epoch was already touched (an expedition re-pegged it): nothing sent', async () => {
    const w = world({ lastRepegEpoch: 3n, now: START + 3n * EPOCH + 5n });
    expect(await new RepegJob(w.deps).tick()).toBe('not_needed');
    expect(w.simulate).not.toHaveBeenCalled();
    expect(w.write).not.toHaveBeenCalled();
  });

  test('no season yet / a season that has not started: nothing sent', async () => {
    const a = world({ season: 0n, now: START });
    expect(await new RepegJob(a.deps).tick()).toBe('no_season');
    expect(a.simulate).not.toHaveBeenCalled();

    const b = world({ now: START - 1n });
    expect(await new RepegJob(b.deps).tick()).toBe('not_needed');
    expect(b.simulate).not.toHaveBeenCalled();
  });

  test('SeasonNotActive from the simulation is benign; any other error is thrown for the next tick', async () => {
    const a = world({ lastRepegEpoch: 0n, now: START + 70n * 24n * EPOCH });
    a.simulate.mockRejectedValueOnce(new Error('execution reverted: SeasonNotActive()'));
    expect(await new RepegJob(a.deps).tick()).toBe('season_not_active');
    expect(a.write).not.toHaveBeenCalled();
    expect(a.errors).toHaveLength(0);

    const b = world({ lastRepegEpoch: 0n, now: START + EPOCH });
    b.simulate.mockRejectedValueOnce(new Error('connection refused'));
    await expect(new RepegJob(b.deps).tick()).rejects.toThrow('connection refused');
  });

  test('a reverted transaction is logged repeg_reverted and retried next tick', async () => {
    const w = world({ lastRepegEpoch: 0n, now: START + EPOCH, receiptStatus: 'reverted' });
    const job = new RepegJob(w.deps);
    expect(await job.tick()).toBe('reverted');
    expect(w.errors.map((e) => e.msg)).toEqual([expect.stringContaining('repeg_reverted')]);
    expect(await job.tick()).toBe('reverted');
    expect(w.write).toHaveBeenCalledTimes(2);
  });

  test('REPEG_EPOCH is read from the chain once', async () => {
    const w = world({ lastRepegEpoch: 3n, now: START + 3n * EPOCH });
    const job = new RepegJob(w.deps);
    await job.tick();
    await job.tick();
    expect(w.deps.pool.read.REPEG_EPOCH).toHaveBeenCalledTimes(1);
  });
});
