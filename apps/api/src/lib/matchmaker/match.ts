/**
 * V3 S1 Power Matchmaker — match algorithm.
 *
 * `tryMatchForPlayer(address)` is idempotent and race-safe:
 *   - SELECT-then-DELETE race is closed via SELECT ... FOR UPDATE SKIP LOCKED
 *     inside a single transaction. Two concurrent matchmaker calls cannot pair
 *     the same opponent — the second call will skip the locked row and find
 *     either nobody or the next eligible candidate.
 *   - If the on-chain createBattle call fails, both queue rows are restored
 *     with their ORIGINAL `enqueuedAt` timestamps so the players don't lose
 *     their accumulated wait time.
 *
 * Telemetry: every match decision (matched, no-match-yet) writes to
 * `matchmakingDecisions` for post-launch analysis.
 *
 * On-chain: the operator (MATCHMAKER_ROLE) is responsible for actually sending
 * `BattleArena.createBattle(...)`. This module only simulates to predict the
 * battleId, then writes the new battle row to the DB. The engine service /
 * operator key sends the actual tx — same split as the legacy matchmaker.
 */

import { and, asc, eq, gte, lte, ne, sql } from 'drizzle-orm';

/** F-08: Postgres advisory lock key for serializing battleId predictions.
 *  `arena.simulate.createBattle` reads `nextBattleId` from current chain
 *  state. Concurrent matchmaker invocations (sync match + ticker pass) all
 *  see the same predicted ID and either collide on the battles PK or
 *  produce DB rows that misalign with the operator's actual createBattle
 *  tx order. The advisory lock serializes the simulate+insert critical
 *  section. Released automatically at tx commit. */
const BATTLE_PREDICTION_LOCK_KEY = 100042n;
import {
  addresses,
  getBattleArena,
  getPublicClient,
} from '@clawbada/chain';
import {
  BattlePhase,
  STAKE_BRACKETS,
  computeTeamPower,
  EvolutionTier,
} from '@clawbada/game-logic';
import { db, battles, matchmakingQueue, matchmakingDecisions, operatorJobs } from '@clawbada/db';
import { log as baseLog } from '../../logger';
import { battleWS } from '../ws';
import { readLobster, readTeam } from '../chain';
import {
  getCurrentRadius,
  powerInRadius,
  type PoolKey,
} from './bucket';

const log = baseLog.child({ module: 'matchmaker' });

// ──────────── Types ────────────

interface QueueRow {
  id: bigint;
  address: string;
  teamId: bigint;
  stakeBracket: number;
  powerScore: number;
  elo: number;
  enqueuedAt: Date;
}

export interface MatchResult {
  battleId: bigint;
  playerA: string;
  playerB: string;
  stakeBracket: number;
  powerA: number;
  powerB: number;
}

// ──────────── Public API ────────────

/** Compute the team's power score by reading lobster tiers from chain.
 *  Used at queue-join time to validate and snapshot the power.
 *
 *  F-3C: tagged result so callers can distinguish chain-read failure (the
 *  RPC threw) from a successful read of an invalid team composition (e.g.
 *  the player swapped a Base-tier lobster in mid-flow). Conflating the
 *  two would let a guilty player escape `team_mutation_self` penalty by
 *  triggering a validation throw instead of a stat change.
 */
export type PowerResult =
  | { ok: true; power: number }
  | { ok: false; reason: 'invalid_team' };

export async function computePowerForTeam(teamId: bigint): Promise<PowerResult> {
  const team = await readTeam(teamId); // RPC: throws on transport failure
  const lobsters = await Promise.all(team.lobsterIds.map((id) => readLobster(id)));
  const tiers = lobsters.map((l): EvolutionTier => l.evolutionTier);
  // Validate before passing to computeTeamPower — the helper throws on Base
  // or unknown tiers, which would surface as a generic Error and be
  // misclassified as RPC failure by the catch above. Distinguish here.
  for (const t of tiers) {
    if (t < EvolutionTier.Evolved || t > EvolutionTier.Apex) {
      return { ok: false, reason: 'invalid_team' };
    }
  }
  return { ok: true, power: computeTeamPower(tiers) };
}

