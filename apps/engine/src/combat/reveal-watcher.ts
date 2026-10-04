/**
 * F5-01 team-reveal watcher.
 *
 * In the atomic-reveal flow, players hand their team salt to the API (with the deposit, or via
 * POST /reveal-team; they do not reveal on-chain themselves). The API stores each teamId + salt
 * on the battle row. This watcher is the RESOLVER-side half: it polls battles in TeamReveal and,
 * once both stored salts open their on-chain commits, submits a single atomic
 * `revealTeams(battleId, teamIdA, saltA, teamIdB, saltB, seedCommit)` with the RESOLVER key
 * (`onlyRole(RESOLVER_ROLE)` on-chain) — so neither team's identity reaches the chain until
 * both are bound in one transaction.
 *
 * D-01: the same transaction commits to this battle's seed secret (`seedCommit`). The secret is
 * derived from BATTLE_SEED_SECRET and the battle id, never stored; the settle job re-derives it
 * to disclose it. See packages/chain/src/battle-seed.ts for why the commitment has to ride in
 * THIS transaction: its block timestamp fixes the drand round the secret is mixed with.
 *
 * On success the salts are cleared (transient — a revealed team's salt is not retained).
 *
 * D-14 reveal-failure attribution. The commit rides in the deposit; the reveal window (20 s)
 * starts when the second deposit lands. Each tick checks every stored (teamId, salt) against the
 * commit ON-CHAIN before using it:
 *   - a salt that does not open its player's commit → `accuseRevealFailure(battleId, player)` at
 *     once (RESOLVER key). That extends the window by REVEAL_GRACE (2 min) for both sides;
 *   - no salt at all with ACCUSE_LEAD_SEC left in the window → the same report, so a slow client
 *     gets the grace too (an accusation costs an honest player nothing: the reveal still lands
 *     if their salt arrives, or they open the commit themselves);
 *   - an accused player who opens their own commit on-chain (`openOwnCommit` → `CommitOpened`)
 *     hands the resolver the (teamId, salt) to use — if it is the team they queued with (D-17).
 * If the window lapses with an accused player who never opened, the contract slashes their 5%
 * and refunds everyone else (handleTimeout); otherwise a lapse is a no-fault mutual cancel.
 *
 * Review 2026-10-03 — failures that are not the player's are never reported:
 *   - a side whose POST /reveal-team the API REFUSED (D-17: no queued team on record, or not the
 *     queued team) holds no usable salt through no failure of its own client. The API notes why
 *     on the row (`revealRefusedA/B`); such a side is `refused` here and is never accused, so the
 *     window lapses into the no-fault mutual cancel (`reveal_refused_not_accused`);
 *   - once both salts open, `revealTeams` is SIMULATED before it is sent. A revert that names one
 *     side's team as unplayable (TeamNotOwned / TeamAlreadyInBattle / TeamPowerChanged, or a
 *     lobster of that team in LobsterTierTooLow / LobsterDamageTooHigh) accuses THAT side at
 *     once — the player changed, sold or damaged the team after queueing. Any other revert
 *     (InvalidSeedCommit, an RPC error, …) accuses nobody: `reveal_simulation_failed`, retried
 *     next tick, and the window lapses into the mutual cancel if it never clears.
 *
 * TIMING: BattleArena.TEAM_REVEAL_WINDOW bounds how long after the second deposit revealTeams can
 * land (it reverts PhaseTimedOut past the deadline). This poll is deliberately fast, but if
 * the window proves too tight for the API→DB→poll→tx→confirm path on mainnet, widen
 * TEAM_REVEAL_WINDOW (a costless, security-neutral change — timeout is still a full-refund
 * mutual cancel). See the F5-01 off-chain integration notes.
 */
import { eq } from 'drizzle-orm';
import { BattlePhase } from '@clawbada/game-logic';
import { deriveSeedSecret, seedCommitment, loadSeedMasterSecret, teamCommitHash } from '@clawbada/chain';
import { log as baseLog } from '../logger';

