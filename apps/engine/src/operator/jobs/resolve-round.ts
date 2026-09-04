/** `resolve_round` operator job. PR-C closes X2 (after both players reveal
 *  moves on chain, no component drives round resolution / settlement).
 *
 *  Flow:
 *    1. Indexer's `MoveRevealed` handler reads chain state. When both
 *       reveals are present for `currentRound`, it inserts an
 *       `operator_jobs` row with `idempotency_key='resolve_round:<id>:<r>'`
 *       and payload `{ battleId, round }`.
 *    2. Worker claims. Handler:
 *       a. Reads `getBattle` from chain. If `currentRound > round`, the
 *          round was already resolved by a prior attempt (idempotent skip).
 *       b. Loads both teams' lobsters from chain.
 *       c. Resolves the VRF seed — round 1 fetches a fresh drand beacon
 *          and persists in `battle_rounds[1].vrfSeed`; subsequent rounds
 *          read it from there. One beacon per battle, deterministic across
 *          worker restarts.
 *       d. Replays rounds 1..(round-1) from `on_chain_events.MoveRevealed`
 *          to rebuild resolver state. on_chain_events is the indexer's
 *          canonical event log (`apps/indexer/src/lib/event-processor.ts:115`).
 *       e. Resolves the current round using moves from on_chain_events.
 *       f. Inserts a `battle_rounds` row (ON CONFLICT DO NOTHING — round
 *          may have been written by a prior partial attempt).
 *       g. If `state.finished` → submits `settle`; else → submits
 *          `advanceRound`. Records tx hash via `ctx.recordTxHash` before
 *          awaiting receipt.
 *    3. Idempotency layers:
 *       - DB `idempotency_key` UNIQUE prevents duplicate enqueue.
 *       - Chain `currentRound > round` check skips the chain tx.
 *       - `battle_rounds` ON CONFLICT prevents duplicate row writes. */

import { and, asc, eq, sql } from 'drizzle-orm';
import {
  resolveRound as gameResolveRound,
  initBattle,
  type BattleMove,
  type Lobster,
} from '@clawbada/game-logic';
import {
  getBattleArena,
  getResolverClient,
  getPublicClient,
  getTeamManager,
  getLobsterNFT,
  addresses,
  BattleArenaAbi,
} from '@clawbada/chain';
import { db, battleRounds, onChainEvents } from '@clawbada/db';
import { log as baseLog } from '../../logger';
import { classifyError } from '../errors';
import { toLobster } from '../../combat/resolver';
import { DrandClient } from '../../vrf/drand';
import { TxHashPersistError, type JobContext, type JobResult } from '../types';

const log = baseLog.child({ module: 'operator-job', job: 'resolve_round' });
const isTestnet = process.env.CHAIN_ENV !== 'mainnet';

const drand = new DrandClient();

/** Codex PR-C P1: sentinel for moveData with on-chain-accepted-but-unparseable
 *  length. Player committed/revealed a non-6-byte blob; the contract accepted
 *  it (`bytes moveData` is unbounded on chain), but our resolver requires 6
 *  bytes. Retrying won't help — classify dead so the operator job goes
 *  terminal instead of burning 5 transient attempts. The battle stays stuck
 *  on chain until the X4 (deferred) handleTimeout UX recovers it. */
class MalformedMoveDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedMoveDataError';
  }
}

/** Payload from the indexer's MoveRevealed → both-revealed handler. */
export interface ResolveRoundPayload {
  battleId: string; // serialized bigint
  round: number; // 1-based
}