/** Idle timeout while the matchmaker tx is awaiting an RPC. Bounds the
 *  worst-case lock-hold so a hung chain provider can't block DELETE /queue
 *  indefinitely. `idle_in_transaction_session_timeout` (vs `statement_timeout`)
 *  applies specifically to time spent NOT running SQL — exactly the chain
 *  RPC window. F-3H. */
const MATCHMAKER_TX_IDLE_TIMEOUT_MS = 5_000;

/** Outcome of `tryMatchForPlayer`'s in-tx work. The tx commits in all
 *  non-throwing cases; the kind tells the caller what telemetry/WS to fire
 *  outside the tx. F-3H. */
type MatchOutcome =
  | { kind: 'no_match' }
  | { kind: 'rpc_failure'; me: QueueRow; opp: QueueRow; meRpcOk: boolean; oppRpcOk: boolean; elapsedSec: number }
  | {
      kind: 'mutation';
      me: QueueRow;
      opp: QueueRow;
      meCurrentPower: number | null;
      oppCurrentPower: number | null;
      meChanged: boolean;
      oppChanged: boolean;
      meInvalid: boolean;
      oppInvalid: boolean;
      meMutated: boolean;
      oppMutated: boolean;
      elapsedSec: number;
    }
  | { kind: 'matched'; battleId: bigint; me: QueueRow; opp: QueueRow; elapsedSec: number };

/** Try to match `address` against an eligible opponent in their bucket.
 *  Returns the match result if paired, or null if no opponent in radius.
 *  Safe to call concurrently with other matchmaker invocations.
 *  Safe to call with an address that is no longer in the queue (returns null).
 *
 *  F-3H: select+lock+RPC+simulate+insert+delete all run in a SINGLE
 *  transaction, so the queue rows are not deleted until the battle row is
 *  inserted. Closes the previous "queue gone, battle not yet present"
 *  window during which DELETE /queue would falsely report success.
 */
