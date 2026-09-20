/**
 * D-21 breed finalize keeper.
 *
 * Breeding is two steps on-chain. `requestBreed` takes the fee and one breed slot from EACH
 * parent immediately; `finalizeBreed` mints the offspring from `blockhash(targetBlock)`, a hash
 * that did not exist when the request was made. Since F5-02 a committed breed is final, so a
 * request that is not finalized within the blockhash window (256 blocks, ~8.5 min on Base) loses
 * everything: fee, both slots, and no offspring. The contract's NatSpec justifies that with "the
 * keeper auto-finalizes within the window" — and no keeper existed. This is it.
 *
 * `finalizeBreed` is permissionless and the offspring always goes to the original requester, so
 * the operator key can finalize for everyone. Finalizing promptly also removes the last trace of
 * selection power: once a result is minted it is binding, so nobody can look at a roll and let a
 * bad one lapse.
 *
 * Chain-only, no database. Request ids are sequential (`nextRequestId`) and target blocks never
 * decrease, so the keeper walks ids forward with a cursor. On start it scans BACKWARD from the
 * newest id until it meets a request too old to finalize — everything before that is already
 * finalized or already lost — so a restart costs a few reads, not a full history scan.
 */
import { log as baseLog } from '../logger';

const DEFAULT_POLL_MS = 4_000; // Base: 2 s blocks, target = request block + 2
/** blockhash() reaches back 256 blocks. */
export const BLOCKHASH_WINDOW = 256n;
/** D-22: BreedingLab refuses to finalize with less than FINALIZE_MIN_GAS (500k) left. */
const FINALIZE_GAS = 800_000n;

export interface BreedRequestView {
  requester: `0x${string}`;
  finalized: boolean;
  targetBlock: bigint;
}

export interface BreedFinalizeWatcherDeps {
  publicClient: {
    getBlockNumber(): Promise<bigint>;
    waitForTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ status: string }>;
  };
  lab: {
    read: { nextRequestId(): Promise<bigint>; getBreedRequest(args: [bigint]): Promise<BreedRequestView> };
    simulate: { finalizeBreed(args: [bigint], opts: { account: unknown; gas: bigint }): Promise<{ request: unknown }> };
  };
  walletClient: { account: { address: `0x${string}` }; writeContract(request: any): Promise<`0x${string}`> };
  log?: typeof baseLog;
  pollMs?: number;
}

export class BreedFinalizeWatcher {
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** Lowest request id that may still need finalizing. null until the first tick has located it. */
  private cursor: bigint | null = null;
  private readonly log;
  private readonly pollMs: number;

  constructor(private readonly deps: BreedFinalizeWatcherDeps) {
    this.log = (deps.log ?? baseLog).child({ module: 'breed-finalize-watcher' });
    this.pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  }

  static fromEnv(): BreedFinalizeWatcher {
    const chain = require('@clawbada/chain');
    const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
    const publicClient = chain.getPublicClient(isTestnet);
    const pollRaw = Number(process.env.BREED_FINALIZE_POLL_MS);
    return new BreedFinalizeWatcher({
      publicClient,
      lab: chain.getBreedingLab(publicClient),
      walletClient: chain.getOperatorClient(isTestnet),
      pollMs: Number.isFinite(pollRaw) && pollRaw > 0 ? pollRaw : DEFAULT_POLL_MS,
    });
  }

  start(): void {
    this.interval = setInterval(() => {
      this.tick().catch((err) => this.log.error({ err }, 'breed finalize tick failed'));
    }, this.pollMs);
    this.log.info({ pollMs: this.pollMs }, 'Breed finalize keeper started');
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  /** One pass. A slow pass is never overlapped by the next timer fire. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { lab, publicClient } = this.deps;
      const next = await lab.read.nextRequestId();
      const head = await publicClient.getBlockNumber();
      if (this.cursor === null) this.cursor = await this.locateCursor(next, head);

      for (let id: bigint = this.cursor; id < next; id = this.cursor) {
        const req = await lab.read.getBreedRequest([id]);
        if (req.finalized) { this.cursor = id + 1n; continue; }
        // B-01: blockhash(targetBlock) only exists once a LATER block is the head.
        if (head <= req.targetBlock) return; // too early — and every later id is later still
        if (head - req.targetBlock > BLOCKHASH_WINDOW) {
          this.log.error({ requestId: id.toString(), requester: req.requester, targetBlock: req.targetBlock.toString(), head: head.toString() },
            'breed request EXPIRED unfinalized — fee and both breed slots are forfeited (keeper was down or behind)');
          this.cursor = id + 1n;
          continue;
        }
        if (await this.finalize(id)) this.cursor = id + 1n;
        else return; // transient failure: retry this id next tick, keep order
      }
    } finally {
      this.running = false;
    }
  }

  /** Walk back from the newest request until one is too old to matter. */
  private async locateCursor(next: bigint, head: bigint): Promise<bigint> {
    let id = next - 1n;
    while (id >= 1n) {
      const req = await this.deps.lab.read.getBreedRequest([id]);
      if (head > req.targetBlock && head - req.targetBlock > BLOCKHASH_WINDOW) break; // this one and all before it are past saving
      id -= 1n;
    }
    return id + 1n;
  }

  /** true = done with this id (finalized by us or by someone else); false = try again next tick. */
  private async finalize(id: bigint): Promise<boolean> {
    const { lab, publicClient, walletClient } = this.deps;
    let request: unknown;
    try {
      ({ request } = await lab.simulate.finalizeBreed([id], { account: walletClient.account, gas: FINALIZE_GAS }));
    } catch (err) {
      const s = String((err as any)?.message ?? err);
      if (/RequestAlreadyFinalized/.test(s)) return true;             // the breeder (or anyone) got there first
      if (/RequestExpired/.test(s)) { this.log.error({ requestId: id.toString() }, 'breed request expired between the check and the call'); return true; }
      if (/TooEarlyToFinalize/.test(s)) return false;
      this.log.error({ err, requestId: id.toString() }, 'finalizeBreed simulation failed — will retry');
      return false;
    }
    try {
      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') { this.log.error({ requestId: id.toString(), tx: hash }, 'finalizeBreed reverted — will retry'); return false; }
      this.log.info({ requestId: id.toString(), tx: hash }, 'finalizeBreed submitted — offspring minted');
      return true;
    } catch (err) {
      this.log.error({ err, requestId: id.toString() }, 'finalizeBreed submission failed — will retry');
      return false;
    }
  }
}