const POLL_MS = 2000; // fast — the on-chain team-reveal window is short
/** Report a side that has sent no salt once this little of the reveal window is left. */
export const ACCUSE_LEAD_SEC = 8n;

/** The parts of `getBattle` the reveal watcher reads. */
export interface RevealOnChain {
  phase: number | bigint;
  playerA: string;
  playerB: string;
  teamCommitA: string;
  teamCommitB: string;
  phaseDeadline: bigint;
  accusedA: boolean;
  accusedB: boolean;
  openedA: boolean;
  openedB: boolean;
}

/** Reverts of `revealTeams` whose first argument is the offending team id. */
const TEAM_ERRORS = new Set(['TeamNotOwned', 'TeamAlreadyInBattle', 'TeamPowerChanged']);
/** Reverts whose first argument is a lobster id, mapped to its team through `readTeamLobsters`. */
const LOBSTER_ERRORS = new Set(['LobsterTierTooLow', 'LobsterDamageTooHigh']);

/** How (and whether) one side's commit can be opened right now. */
export type Opening =
  | { kind: 'ok'; teamId: bigint; salt: `0x${string}` }
  | { kind: 'wrong_salt' }
  | { kind: 'missing' }
  /** The API refused this side's reveal (D-17); the player is not at fault and is never accused. */
  | { kind: 'refused'; reason: string }
  /** Both commits open but the chain rejects this side's team; accused at once. */
  | { kind: 'unplayable'; error: string };

/** The custom error a viem simulation surfaced, found anywhere down the `cause` chain. */
export function decodeRevert(err: unknown): { name: string; args: unknown[] } | null {
  let e: any = err;
  for (let depth = 0; e && depth < 8; depth++) {
    const data = e.data;
    if (data && typeof data.errorName === 'string') return { name: data.errorName, args: Array.isArray(data.args) ? data.args : [] };
    e = e.cause;
  }
  return null;
}

export interface RevealWatcherDeps {
  /** drizzle db (select/update on `battles`). */
  db: any;
  battles: any;
  publicClient: {
    waitForTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ status: string }>;
    getBlock(args: { blockTag: 'latest' }): Promise<{ timestamp: bigint }>;
  };
  arena: {
    read: { getBattle(args: [bigint]): Promise<RevealOnChain> };
    /** viem contract `simulate` (present on a real getContract instance). Without it the reveal is
     *  sent unsimulated, exactly as before. */
    simulate?: { revealTeams(args: unknown[], opts: { account?: `0x${string}` }): Promise<unknown> };
  };
  /** D-14: the (teamId, salt) an accused player opened on-chain (`CommitOpened`), or null. */
  readOpenedCommit(battleId: bigint, player: `0x${string}`): Promise<{ teamId: bigint; salt: `0x${string}` } | null>;
  /** The lobsters of a team (TeamManager.getTeam), to attribute a lobster-level revert to a side. */
  readTeamLobsters?(teamId: bigint): Promise<bigint[]>;
  /** RESOLVER-role signer (revealTeams is onlyRole(RESOLVER_ROLE)). */
  walletClient: { writeContract(request: any): Promise<`0x${string}`> };
  /** The resolver's address, so the simulation runs with its role (else it reverts on access). */
  resolverAddress?: `0x${string}`;
  battleArenaAddress: `0x${string}`;
  abi: readonly unknown[];
  /** D-01: master secret the per-battle seed secret is derived from (BATTLE_SEED_SECRET).
   *  A function is resolved per reveal, so a missing variable fails that reveal loudly instead
   *  of taking the whole engine (seasons, boost epochs, finalize) down at boot. */
  seedMasterSecret: string | (() => string);
  log?: typeof baseLog;
  pollMs?: number;
}

let warnedEphemeralSeed = false;
/** BATTLE_SEED_SECRET, or a per-process random one outside production (warned once). */
export function seedMasterSecretFromEnv(): string {
  const { secret, ephemeral } = loadSeedMasterSecret();
  if (ephemeral && !warnedEphemeralSeed) {
    warnedEphemeralSeed = true;
    baseLog.warn('BATTLE_SEED_SECRET is not set: using a per-process random secret. The API must share it or real battles will not start.');
  }
  return secret;
}