export async function tryMatchForPlayer(address: string): Promise<MatchResult | null> {
  const lower = address.toLowerCase();
  const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
  const client = getPublicClient(isTestnet) as any;
  const arena = getBattleArena(client);
  const matchmakerAddress = process.env.MATCHMAKER_ADDRESS as `0x${string}`;
  const stakeAmountFor = (bracketIdx: number) =>
    STAKE_BRACKETS[bracketIdx] * (10n ** 18n);

  // F-3R: capture the locked queue rows in closure-accessible refs so the
  // outer catch block can write rich `aborted_chain_failure` telemetry
  // (real bracket + power + elapsed time) instead of falling back to the
  // seeker-only placeholder values. Populated inside the tx; nulled out
  // initially so the catch can detect the "tx never selected anything"
  // case (e.g., lock_timeout fired on the very first `SET LOCAL`).
  let meRow: QueueRow | null = null;
  let oppRow: QueueRow | null = null;
  let elapsedAtAbort = 0;

  let outcome: MatchOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<MatchOutcome> => {
      // F-3H: bound the worst-case lock-hold while we're awaiting a chain
      // RPC. `idle_in_transaction_session_timeout` aborts the tx if we sit
      // idle (no SQL running) longer than this window — exactly what a hung
      // simulate looks like. Released at tx commit/rollback.
      await tx.execute(
        sql.raw(`SET LOCAL idle_in_transaction_session_timeout = '${MATCHMAKER_TX_IDLE_TIMEOUT_MS}ms'`),
      );
      // F-3O: also bound advisory-lock acquisition. The idle timeout above
      // only fires when the backend is idle waiting on the client; a
      // `pg_advisory_xact_lock(...)` call that BLOCKS waiting on another
      // tx's lock is "running SQL" and is not covered by the idle timeout.
      // `lock_timeout` aborts the lock-acquiring statement after this
      // window — the catch then converts to an `aborted_chain_failure` and
      // rolls back, releasing any locks we've already acquired.
      await tx.execute(
        sql.raw(`SET LOCAL lock_timeout = '${MATCHMAKER_TX_IDLE_TIMEOUT_MS}ms'`),
      );

      // 1. Lock the seeker's queue row (skip if already gone — concurrent match).
      const [me] = await tx
        .select()
        .from(matchmakingQueue)
        .where(eq(matchmakingQueue.address, lower))
        .for('update', { skipLocked: true })
        .limit(1);
      if (!me) return { kind: 'no_match' };
      meRow = me as QueueRow; // F-3R

      // 2. Compute current radius from elapsed wait time.
      const elapsedSec = Math.floor((Date.now() - me.enqueuedAt.getTime()) / 1000);
      elapsedAtAbort = elapsedSec; // F-3R: keep latest known elapsedSec for catch telemetry
      const radius = getCurrentRadius(me.powerScore, elapsedSec);

      // 3. Find oldest opponent within radius, skipping rows locked by another tx.
      const [opp] = await tx
        .select()
        .from(matchmakingQueue)
        .where(
          and(
            eq(matchmakingQueue.stakeBracket, me.stakeBracket),
            gte(matchmakingQueue.powerScore, radius.low),
            lte(matchmakingQueue.powerScore, radius.high),
            ne(matchmakingQueue.address, lower),
          ),
        )
        .orderBy(asc(matchmakingQueue.enqueuedAt))
        .for('update', { skipLocked: true })
        .limit(1);
      if (!opp) return { kind: 'no_match' };
      oppRow = opp as QueueRow; // F-3R

      // Defensive: confirm opponent's power still in radius (caught by SQL
      // filter, but explicit check guards against any drift).
      if (!powerInRadius(opp.powerScore, radius)) return { kind: 'no_match' };

      // 4. M-02 re-read: validate both teams' current power against snapshot.
      // RPC inside the tx so the row locks hold across the call. F-3C: tagged
      // result distinguishes RPC failure from invalid-team validation.
      type MaybePower = PowerResult | null;
      const [meResult, oppResult]: [MaybePower, MaybePower] = await Promise.all([
        computePowerForTeam(me.teamId).catch((err) => {
          log.warn({ err, address: me.address }, 'computePowerForTeam threw for seeker; treating as RPC failure');
          return null;
        }),
        computePowerForTeam(opp.teamId).catch((err) => {
          log.warn({ err, address: opp.address }, 'computePowerForTeam threw for opponent; treating as RPC failure');
          return null;
        }),
      ]);

      const meRpcOk = meResult !== null;
      const oppRpcOk = oppResult !== null;
      if (!meRpcOk || !oppRpcOk) {
        // F-11: RPC failure path. Tx commits with NO row changes — both
        // players stay queued; next tick retries.
        return {
          kind: 'rpc_failure',
          me: me as QueueRow,
          opp: opp as QueueRow,
          meRpcOk,
          oppRpcOk,
          elapsedSec,
        };
      }

      const meCurrentPower = meResult.ok ? meResult.power : null;
      const oppCurrentPower = oppResult.ok ? oppResult.power : null;
      const meInvalid = !meResult.ok;
      const oppInvalid = !oppResult.ok;
      const meChanged = meCurrentPower !== null && meCurrentPower !== me.powerScore;
      const oppChanged = oppCurrentPower !== null && oppCurrentPower !== opp.powerScore;
      const meMutated = meInvalid || meChanged;
      const oppMutated = oppInvalid || oppChanged;

      if (meMutated || oppMutated) {
        // F-3H: delete only the guilty rows in the tx. The innocent side's
        // row was never deleted to begin with — they stay queued without
        // any restore-by-conflict dance.
        const guiltyAddresses: string[] = [];
        if (meMutated) guiltyAddresses.push(me.address);
        if (oppMutated) guiltyAddresses.push(opp.address);
        if (guiltyAddresses.length === 1) {
          await tx
            .delete(matchmakingQueue)
            .where(eq(matchmakingQueue.address, guiltyAddresses[0]));
        } else {
          await tx
            .delete(matchmakingQueue)
            .where(sql`${matchmakingQueue.address} IN (${guiltyAddresses[0]}, ${guiltyAddresses[1]})`);
        }
        return {
          kind: 'mutation',
          me: me as QueueRow,
          opp: opp as QueueRow,
          meCurrentPower,
          oppCurrentPower,
          meChanged,
          oppChanged,
          meInvalid,
          oppInvalid,
          meMutated,
          oppMutated,
          elapsedSec,
        };
      }

      // 5. Happy path: predict battleId via simulate, insert battle row,
      // then delete BOTH queue rows. F-08 advisory lock serializes
      // concurrent matchmaker invocations on the chain's `nextBattleId`.
      // F-3H: queue-row deletion + battle-row insert are now atomic — a
      // concurrent DELETE /queue can no longer slip into a window where
      // queue is gone but battle isn't yet present.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${BATTLE_PREDICTION_LOCK_KEY})`,
      );
      const sim = await arena.simulate.createBattle(
        [
          me.address as `0x${string}`,
          opp.address as `0x${string}`,
          stakeAmountFor(me.stakeBracket),
          me.powerScore,
          opp.powerScore,
        ],
        { account: matchmakerAddress },
      );
      const battleId = (sim as any).result as bigint;

      // F-3N: stamp `created_at` with `clock_timestamp()` (actual write time)
      // instead of relying on the column default (`now()` = tx-start time).
      // Under a slow tx (e.g., chain RPC took 4s), tx-start anchoring would
      // make the row appear up to 4s older than reality, shrinking the F-15
      // cancel-vs-match window correspondingly.
      // F-12: store the DISPLAY value of stakeAmount (e.g. "2500") rather
      // than wei (e.g. "2500000000000000000000"). Pre-B-18 the column was
      // display semantics and frontend `formatClaw` consumers assume that.
      // The wei conversion happens only at the chain boundary (the simulate
      // call above).
      // F-13: contract enum value 1 == Deposit. The previous alias
      // `StakeDeposit` resolves to the same numeric (kept as a deprecated
      // alias for backward compat).
      await tx.insert(battles).values({
        battleId,
        playerA: me.address,
        playerB: opp.address,
        teamA: 0n,
        teamB: 0n,
        // A2 (May 2026 audit): persist each player's queued team ID so the
        // commit-reveal flow has a canonical pre-reveal source. `chain.teamIdA/B`
        // are 0 until revealTeam lands; without these columns the frontend
        // hashes commit preimages with `teamId = 0` and reveal reverts.
        // Battle-read API exposes only the caller's own queued team.
        queuedTeamA: me.teamId,
        queuedTeamB: opp.teamId,
        stakeBracket: me.stakeBracket,
        stakeAmount: STAKE_BRACKETS[me.stakeBracket].toString(),
        phase: BattlePhase.Deposit,
        powerA: me.powerScore,
        powerB: opp.powerScore,
        // PR-B X1: matchmaker only WRITES the row + queues the operator job
        // (below). The on-chain createBattle hasn't happened yet — the engine
        // operator worker picks up the job, submits the tx, and flips status
        // to 1 (created) on receipt. Pre-PR-B this column didn't exist, the
        // matchmaker emitted match_found WS inline, and the frontend navigated
        // to a battle that didn't actually exist on chain.
        status: 0, // pending_create
        createdAt: sql`clock_timestamp()` as unknown as Date,
      });

      // PR-B X1: queue the create_battle operator job in the SAME tx as the
      // battles row insert + queue delete. Same-tx guarantee means a partial
      // failure rolls back ALL of it (no orphan row without a corresponding
      // job). Idempotency key uses predicted battle id; if another matchmaker
      // raced and decided the same predicted id (advisory lock should prevent
      // this, but UNIQUE is belt+suspenders), this INSERT fails and the whole
      // tx rolls back.
      await tx.insert(operatorJobs).values({
        jobType: 'create_battle',
        payload: {
          predictedBattleId: battleId.toString(),
          playerA: me.address,
          playerB: opp.address,
          stakeWei: stakeAmountFor(me.stakeBracket).toString(),
          stakeBracket: me.stakeBracket,
          powerA: me.powerScore,
          powerB: opp.powerScore,
          enqueuedAtMsA: me.enqueuedAt.getTime(),
          enqueuedAtMsB: opp.enqueuedAt.getTime(),
          queueIdA: me.id.toString(),
          queueIdB: opp.id.toString(),
        },
        idempotencyKey: `create_battle:${battleId.toString()}`,
      });

      await tx
        .delete(matchmakingQueue)
        .where(sql`${matchmakingQueue.address} IN (${lower}, ${opp.address})`);

      return { kind: 'matched', battleId, me: me as QueueRow, opp: opp as QueueRow, elapsedSec };
    });
  } catch (err) {
    // F-3L: chain-side simulate/insert threw (or F-3O lock_timeout fired,
    // or any other tx-internal failure). Tx auto-rollback — rows still
    // queued. Telemetry only.
    log.error(
      { err, address: lower },
      'tryMatchForPlayer: tx threw; rows preserved by rollback',
    );
    const errMessage = err instanceof Error ? err.message : String(err);

    // F-3R: write telemetry for BOTH players with real bracket/power/elapsed
    // values when we have them. Without this hoist, the catch only knew the
    // seeker's address and wrote `stakeBracket: 0, powerScore: 0,
    // elapsedSec: 0` placeholders — analytics couldn't distinguish a
    // Low-bracket lock_timeout from a High-bracket one, or attribute the
    // abort to the opponent.
    // F-3R: TS doesn't track assignments to `let` vars across the async
    // tx callback boundary, so from this scope's view `meRow`/`oppRow`
    // are still `null`. Explicit casts after the runtime guards re-assert
    // the types we know hold at runtime.
    const meRowCaptured = meRow as QueueRow | null;
    const oppRowCaptured = oppRow as QueueRow | null;
    if (meRowCaptured && oppRowCaptured) {
      const oppElapsedSec = Math.floor(
        (Date.now() - oppRowCaptured.enqueuedAt.getTime()) / 1000,
      );
      await db
        .insert(matchmakingDecisions)
        .values([
          {
            address: meRowCaptured.address,
            decision: 'aborted_chain_failure',
            stakeBracket: meRowCaptured.stakeBracket,
            powerScore: meRowCaptured.powerScore,
            elapsedSec: elapsedAtAbort,
            meta: JSON.stringify({ error: errMessage }),
          },
          {
            address: oppRowCaptured.address,
            decision: 'aborted_chain_failure',
            stakeBracket: oppRowCaptured.stakeBracket,
            powerScore: oppRowCaptured.powerScore,
            elapsedSec: oppElapsedSec,
            meta: JSON.stringify({ error: errMessage }),
          },
        ])
        .catch((logErr) => log.warn({ err: logErr }, 'aborted_chain_failure telemetry failed'));
    } else if (meRowCaptured) {
      // Opponent never got locked (tx threw early). Log seeker-only with
      // real context.
      await db
        .insert(matchmakingDecisions)
        .values({
          address: meRowCaptured.address,
          decision: 'aborted_chain_failure',
          stakeBracket: meRowCaptured.stakeBracket,
          powerScore: meRowCaptured.powerScore,
          elapsedSec: elapsedAtAbort,
          meta: JSON.stringify({ error: errMessage, partial: 'pre-opp-lock' }),
        })
        .catch((logErr) => log.warn({ err: logErr }, 'aborted_chain_failure telemetry failed'));
    } else {
      // Tx threw before any rows were locked (e.g., SET LOCAL itself
      // raced). Fall back to the placeholder behavior — no context to
      // report beyond the seeker's address.
      await db
        .insert(matchmakingDecisions)
        .values({
          address: lower,
          decision: 'aborted_chain_failure',
          stakeBracket: 0,
          powerScore: 0,
          elapsedSec: 0,
          meta: JSON.stringify({ error: errMessage, partial: 'pre-any-lock' }),
        })
        .catch((logErr) => log.warn({ err: logErr }, 'aborted_chain_failure telemetry failed'));
    }
    return null;
  }

  // ──────────── Outside the tx: telemetry + WS ────────────
  // All branches below are best-effort — failures don't undo the tx's work.

  if (outcome.kind === 'no_match') return null;

  if (outcome.kind === 'rpc_failure') {
    const { me, opp, meRpcOk, oppRpcOk, elapsedSec } = outcome;
    await db
      .insert(matchmakingDecisions)
      .values([
        {
          address: me.address,
          decision: 'aborted_rpc_failure',
          stakeBracket: me.stakeBracket,
          powerScore: me.powerScore,
          elapsedSec,
          meta: JSON.stringify({ meRpcOk, oppRpcOk }),
        },
        {
          address: opp.address,
          decision: 'aborted_rpc_failure',
          stakeBracket: opp.stakeBracket,
          powerScore: opp.powerScore,
          elapsedSec: Math.floor((Date.now() - opp.enqueuedAt.getTime()) / 1000),
          meta: JSON.stringify({ meRpcOk, oppRpcOk }),
        },
      ])
      .catch((err) => log.warn({ err }, 'aborted_rpc_failure telemetry failed'));
    return null;
  }

  if (outcome.kind === 'mutation') {
    const {
      me, opp,
      meCurrentPower, oppCurrentPower,
      meChanged, oppChanged,
      meInvalid, oppInvalid,
      meMutated, oppMutated,
      elapsedSec,
    } = outcome;
    const meta = JSON.stringify({
      me: { snapshot: me.powerScore, current: meCurrentPower, changed: meChanged, invalid: meInvalid },
      opp: { snapshot: opp.powerScore, current: oppCurrentPower, changed: oppChanged, invalid: oppInvalid },
    });
    await db
      .insert(matchmakingDecisions)
      .values([
        {
          address: me.address,
          decision: meMutated
            ? 'aborted_team_mutation_self'
            : 'aborted_team_mutation_by_opponent',
          stakeBracket: me.stakeBracket,
          powerScore: me.powerScore,
          elapsedSec,
          meta,
        },
        {
          address: opp.address,
          decision: oppMutated
            ? 'aborted_team_mutation_self'
            : 'aborted_team_mutation_by_opponent',
          stakeBracket: opp.stakeBracket,
          powerScore: opp.powerScore,
          elapsedSec: Math.floor((Date.now() - opp.enqueuedAt.getTime()) / 1000),
          meta,
        },
      ])
      .catch((err) => log.warn({ err }, 'aborted_team_mutation telemetry failed'));

    // F-3M: only notify the GUILTY side(s). The innocent opponent's queue
    // row was never deleted (F-3H restructure), so they remain queued and
    // will be re-tried on the next ticker pass. Sending them a
    // `match_cancelled` event would flip the frontend reducer's queue state
    // to `cancelled` even though they're still in the matchmaker's pool —
    // a stuck-visual UX where the WS subscription effectively halts but the
    // server still considers them queued.
    if (meMutated) {
      battleWS.notifyAddress(me.address, 'match_cancelled', {
        reason: 'team_mutation_self',
        yourPower: { snapshot: me.powerScore, current: meCurrentPower, invalid: meInvalid },
        enqueuedAtMs: me.enqueuedAt.getTime(),
        // F-Y3: collision-proof session id.
        queueId: me.id.toString(),
      });
    }
    if (oppMutated) {
      battleWS.notifyAddress(opp.address, 'match_cancelled', {
        reason: 'team_mutation_self',
        yourPower: { snapshot: opp.powerScore, current: oppCurrentPower, invalid: oppInvalid },
        enqueuedAtMs: opp.enqueuedAt.getTime(),
        queueId: opp.id.toString(),
      });
    }
    return null;
  }

  // outcome.kind === 'matched'
  // F-Y7: removed dead `stakeAmount` local — F-X3 dropped it from the WS
  // payload, leaving this line orphaned.
  const { battleId, me, opp, elapsedSec } = outcome;

  await db
    .insert(matchmakingDecisions)
    .values([
      {
        address: me.address,
        decision: elapsedSec >= 30 ? 'matched-after-expansion' : 'matched',
        stakeBracket: me.stakeBracket,
        powerScore: me.powerScore,
        elapsedSec,
        meta: JSON.stringify({
          opponent: opp.address,
          opponentPower: opp.powerScore,
          battleId: battleId.toString(),
        }),
      },
      {
        address: opp.address,
        decision: 'matched',
        stakeBracket: opp.stakeBracket,
        powerScore: opp.powerScore,
        elapsedSec: Math.floor((Date.now() - opp.enqueuedAt.getTime()) / 1000),
        meta: JSON.stringify({
          opponent: me.address,
          opponentPower: me.powerScore,
          battleId: battleId.toString(),
        }),
      },
    ])
    .catch((err) => log.warn({ err, battleId: battleId.toString() }, 'matched telemetry failed'));

  // PR-B X1: WS `match_found` is no longer emitted here. The on-chain
  // createBattle hasn't run yet (engine operator worker will pick up the
  // queued create_battle job and submit it ~now). Pre-PR-B this emit told
  // the frontend to navigate to /battle/[id], but the battle didn't exist
  // on chain → readBattle returned NOT_FOUND → entire flow broke.
  //
  // The frontend now learns about the match via `/queue/status` polling
  // (returns recentBattle with `status` field). The battle page handles
  // status=0 (pending_create) with a "Creating battle..." UI and flips
  // to the normal flow when status=1 (created). Latency ~3s vs the
  // previous instant emit; X10 (deferred) will reintroduce sub-second
  // WS notification via a Postgres LISTEN/NOTIFY bridge from engine→API.
  return {
    battleId,
    playerA: me.address,
    playerB: opp.address,
    stakeBracket: me.stakeBracket,
    powerA: me.powerScore,
    powerB: opp.powerScore,
  };
}

