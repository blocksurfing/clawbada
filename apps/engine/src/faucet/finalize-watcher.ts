/**
 * D-10 faucet claim keeper.
 *
 * A faucet lobster claim is two steps on-chain. `claimLobsters` commits the claim; the five
 * lobsters are rolled from `blockhash(targetBlock)` — a hash that does not exist when the claim
 * is signed, so the roll cannot be predicted, chosen or retried — and minted by `finalizeClaim`.
 * That call is permissionless and always mints to the original claimer, so the operator key can
 * finish every claim. This keeper does, a couple of blocks after each request: to the player a
 * claim still looks like "click, and the lobsters appear".
 *
 * Unlike a breed request, an unfinalized faucet claim is never lost. When the target block's
 * hash has aged out of reach the contract refuses to finalize (`ClaimExpired`); `rearmClaim`
 * then points the claim at a new future block and it is finalized a few seconds later. A wallet
 * can also finish its own claim through the API (`POST /api/faucet/finalize-lobsters`), so a
 * keeper outage delays lobsters and costs nothing.
 *
 * Chain-only, no database. Claim ids are sequential, so the keeper walks them with a cursor. On
 * start it scans BACKWARD from the newest id until it has seen `SETTLED_RUN` finalized claims in
 * a row — a restart costs a few reads, not the whole faucet history. A claim older than that
 * run that somehow stayed pending is still finishable by its owner.
 */
import { log as baseLog } from '../logger';

const DEFAULT_POLL_MS = 4_000; // Base: 2 s blocks, target = request block + 2
/** Finalized claims in a row that end the start-up scan. */
const SETTLED_RUN = 50;
/** Five ERC-1155 mints with DNA storage. */
const FINALIZE_GAS = 1_500_000n;

export interface FaucetClaimView {
  claimer: `0x${string}`;
  targetBlock: bigint | number;
  finalized: boolean;
}

export interface FaucetFinalizeWatcherDeps {
  publicClient: {
    getBlockNumber(): Promise<bigint>;
    waitForTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ status: string }>;
  };
  faucet: {
    read: { nextClaimId(): Promise<bigint>; getClaim(args: [bigint]): Promise<FaucetClaimView> };
    simulate: {
      finalizeClaim(args: [bigint], opts: { account: unknown; gas: bigint }): Promise<{ request: unknown }>;
      rearmClaim(args: [bigint], opts: { account: unknown }): Promise<{ request: unknown }>;
    };
  };
  walletClient: { account: { address: `0x${string}` }; writeContract(request: any): Promise<`0x${string}`> };
  log?: typeof baseLog;
  pollMs?: number;
}

type Outcome = 'done' | 'retry' | 'rearmed';

export class FaucetFinalizeWatcher {
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** Lowest claim id that may still need finalizing. null until the first tick has located it. */
  private cursor: bigint | null = null;
  private readonly log;
  private readonly pollMs: number;

  constructor(private readonly deps: FaucetFinalizeWatcherDeps) {
    this.log = (deps.log ?? baseLog).child({ module: 'faucet-finalize-watcher' });
    this.pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  }

  static fromEnv(): FaucetFinalizeWatcher {
    const chain = require('@clawbada/chain');
    const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
    const publicClient = chain.getPublicClient(isTestnet);
    const pollRaw = Number(process.env.FAUCET_FINALIZE_POLL_MS);
    return new FaucetFinalizeWatcher({
      publicClient,
      faucet: chain.getFaucet(publicClient),
      walletClient: chain.getOperatorClient(isTestnet),
      pollMs: Number.isFinite(pollRaw) && pollRaw > 0 ? pollRaw : DEFAULT_POLL_MS,
    });
  }

  start(): void {
    this.interval = setInterval(() => {
      this.tick().catch((err) => this.log.error({ err }, 'faucet finalize tick failed'));
    }, this.pollMs);
    this.log.info({ pollMs: this.pollMs }, 'Faucet claim keeper started');
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  /** One pass. A slow pass is never overlapped by the next timer fire. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { faucet, publicClient } = this.deps;
      const next = await faucet.read.nextClaimId();
      const head = await publicClient.getBlockNumber();
      if (this.cursor === null) this.cursor = await this.locateCursor(next);

      // Unlike breed requests, target blocks are NOT monotonic in the id (a re-armed old claim
      // points later than newer ones), so a claim that is not ready yet is skipped, not a stop.
      let lowestOpen: bigint | null = null;
      for (let id = this.cursor; id < next; id++) {
        const claim = await faucet.read.getClaim([id]);
        if (claim.finalized) continue;
        let outcome: Outcome = 'retry';
        if (head > BigInt(claim.targetBlock)) outcome = await this.finalize(id);
        if (outcome !== 'done' && lowestOpen === null) lowestOpen = id;
      }
      this.cursor = lowestOpen ?? next;
    } finally {
      this.running = false;
    }
  }

  /** Walk back from the newest claim until SETTLED_RUN finalized claims in a row. */
  private async locateCursor(next: bigint): Promise<bigint> {
    let run = 0;
    let lowestOpen = next;
    for (let id = next - 1n; id >= 1n && run < SETTLED_RUN; id--) {
      const claim = await this.deps.faucet.read.getClaim([id]);
      if (claim.finalized) run++;
      else { run = 0; lowestOpen = id; }
    }
    return lowestOpen;
  }

  private async finalize(id: bigint): Promise<Outcome> {
    const { faucet, publicClient, walletClient } = this.deps;
    let request: unknown;
    try {
      ({ request } = await faucet.simulate.finalizeClaim([id], { account: walletClient.account, gas: FINALIZE_GAS }));
    } catch (err) {
      const s = String((err as any)?.message ?? err);
      if (/ClaimAlreadyFinalized/.test(s)) return 'done'; // the claimer (or anyone) got there first
      if (/TooEarlyToFinalize/.test(s)) return 'retry';
      if (/ClaimExpired/.test(s)) return this.rearm(id);
      // Anything else is the claimer's own receiver hook refusing the mint (a contract wallet
      // vetoing its roll, or one that cannot hold ERC-1155). It keeps the same block hash, so
      // a veto buys nothing; the claim stays open for its owner to finish.
      this.log.warn({ claimId: id.toString(), err: s.slice(0, 200) }, 'finalizeClaim simulation failed — will retry');
      return 'retry';
    }
    try {
      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') { this.log.error({ claimId: id.toString(), tx: hash }, 'finalizeClaim reverted — will retry'); return 'retry'; }
      this.log.info({ claimId: id.toString(), tx: hash }, 'finalizeClaim submitted — 5 faucet lobsters minted');
      return 'done';
    } catch (err) {
      this.log.error({ err, claimId: id.toString() }, 'finalizeClaim submission failed — will retry');
      return 'retry';
    }
  }

  /** The target block's hash is out of reach: point the claim at a new future block. */
  private async rearm(id: bigint): Promise<Outcome> {
    const { faucet, publicClient, walletClient } = this.deps;
    try {
      const { request } = await faucet.simulate.rearmClaim([id], { account: walletClient.account });
      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') return 'retry';
      this.log.warn({ claimId: id.toString(), tx: hash }, 'faucet claim had expired (keeper was down or behind) — re-armed, nothing lost; finalizing on the new block');
      return 'rearmed';
    } catch (err) {
      const s = String((err as any)?.message ?? err);
      if (/ClaimAlreadyFinalized/.test(s)) return 'done';
      this.log.error({ claimId: id.toString(), err: s.slice(0, 200) }, 'rearmClaim failed — will retry');
      return 'retry';
    }
  }
}
