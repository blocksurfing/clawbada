/**
 * The glide re-peg keeper (TOK-G1 / D-19).
 *
 * `MiningPool` re-pegs `baseReward` lazily: the first expedition of each hourly epoch
 * (`REPEG_EPOCH`) runs `_repegIfNeeded` on its way in. When nobody starts an expedition the rate
 * stays where the last epoch left it — and so do the things priced in basis points of it, the
 * RepairShop above all — and `currentBaseReward()` lags what the glide would say. `repeg()` is
 * permissionless and does exactly that step, nothing else. This job calls it once per epoch with
 * the operator key.
 *
 * Each tick (a few minutes) it reads the current season's `lastRepegEpoch` and compares it with
 * the epoch the chain clock is in; only when the epoch has moved on does it simulate and send,
 * so the transaction goes out at most once an hour and within one tick of the boundary.
 * `SeasonNotActive` (no season, or one that has ended) is benign.
 */
import { log as baseLog } from '../logger';

const DEFAULT_POLL_MS = 5 * 60_000;

export interface RepegJobDeps {
  publicClient: {
    getBlock(args: { blockTag: 'latest' }): Promise<{ timestamp: bigint }>;
    waitForTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ status: string }>;
  };
  pool: {
    read: {
      currentSeason(): Promise<bigint>;
      getSeasonConfig(args: [bigint]): Promise<{ startTime: bigint; lastRepegEpoch: bigint }>;
      REPEG_EPOCH(): Promise<bigint>;
    };
    simulate: { repeg(args: [], opts: { account: unknown }): Promise<{ request: unknown }> };
  };
  /** The operator key (`repeg` is permissionless). */
  walletClient: { account: { address: `0x${string}` }; writeContract(request: any): Promise<`0x${string}`> };
  log?: typeof baseLog;
  pollMs?: number;
}

export type RepegOutcome = 'sent' | 'not_needed' | 'no_season' | 'season_not_active' | 'reverted';

export class RepegJob {
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** `MiningPool.REPEG_EPOCH` (seconds), a contract constant: read once. */
  private epochSeconds: bigint | null = null;
  private readonly log;
  private readonly pollMs: number;

  constructor(private readonly deps: RepegJobDeps) {
    this.log = (deps.log ?? baseLog).child({ module: 'repeg' });
    this.pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  }

  static fromEnv(): RepegJob {
    const chain = require('@clawbada/chain');
    const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
    const publicClient = chain.getPublicClient(isTestnet);
    const pollRaw = Number(process.env.REPEG_POLL_MS);
    return new RepegJob({
      publicClient,
      pool: chain.getMiningPool(publicClient),
      walletClient: chain.getOperatorClient(isTestnet),
      pollMs: Number.isFinite(pollRaw) && pollRaw > 0 ? pollRaw : DEFAULT_POLL_MS,
    });
  }

  start(): void {
    this.interval = setInterval(() => {
      this.tick().catch((err) => this.log.error({ err }, 'repeg tick failed'));
    }, this.pollMs);
    this.tick().catch((err) => this.log.error({ err }, 'repeg tick failed'));
    this.log.info({ pollMs: this.pollMs }, 'Repeg keeper started');
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** One pass. Throws on an RPC / send failure (the caller logs; the next tick retries). */
  async tick(): Promise<RepegOutcome> {
    if (this.running) return 'not_needed';
    this.running = true;
    try {
      return await this.pass();
    } finally {
      this.running = false;
    }
  }

  private async pass(): Promise<RepegOutcome> {
    const { pool, publicClient, walletClient } = this.deps;
    const season = await pool.read.currentSeason();
    if (season === 0n) {
      this.log.debug('no season yet — nothing to re-peg');
      return 'no_season';
    }
    this.epochSeconds ??= await pool.read.REPEG_EPOCH();
    const [cfg, head] = await Promise.all([pool.read.getSeasonConfig([season]), publicClient.getBlock({ blockTag: 'latest' })]);
    if (head.timestamp < cfg.startTime) {
      this.log.debug({ season: season.toString(), startTime: cfg.startTime.toString() }, 'season not started — nothing to re-peg');
      return 'not_needed';
    }
    const epoch = (head.timestamp - cfg.startTime) / this.epochSeconds;
    if (epoch === cfg.lastRepegEpoch) {
      this.log.debug({ season: season.toString(), epoch: epoch.toString() }, 'repeg_not_needed — this epoch has already been touched');
      return 'not_needed';
    }

    let request: unknown;
    try {
      ({ request } = await pool.simulate.repeg([], { account: walletClient.account }));
    } catch (err) {
      // The season ended (SEASON_DURATION) and the next one has not been started by the Safe.
      if (/SeasonNotActive/.test(String((err as any)?.message ?? err))) {
        this.log.info({ season: season.toString() }, 'repeg_skipped — no active season');
        return 'season_not_active';
      }
      throw err;
    }
    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const fields = { season: season.toString(), epoch: epoch.toString(), lastRepegEpoch: cfg.lastRepegEpoch.toString(), tx: hash };
    if (receipt.status !== 'success') {
      this.log.error({ ...fields, status: receipt.status }, 'repeg_reverted — will retry next tick');
      return 'reverted';
    }
    this.log.info(fields, 'repeg_submitted');
    return 'sent';
  }
}