// ──────────── Telemetry helpers ────────────

/** Log a join decision (called from POST /queue immediately after insert). */
export async function logJoinDecision(
  address: string,
  bucket: PoolKey,
): Promise<void> {
  await db.insert(matchmakingDecisions).values({
    address: address.toLowerCase(),
    decision: 'join',
    stakeBracket: bucket.stakeBracket,
    powerScore: bucket.powerScore,
    elapsedSec: 0,
    meta: null,
  });
}

/** Log a self-cancel decision (called from DELETE /queue). */
export async function logCancelDecision(
  address: string,
  bucket: PoolKey,
  elapsedSec: number,
): Promise<void> {
  await db.insert(matchmakingDecisions).values({
    address: address.toLowerCase(),
    decision: 'cancel',
    stakeBracket: bucket.stakeBracket,
    powerScore: bucket.powerScore,
    elapsedSec: Math.max(0, Math.floor(elapsedSec)),
    meta: null,
  });
}

/** Log when a player's radius expanded — useful to correlate wait-time with
 *  successful matches in post-launch analysis. */
export async function logExpansionDecision(
  address: string,
  bucket: PoolKey,
  elapsedSec: number,
  newHalfWidth: number,
): Promise<void> {
  await db.insert(matchmakingDecisions).values({
    address: address.toLowerCase(),
    decision: 'expanded',
    stakeBracket: bucket.stakeBracket,
    powerScore: bucket.powerScore,
    elapsedSec: Math.floor(elapsedSec),
    meta: JSON.stringify({
      halfWidth: newHalfWidth === Infinity ? 'all' : newHalfWidth,
    }),
  });
}