export class RevealWatcher {
  private interval: ReturnType<typeof setInterval> | null = null;
  private inFlight = new Set<string>(); // battleIds mid-submit, avoids double-send
  private readonly log;
  private readonly pollMs: number;

  constructor(private readonly deps: RevealWatcherDeps) {
    this.log = (deps.log ?? baseLog).child({ module: 'reveal-watcher' });
    this.pollMs = deps.pollMs ?? POLL_MS;
  }

  /** Production wiring. Off mainnet RESOLVER_PRIVATE_KEY falls back to the operator key when unset. */
  static fromEnv(): RevealWatcher {
    const chain = require('@clawbada/chain');
    const dbMod = require('@clawbada/db');
    const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
    const publicClient = chain.getPublicClient(isTestnet);
    const walletClient = chain.getResolverClient(isTestnet);
    const teamManager = chain.getTeamManager(publicClient);
    return new RevealWatcher({
      db: dbMod.db,
      battles: dbMod.battles,
      publicClient,
      readOpenedCommit: async (battleId: bigint, player: `0x${string}`) => {
        const latest: bigint = await publicClient.getBlockNumber();
        // The grace is 2 minutes, so the event is at most a few hundred blocks old.
        const logs = await publicClient.getContractEvents({
          address: chain.addresses.battleArena,
          abi: chain.BattleArenaAbi,
          eventName: 'CommitOpened',
          args: { battleId, player },
          fromBlock: latest > 5_000n ? latest - 5_000n : 0n,
          toBlock: latest,
        });
        const last = logs[logs.length - 1] as any;
        return last ? { teamId: BigInt(last.args.teamId), salt: last.args.salt as `0x${string}` } : null;
      },
      arena: chain.getBattleArena(publicClient),
      readTeamLobsters: async (teamId: bigint) => {
        const team: any = await teamManager.read.getTeam([teamId]);
        return [...(team.lobsterIds ?? [])].map((x: unknown) => BigInt(x as bigint));
      },
      walletClient,
      resolverAddress: walletClient.account?.address,
      battleArenaAddress: chain.addresses.battleArena,
      abi: chain.BattleArenaAbi,
      seedMasterSecret: seedMasterSecretFromEnv,
    });
  }