export async function resolveRoundHandler(
  rawPayload: unknown,
  ctx: JobContext,
): Promise<JobResult> {
  const payload = rawPayload as ResolveRoundPayload;
  const battleId = BigInt(payload.battleId);
  const round = payload.round;

  try {
    const publicClient = getPublicClient(isTestnet);
    const arena = getBattleArena(publicClient);

    // Idempotent skip: chain has already advanced past this round (a prior
    // attempt's `advanceRound` succeeded). Returns ok without any further
    // work. Note: `settle` does NOT advance currentRound, so a successful
    // settle won't trigger this branch — the priorTxHash recovery path
    // below handles that.
    const battle = await arena.read.getBattle([battleId]);
    if (Number(battle.currentRound) > round) {
      log.info(
        { battleId: battleId.toString(), round, currentRound: Number(battle.currentRound) },
        'round already advanced on chain; skipping resolve_round',
      );
      return { ok: true };
    }
    if (Number(battle.currentRound) !== round) {
      // currentRound < payload.round means the round-N reveals haven't
      // landed yet from our perspective. Indexer enqueue race; retry
      // transient and the chain catches up.
      log.warn(
        { battleId: battleId.toString(), round, currentRound: Number(battle.currentRound) },
        'currentRound mismatch; resolve_round transient retry',
      );
      return { ok: false, retry: 'transient', error: 'currentRound_mismatch' };
    }

    // Replay state so we know whether this round settled (state.finished)
    // — the chain tx submission below is `settle` vs `advanceRound`
    // depending on that flag. Settle-side accounting (battles row, agents
    // ELO) runs on the indexer's BattleSettled event (Codex PR-C FU F-01).
    const teamA = await loadTeamLobsters(BigInt(battle.teamIdA));
    const teamB = await loadTeamLobsters(BigInt(battle.teamIdB));
    const vrfSeed = await loadOrInitVrfSeed(battleId);
    const state = initBattle(teamA, teamB, vrfSeed);
    for (let r = 1; r < round; r++) {
      const { movesA, movesB } = await loadMovesForRound(battleId, r, battle.playerA as string, battle.playerB as string);
      gameResolveRound(state, movesA, movesB);
    }
    const { movesA, movesB } = await loadMovesForRound(battleId, round, battle.playerA as string, battle.playerB as string);
    const roundResult = gameResolveRound(state, movesA, movesB);

    // Persist round. Codex PR-C P0: `RoundAction.damage` is `bigint`; drizzle's
    // `jsonb` column uses `JSON.stringify` which throws on bigint — serialize
    // bigint fields to strings. Codex PR-C P1: ON CONFLICT target requires
    // the unique (battle_id, round) constraint from migration 0004.
    const serializableActions = roundResult.actions.map((a) => ({
      ...a,
      damage: a.damage.toString(),
    }));
    await db
      .insert(battleRounds)
      .values({
        battleId,
        round: roundResult.round,
        actions: serializableActions as unknown as object,
        teamAHp: roundResult.teamAHp.map(String) as unknown as object,
        teamBHp: roundResult.teamBHp.map(String) as unknown as object,
        vrfSeed: vrfSeed.toString(),
      })
      .onConflictDoNothing({
        target: [battleRounds.battleId, battleRounds.round],
      });

    // Codex PR-C P1: priorTxHash recovery path. Never blindly resubmits.
    // Codex PR-C FU F-01: settle-side accounting (ELO, payout, agents) is
    // NOT done here anymore — it's now triggered by the indexer's
    // `BattleSettled` event, which fires only after on-chain finality
    // (post dispute window). settle() proposes the outcome; finalize
    // (or adminResolveDispute) emits BattleSettled with the canonical
    // (winner, winnerPayout, protocolFee). Writing accounting at proposal
    // time would let a successful disputer's correct outcome lose to the
    // pre-finality ELO/win-loss credit.
    if (ctx.priorTxHash) {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: ctx.priorTxHash as `0x${string}`,
        timeout: 90_000,
      });
      if (receipt.status === 'success') {
        log.info(
          { battleId: battleId.toString(), round, txHash: ctx.priorTxHash, finished: state.finished },
          'priorTxHash receipt success; finalizing without resubmit',
        );
        return { ok: true };
      }
      log.warn(
        { battleId: battleId.toString(), round, txHash: ctx.priorTxHash },
        'priorTxHash reverted; resolve_round will not retry submission',
      );
      return { ok: false, retry: 'dead', error: 'prior_tx_reverted' };
    }

    // Submit fresh chain tx (settle if finished, advanceRound otherwise).
    // Codex cross-cutting HIGH-1: advanceRound + settle require
    // RESOLVER_ROLE (BattleArena.sol:491+, 517+). Mainnet config grants
    // this to a dedicated RESOLVER address distinct from MATCHMAKER; the
    // resolver-specific client reads RESOLVER_PRIVATE_KEY (or falls back
    // to OPERATOR_PRIVATE_KEY for testnet/dev convenience).
    const walletClient = getResolverClient(isTestnet) as any;

    let txHash: `0x${string}`;
    if (state.finished) {
      const winnerAddress = (state.winner === 'B' ? battle.playerB : battle.playerA) as `0x${string}`;
      // State-machine convention: damage points are tracked via RepairShop
      // separately; settle's damage args are placeholders.
      const zeroDamage: [number, number, number] = [0, 0, 0];
      txHash = (await walletClient.writeContract({
        address: addresses.battleArena,
        abi: BattleArenaAbi as any,
        functionName: 'settle',
        args: [battleId, winnerAddress, zeroDamage, zeroDamage],
      })) as `0x${string}`;
    } else {
      txHash = (await walletClient.writeContract({
        address: addresses.battleArena,
        abi: BattleArenaAbi as any,
        functionName: 'advanceRound',
        args: [battleId],
      })) as `0x${string}`;
    }
    await ctx.recordTxHash(txHash);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      log.warn(
        { battleId: battleId.toString(), round, txHash, finished: state.finished },
        'resolve_round tx reverted on chain',
      );
      return { ok: false, retry: 'dead', error: state.finished ? 'settle_reverted' : 'advance_reverted' };
    }

    // Codex PR-C FU F-01: settle accounting moved to the indexer's
    // BattleSettled handler so it runs at on-chain finality (post dispute
    // window), not at settle-proposal time.

    log.info(
      {
        battleId: battleId.toString(),
        round,
        finished: state.finished,
        winner: state.winner,
        txHash,
        jobId: ctx.jobId.toString(),
      },
      state.finished ? 'battle settled on chain' : 'round advanced on chain',
    );

    return { ok: true };
  } catch (err) {
    if (err instanceof TxHashPersistError) throw err;
    if (err instanceof MalformedMoveDataError) {
      // Codex PR-C P1: classify dead (not transient) so the operator job
      // terminates instead of burning 5 attempts. Battle stays stuck on
      // chain; X4 (deferred) handleTimeout UX is the recovery path.
      log.warn(
        { err, battleId: battleId.toString(), round, jobId: ctx.jobId.toString() },
        'malformed moveData — battle stuck pending handleTimeout',
      );
      return { ok: false, retry: 'dead', error: `malformed_moveData: ${err.message}` };
    }
    return classifyError(err);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Load a team's 3 lobsters from chain. Mirrors state-machine.loadTeamLobsters
 *  (kept independent here so the operator-worker path doesn't depend on the
 *  state machine's stateful lifecycle). */
async function loadTeamLobsters(teamId: bigint): Promise<Lobster[]> {
  const publicClient = getPublicClient(isTestnet);
  const nft = getLobsterNFT(publicClient);
  const tm = getTeamManager(publicClient);
  const teamData = await tm.read.getTeam([teamId]);
  const lobsterIds = teamData.lobsterIds as readonly bigint[];

  const lobsters: Lobster[] = [];
  for (const id of lobsterIds) {
    const [data, owner, purity] = await Promise.all([
      nft.read.getLobster([id]),
      nft.read.ownerOf([id]),
      nft.read.getPurity([id]),
    ]);
    lobsters.push(
      toLobster({
        tokenId: id,
        owner: owner as string,
        dna: data.dna,
        evolutionTier: data.evolutionTier,
        damage: data.damage,
        breedCount: data.breedCount,
        generation: data.generation,
        soulbound: data.soulbound,
        locked: data.locked,
        purity: Number(purity),
      }),
    );
  }
  return lobsters;
}

/** Returns the VRF seed for this battle. Round 1's resolve fetches a fresh
 *  drand beacon if no prior round exists; subsequent rounds reuse the same
 *  seed from `battle_rounds[round=1].vrfSeed`. Deterministic + restart-safe.
 *
 *  Codex PR-C P2: fail closed on a non-null but empty `vrf_seed` for an
 *  existing prior round. Previously this fell through to a fresh drand
 *  beacon, which would silently replay subsequent rounds under a different
 *  seed than was used for round 1. Treat a row-present-but-null-seed as DB
 *  corruption and throw — the handler classifies the throw as transient
 *  (Error, not contract revert), so retries continue while ops investigates. */
async function loadOrInitVrfSeed(battleId: bigint): Promise<bigint> {
  const existing = await db
    .select({ vrfSeed: battleRounds.vrfSeed })
    .from(battleRounds)
    .where(eq(battleRounds.battleId, battleId))
    .orderBy(asc(battleRounds.round))
    .limit(1);
  if (existing.length > 0) {
    if (!existing[0].vrfSeed) {
      throw new Error(
        `battle_rounds row exists for battle ${battleId} with null vrf_seed — DB corruption, refusing to derive a fresh seed`,
      );
    }
    return BigInt(existing[0].vrfSeed);
  }
  // No prior round → this is round 1. Fetch fresh drand beacon.
  const beacon = await drand.fetchLatest();
  return drand.toBigInt(beacon.randomness);
}

/** Decode the 6-byte packed `moveData` blob into 3 BattleMove entries.
 *  Frontend encoding: `encodePacked(['uint8'×6], [mt0, t0, mt1, t1, mt2, t2])`
 *  See `apps/web/src/components/game/battle-moves.tsx` MoveCommitAction. */
function decodeMoves(hex: string): BattleMove[] {
  const bytes = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (bytes.length !== 12) {
    // Codex PR-C P1: throw the sentinel so the outer catch classifies dead.
    throw new MalformedMoveDataError(
      `moveData expected 12 hex chars (6 bytes), got ${bytes.length}: ${hex}`,
    );
  }
  const moves: BattleMove[] = [];
  for (let i = 0; i < 3; i++) {
    moves.push({
      lobsterSlot: i,
      moveType: parseInt(bytes.slice(i * 4, i * 4 + 2), 16) as BattleMove['moveType'],
      targetSlot: parseInt(bytes.slice(i * 4 + 2, i * 4 + 4), 16),
    });
  }
  return moves;
}

/** Load both players' moves for a given (battleId, round) from
 *  `on_chain_events`. The indexer logs every event's args including the
 *  raw `moveData` bytes (see `apps/indexer/src/lib/event-processor.ts:115`).
 *  Returns the canonical (A, B) order regardless of insertion order. */
async function loadMovesForRound(
  battleId: bigint,
  round: number,
  playerA: string,
  playerB: string,
): Promise<{ movesA: BattleMove[]; movesB: BattleMove[] }> {
  // jsonb args contain { battleId, round, player, moveData, salt }
  // Filter the indexer's event log to the exact (battleId, round) pair.
  // Note: args.battleId / round arrive as numeric strings from viem's
  // bigint serialization (the JSONB driver applies its own conversion).
  // The indexer's event-processor stores them via `args: log.args ?? {}`,
  // and bun's pg driver serializes bigints as decimal strings — match that.
  const rows = await db
    .select({ args: onChainEvents.args })
    .from(onChainEvents)
    .where(
      and(
        eq(onChainEvents.eventName, 'MoveRevealed'),
        sql`${onChainEvents.args}->>'battleId' = ${battleId.toString()}`,
        sql`${onChainEvents.args}->>'round' = ${round.toString()}`,
      ),
    );

  let aHex: string | null = null;
  let bHex: string | null = null;
  for (const r of rows) {
    const args = r.args as { player?: string; moveData?: string };
    if (!args.player || !args.moveData) continue;
    const p = args.player.toLowerCase();
    if (p === playerA.toLowerCase()) aHex = args.moveData;
    else if (p === playerB.toLowerCase()) bHex = args.moveData;
  }

  if (!aHex || !bHex) {
    throw new Error(`MoveRevealed events missing for battle ${battleId} round ${round}`);
  }

  return { movesA: decodeMoves(aHex), movesB: decodeMoves(bHex) };
}