  start(): void {
    this.interval = setInterval(() => {
      this.tick().catch((err) => this.log.error({ err }, 'reveal watcher tick failed'));
    }, this.pollMs);
    this.log.info('Reveal watcher started');
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** Every battle the indexer shows in TeamReveal: reveal it, or report the side holding it up. */
  async tick(): Promise<void> {
    const { db, battles } = this.deps;
    // The on-chain guard below clears salts on anything that advanced or cancelled meanwhile.
    const ready: Array<any> = await db
      .select()
      .from(battles)
      .where(eq(battles.phase, BattlePhase.TeamReveal));

    for (const row of ready) {
      const key = row.battleId.toString();
      if (this.inFlight.has(key)) continue;
      this.inFlight.add(key);
      try {
        await this.step(row);
      } catch (err) {
        this.log.error({ err, battleId: key }, 'reveal step failed');
      } finally {
        this.inFlight.delete(key);
      }
    }
  }

  private async step(row: any): Promise<void> {
    const { arena, publicClient } = this.deps;
    const battleId: bigint = row.battleId;

    // Guard against a stale row (already revealed / cancelled / timed out): only act while
    // the battle is genuinely still in TeamReveal on-chain.
    const onChain = await arena.read.getBattle([battleId]);
    if (Number(onChain.phase) !== BattlePhase.TeamReveal) {
      if (row.revealSaltA || row.revealSaltB) {
        this.log.warn({ battleId: battleId.toString(), phase: Number(onChain.phase) },
          'battle not in TeamReveal on-chain — clearing stale salts');
        await this.clearSalts(battleId);
      }
      return;
    }
    const now = (await publicClient.getBlock({ blockTag: 'latest' })).timestamp;
    if (now > onChain.phaseDeadline) return; // lapsed: handleTimeout cancels (and slashes an accused player who never opened)

    let a = await this.opening(battleId, row, onChain, 'A');
    let b = await this.opening(battleId, row, onChain, 'B');
    if (a.kind === 'ok' && b.kind === 'ok') {
      const sim = await this.simulateReveal(battleId, a, b);
      if (sim.kind === 'ok') {
        await this.submitReveal(battleId, a, b);
        return;
      }
      if (sim.kind === 'unknown') {
        // Not attributable to a player: never an accusation. Retried next tick; if it never
        // clears, the window lapses into the no-fault mutual cancel.
        this.log.error({ battleId: battleId.toString(), error: sim.error }, 'reveal_simulation_failed — not revealing, nobody accused');
        return;
      }
      if (sim.side === 'A') a = { kind: 'unplayable', error: sim.error };
      else b = { kind: 'unplayable', error: sim.error };
    }
    for (const [side, o] of [['A', a], ['B', b]] as const) {
      if (o.kind === 'ok') continue;
      if (o.kind === 'refused') {
        this.log.info({ battleId: battleId.toString(), side, reason: o.reason }, 'reveal_refused_not_accused — the API refused this reveal; the window lapses into a mutual cancel');
        continue;
      }
      const accused = side === 'A' ? onChain.accusedA : onChain.accusedB;
      if (accused) continue; // already reported: waiting for their salt or their own openOwnCommit
      const late = onChain.phaseDeadline - now <= ACCUSE_LEAD_SEC;
      if (o.kind === 'unplayable') {
        await this.accuse(battleId, side === 'A' ? onChain.playerA : onChain.playerB, `team not playable: ${o.error}`);
      } else if (o.kind === 'wrong_salt' || late) {
        await this.accuse(battleId, side === 'A' ? onChain.playerA : onChain.playerB, o.kind === 'wrong_salt' ? 'salt does not open the commit' : 'no salt received');
      }
    }
  }

  /** How (and whether) one side's commit can be opened right now. */
  private async opening(battleId: bigint, row: any, onChain: RevealOnChain, side: 'A' | 'B'): Promise<Opening> {
    const player = (side === 'A' ? onChain.playerA : onChain.playerB) as `0x${string}`;
    const commit = String(side === 'A' ? onChain.teamCommitA : onChain.teamCommitB).toLowerCase();
    const opened = side === 'A' ? onChain.openedA : onChain.openedB;
    if (opened) {
      const ev = await this.deps.readOpenedCommit(battleId, player);
      const queued = side === 'A' ? row.queuedTeamA : row.queuedTeamB;
      if (ev && queued !== null && queued !== undefined && BigInt(queued) === ev.teamId) return { kind: 'ok', ...ev };
      if (ev) {
        // D-17: the player committed a team other than the one they queued with. It is never
        // revealed; the window lapses into a mutual cancel (they opened, so they are not slashed).
        this.log.warn({ battleId: battleId.toString(), side, opened: ev.teamId.toString(), queued: String(queued) }, 'opened_commit_not_queued_team — not revealing');
      }
      return { kind: 'missing' };
    }
    const teamId = side === 'A' ? row.teamA : row.teamB;
    const salt = side === 'A' ? row.revealSaltA : row.revealSaltB;
    const refused = side === 'A' ? row.revealRefusedA : row.revealRefusedB;
    const usable = !!salt && teamId !== null && teamId !== undefined && BigInt(teamId) !== 0n
      && teamCommitHash(battleId, player, BigInt(teamId), salt as `0x${string}`).toLowerCase() === commit;
    if (usable) return { kind: 'ok', teamId: BigInt(teamId), salt: salt as `0x${string}` };
    // No usable salt. If the API refused this side's reveal, that is the server's doing, not the
    // player's: never an accusation.
    if (typeof refused === 'string' && refused.length > 0) return { kind: 'refused', reason: refused };
    return salt && teamId ? { kind: 'wrong_salt' } : { kind: 'missing' };
  }

  /**
   * Dry-run `revealTeams` with both openings. `ok` → send it; `unplayable` → the chain named one
   * side's team (that side is accused); `unknown` → anything else, which must never accuse.
   */
  private async simulateReveal(
    battleId: bigint,
    a: { teamId: bigint; salt: `0x${string}` },
    b: { teamId: bigint; salt: `0x${string}` },
  ): Promise<{ kind: 'ok' } | { kind: 'unplayable'; side: 'A' | 'B'; error: string } | { kind: 'unknown'; error: string }> {
    const { arena, resolverAddress } = this.deps;
    if (!arena.simulate) return { kind: 'ok' };
    try {
      await arena.simulate.revealTeams(this.revealArgs(battleId, a, b), { account: resolverAddress });
      return { kind: 'ok' };
    } catch (err) {
      const revert = decodeRevert(err);
      if (!revert) return { kind: 'unknown', error: String((err as Error)?.message ?? err).slice(0, 300) };
      const error = `${revert.name}(${revert.args.map(String).join(', ')})`;
      const first = revert.args[0];
      if (TEAM_ERRORS.has(revert.name) && first !== undefined) {
        const teamId = BigInt(first as bigint);
        if (teamId === a.teamId) return { kind: 'unplayable', side: 'A', error };
        if (teamId === b.teamId) return { kind: 'unplayable', side: 'B', error };
      } else if (LOBSTER_ERRORS.has(revert.name) && first !== undefined && this.deps.readTeamLobsters) {
        const lobsterId = BigInt(first as bigint);
        for (const [side, o] of [['A', a], ['B', b]] as const) {
          const members = await this.deps.readTeamLobsters(o.teamId).catch(() => [] as bigint[]);
          if (members.some((m) => m === lobsterId)) return { kind: 'unplayable', side, error };
        }
      }
      return { kind: 'unknown', error };
    }
  }

  private revealArgs(battleId: bigint, a: { teamId: bigint; salt: `0x${string}` }, b: { teamId: bigint; salt: `0x${string}` }): unknown[] {
    return [
      battleId, a.teamId, a.salt, b.teamId, b.salt,
      seedCommitment(battleId, deriveSeedSecret(typeof this.deps.seedMasterSecret === 'function' ? this.deps.seedMasterSecret() : this.deps.seedMasterSecret, battleId)),
    ];
  }

  private async accuse(battleId: bigint, player: string, why: string): Promise<void> {
    const { publicClient, walletClient, battleArenaAddress, abi } = this.deps;
    const hash = await walletClient.writeContract({
      address: battleArenaAddress,
      abi,
      functionName: 'accuseRevealFailure',
      args: [battleId, player],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    this.log.warn({ battleId: battleId.toString(), player, why, tx: hash }, 'reveal_failure_reported — the player has REVEAL_GRACE to open their commit or forfeits 5%');
  }

  private async submitReveal(
    battleId: bigint,
    a: { teamId: bigint; salt: `0x${string}` },
    b: { teamId: bigint; salt: `0x${string}` },
  ): Promise<void> {
    const { publicClient, walletClient, battleArenaAddress, abi } = this.deps;
    const hash = await walletClient.writeContract({
      address: battleArenaAddress,
      abi,
      functionName: 'revealTeams',
      args: this.revealArgs(battleId, a, b),
    });
    await publicClient.waitForTransactionReceipt({ hash });

    // Success — the teams are now bound + locked on-chain and the battle is Active. Drop the
    // transient salts.
    await this.clearSalts(battleId);
    this.log.info({ battleId: battleId.toString(), tx: hash }, 'revealTeams submitted — battle active');
  }

  private async clearSalts(battleId: bigint): Promise<void> {
    const { db, battles } = this.deps;
    await db
      .update(battles)
      .set({ revealSaltA: null, revealSaltB: null })
      .where(eq(battles.battleId, battleId));
  }
}
