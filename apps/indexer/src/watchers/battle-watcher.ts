/**
 * Watches BattleArena events and syncs battle state to DB.
 *
 * Events: BattleCreated, StakeDeposited, TeamCommitted, TeamRevealed,
 *         MoveCommitted, MoveRevealed, BattleSettled, BattleCancelled,
 *         DamageApplied, AntiGriefSlashed
 *
 * F-3D / F-Z1 (PR 8): the StakeDeposited / TeamCommitted / TeamRevealed
 * handlers read chain battle state after each event lands, then update
 * the DB phase column based on truth. The previous design read a
 * `args.bothDeposited` field that the contract event doesn't emit, so DB
 * phase stayed at Deposit (1) forever — breaking F-15-a's phase filter
 * and F-Z1's recentBattle query. Reading authoritative chain state at
 * each event is one extra RPC per phase-change event (bounded, not
 * high-frequency), and idempotent — backfilled replays advance to the
 * latest phase truth.
 */
import type { Log } from 'viem';
import { and, eq, lt, sql } from 'drizzle-orm';
import { BattleArenaAbi, addresses, getBattleArena, getPublicClient } from '@clawbada/chain';
import {
  db,
  battles,
  battleRounds,
  agents,
  operatorJobs,
  applyBattleOutcome,
  currentBoostEpochId,
  recordParticipation,
  type BattleOutcomeResult,
} from '@clawbada/db';
import { calculateNewElo } from '@clawbada/game-logic';
import { EventWatcher, type WatcherConfig } from '../lib/event-processor';
// Aliased to `pinoLog` because `handleEvent(log: Log)` parameter shadows the
// module-scope name. Pino logger calls below use `pinoLog.warn(...)`.
import { log as pinoLog } from '../logger';

const isTestnet = process.env.CHAIN_ENV !== 'mainnet';

/** F-3D: zero hash sentinel used by Solidity to indicate "no commit yet"
 *  on the Battle struct's teamCommitA/B fields. Compared by string. */
const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

/** PR-8-FU LOW-04: lazy module-scope arena cache. Avoids reconstructing
 *  the viem `PublicClient` + contract wrapper on every chain read — the
 *  base watcher's `start()` already builds one client at boot; this helper
 *  shares the same pattern but lazily so it works in test contexts that
 *  don't run `start()`. */
let cachedArena: ReturnType<typeof getBattleArena> | null = null;
function getArena() {
  if (!cachedArena) {
    const client = getPublicClient(isTestnet);
    cachedArena = getBattleArena(client);
  }
  return cachedArena;
}

/** F-3D: read the parts of the on-chain Battle struct we need to drive
 *  DB phase advances. Returns null if the read fails — the caller treats
 *  that as "skip this phase update, retry on next event" rather than
 *  crashing the indexer loop.
 *
 *  PR-8-FU MEDIUM-02: log the failure. Silent `catch {}` was hiding RPC
 *  outages / quota exhaustion — handler then no-ops while block tracker
 *  still advances, leaving DB phase permanently below chain truth with
 *  zero signal. With logging, ops can spot the divergence in dashboards. */
async function readBattleForPhase(battleId: bigint): Promise<{
  depositA: boolean;
  depositB: boolean;
  teamCommitA: string;
  teamCommitB: string;
  teamRevealedA: boolean;
  teamRevealedB: boolean;
} | null> {
  try {
    const arena = getArena();
    const data = await arena.read.getBattle([battleId]);
    return {
      depositA: data.depositA,
      depositB: data.depositB,
      teamCommitA: data.teamCommitA as string,
      teamCommitB: data.teamCommitB as string,
      teamRevealedA: data.teamRevealedA,
      teamRevealedB: data.teamRevealedB,
    };
  } catch (err) {
    pinoLog.warn(
      { err, battleId: battleId.toString(), module: 'battle-watcher', op: 'readBattleForPhase' },
      'getBattle read failed — DB phase advance skipped for this event',
    );
    return null;
  }
}

/** Boost: the team ids a battle is fought with. `teamA/teamB` stay 0 until each
 *  reveal lands (and the F5-01 atomic reveal is resolver-submitted), so fall back to
 *  the ids the players queued with (A2). Null when either side is unknown. */
function resolveBattleTeams(row: {
  teamA: bigint | null;
  teamB: bigint | null;
  queuedTeamA: bigint | null;
  queuedTeamB: bigint | null;
}): { teamA: bigint; teamB: bigint } | null {
  const teamA = row.teamA && row.teamA !== 0n ? row.teamA : row.queuedTeamA;
  const teamB = row.teamB && row.teamB !== 0n ? row.teamB : row.queuedTeamB;
  if (!teamA || !teamB || teamA === 0n || teamB === 0n) return null;
  return { teamA, teamB };
}

export class BattleWatcher extends EventWatcher {
  readonly config: WatcherConfig = {
    contractName: 'BattleArena',
    abi: BattleArenaAbi as any,
    address: addresses.battleArena,
    events: [
      'BattleCreated', 'StakeDeposited', 'TeamCommitted', 'TeamRevealed',
      'MoveCommitted', 'MoveRevealed',
      // X12: BattleProposed fires from settle() — proposes the outcome and
      // opens the H-01 dispute window. Drives DB phase to AwaitingFinalize (5).
      'BattleProposed',
      'BattleSettled', 'BattleCancelled',
      'DamageApplied', 'AntiGriefSlashed',
    ],
  };

  async handleEvent(log: Log): Promise<void> {
    const event = log as any;
    const name = event.eventName;
    const args = event.args ?? {};

    switch (name) {
      case 'BattleCreated': {
        const battleId = BigInt(args.battleId);
        const existing = await db
          .select()
          .from(battles)
          .where(eq(battles.battleId, battleId))
          .limit(1);

        if (existing.length === 0) {
          // A2-FU-01: this is the fallback insert path — reached when
          // `BattleCreated` fires for a battle whose matchmaker DB row never
          // landed (e.g., matchmaker tx aborted between createBattle simulation
          // and DB commit, or an out-of-band caller invoked createBattle
          // directly). The contract event doesn't carry queued team IDs, so
          // these rows have NULL queuedTeamA/B and the frontend will route
          // affected participants to PrivateTeamLoadingOrError → repair-needed.
          // Log loudly so ops can backfill or cancel the orphan battle.
          pinoLog.warn(
            { battleId: battleId.toString(), playerA: args.playerA, playerB: args.playerB, module: 'battle-watcher', op: 'BattleCreated' },
            'BattleCreated for unknown battle — fallback insert without queued team IDs (ops repair needed)',
          );
          // F-12: contract emits stakeAmount in wei (1e18 units). Persist as
          // DISPLAY value (divide by 1e18) so the `battles.stakeAmount`
          // column stays semantically aligned with what the matchmaker
          // writes and what frontend `formatClaw` consumers expect.
          const stakeWei = BigInt(args.stakeAmount);
          const stakeDisplay = stakeWei / (10n ** 18n);
          await db.insert(battles).values({
            battleId,
            playerA: (args.playerA as string).toLowerCase(),
            playerB: (args.playerB as string).toLowerCase(),
            teamA: 0n,
            teamB: 0n,
            stakeBracket: 0,
            stakeAmount: stakeDisplay.toString(),
            phase: 1, // BattlePhase.Deposit
            // F-04: matchmaker's power snapshot is canonical. Defensive cast —
            // viem may surface the args as numbers or bigints depending on
            // version; Number(...) handles both for the smallint columns.
            powerA: Number(args.powerA),
            powerB: Number(args.powerB),
          });
        }
        break;
      }

      case 'StakeDeposited': {
        // F-3D: contract's StakeDeposited event has no `bothDeposited` field;
        // read the Battle struct to determine whether both deposits have
        // landed. Skip the update if the read fails — the next phase event
        // will reconverge DB phase to truth.
        //
        // PR-8-FU H-01: non-regressing UPDATE — only advance phase forward
        // (`lt(phase, 2)`). Required because the chain read returns CURRENT
        // state, not state at the event's block. If a `StakeDeposited` is
        // redelivered for an already-settled battle (reorg / DB restore /
        // stale block_tracker), `depositA && depositB` is still true on
        // chain (those flags never reset post-settle) and the unguarded
        // UPDATE would overwrite phase 6 → 2.
        const battleId = BigInt(args.battleId);
        const state = await readBattleForPhase(battleId);
        if (state && state.depositA && state.depositB) {
          await db
            .update(battles)
            .set({ phase: 2 }) // BattlePhase.TeamCommit (contract index)
            .where(and(eq(battles.battleId, battleId), lt(battles.phase, 2)));
        }
        break;
      }

      case 'TeamCommitted': {
        // F-3D: contract has no per-event "both committed" flag and no
        // `getBattle` slot we can derive it from other than the commit
        // hashes themselves (both non-zero ⇒ both committed). Idempotent:
        // first-commit reads see only one non-zero hash and do not advance.
        //
        // PR-8-FU H-01: non-regressing UPDATE — see StakeDeposited comment.
        const battleId = BigInt(args.battleId);
        const state = await readBattleForPhase(battleId);
        if (
          state &&
          state.teamCommitA !== ZERO_BYTES32 &&
          state.teamCommitB !== ZERO_BYTES32
        ) {
          await db
            .update(battles)
            .set({ phase: 3 }) // BattlePhase.TeamReveal (contract index)
            .where(and(eq(battles.battleId, battleId), lt(battles.phase, 3)));
        }
        break;
      }

      case 'TeamRevealed': {
        // F-3D: two responsibilities here — record the revealed team-id
        // against the correct player slot (pre-existing) AND advance phase
        // to Active once the second reveal lands (PR 8 addition).
        //
        // PR-8-FU H-01: phase advance UPDATE is non-regressing. The teamA/
        // teamB update below is NOT guarded — it's idempotent in practice
        // (revealed teamId is immutable on-chain) and the pre-existing
        // behavior; not a PR-8 introduced surface.
        const battleId = BigInt(args.battleId);
        const player = (args.player as string).toLowerCase();
        const teamId = BigInt(args.teamId);

        const battle = await db
          .select()
          .from(battles)
          .where(eq(battles.battleId, battleId))
          .limit(1);

        if (battle.length > 0) {
          const isPlayerA = battle[0].playerA === player;
          await db
            .update(battles)
            .set(isPlayerA ? { teamA: teamId } : { teamB: teamId })
            .where(eq(battles.battleId, battleId));
        }

        const state = await readBattleForPhase(battleId);
        if (state && state.teamRevealedA && state.teamRevealedB) {
          await db
            .update(battles)
            .set({ phase: 4 }) // BattlePhase.Active (contract index)
            .where(and(eq(battles.battleId, battleId), lt(battles.phase, 4)));
        }
        break;
      }

      case 'BattleProposed': {
        // X12: contract `settle()` emits this after the resolver proposes
        // the outcome (BattleArena.sol:536). Phase transitions to
        // AwaitingFinalize (5). The dispute window stays open until
        // `payoutDeadline` (already a chain-side field; the indexer just
        // mirrors the phase so consumers can render the dispute UI).
        //
        // Phase regression guard via `lt(phase, 5)` mirrors the
        // StakeDeposited / TeamCommitted / TeamRevealed pattern: a
        // redelivered BattleProposed for a battle that already moved past
        // AwaitingFinalize (e.g., subsequently Settled or Cancelled) won't
        // regress the DB row.
        const battleId = BigInt(args.battleId);
        await db
          .update(battles)
          .set({ phase: 5 }) // BattlePhase.AwaitingFinalize
          .where(and(eq(battles.battleId, battleId), lt(battles.phase, 5)));

        // Boost: the match has been fought to a result, so this is where a
        // battle counts as PLAYED for boost qualification (played, never
        // won) - the outcome is not final until BattleSettled.
        await this.recordProposedParticipation(battleId);
        break;
      }

      case 'BattleSettled': {
        // F-13: phase numerics mirror the contract enum exactly. Settled=6.
        //
        // Codex PR-C FU F-01: settle accounting (battles row + agents ELO/
        // wins/losses/totalBattles) runs HERE, at on-chain finality. The
        // contract's `settle()` is only step 1 (proposes outcome, opens
        // dispute window); `BattleSettled` fires from `_executePayout`
        // after `finalizeBattle` / `adminResolveDispute` resolves the real
        // winner. Writing accounting at settle-proposal time would let a
        // successful disputer's correct outcome lose to the pre-finality
        // ELO/win-loss credit.
        //
        // F-02: contract emits `winnerPayout` and `protocolFee` in wei
        // (1e18 units). DB columns are display-scale (`stakeAmount`
        // matches the matchmaker's display string). Divide before write.
        //
        // F-03: transaction-guarded with `settledAt IS NULL` to make the
        // helper idempotent across reorg / replay. If the row is already
        // settled, the entire transaction no-ops (no double ELO).
        const battleId = BigInt(args.battleId);
        const winnerLower = (args.winner as string).toLowerCase();
        const winnerPayoutDisplay = (BigInt(args.winnerPayout) / 10n ** 18n).toString();
        const protocolFeeDisplay = (BigInt(args.protocolFee) / 10n ** 18n).toString();

        await db.transaction(async (tx) => {
          const [existing] = await tx
            .select({
              playerA: battles.playerA,
              playerB: battles.playerB,
              settledAt: battles.settledAt,
              phase: battles.phase,
              teamA: battles.teamA,
              teamB: battles.teamB,
              queuedTeamA: battles.queuedTeamA,
              queuedTeamB: battles.queuedTeamB,
              powerA: battles.powerA,
              powerB: battles.powerB,
            })
            .from(battles)
            .where(eq(battles.battleId, battleId))
            .limit(1);
          if (!existing) {
            pinoLog.warn(
              { battleId: battleId.toString(), module: 'battle-watcher', op: 'BattleSettled' },
              'BattleSettled for unknown battle row — skipping accounting',
            );
            return;
          }
          if (existing.settledAt) {
            // Already settled; idempotent skip.
            return;
          }

          const [maxRoundRow] = await tx
            .select({ max: sql<number>`COALESCE(MAX(${battleRounds.round}), 0)` })
            .from(battleRounds)
            .where(eq(battleRounds.battleId, battleId));
          const totalRounds = Number(maxRoundRow?.max ?? 0);

          await tx
            .update(battles)
            .set({
              winner: winnerLower,
              phase: 6, // Settled
              settledAt: new Date(),
              winnerPayout: winnerPayoutDisplay,
              protocolFee: protocolFeeDisplay,
              totalRounds,
            })
            .where(eq(battles.battleId, battleId));

          const isWinnerA = existing.playerA.toLowerCase() === winnerLower;
          const winnerPlayer = (isWinnerA ? existing.playerA : existing.playerB).toLowerCase();
          const loserPlayer = (isWinnerA ? existing.playerB : existing.playerA).toLowerCase();

          // Codex cross-cutting MEDIUM-1: upsert agent rows before UPDATE
          // so battles between unregistered wallets still record ELO /
          // win-loss / totalBattles. Queue join falls back to default ELO
          // without inserting an agents row (queue.ts), so missing rows are
          // a real case. Upsert via INSERT ... ON CONFLICT DO NOTHING.
          await tx
            .insert(agents)
            .values({ address: winnerPlayer })
            .onConflictDoNothing();
          await tx
            .insert(agents)
            .values({ address: loserPlayer })
            .onConflictDoNothing();

          const [winnerAgent] = await tx
            .select()
            .from(agents)
            .where(eq(agents.address, winnerPlayer))
            .limit(1);
          const [loserAgent] = await tx
            .select()
            .from(agents)
            .where(eq(agents.address, loserPlayer))
            .limit(1);
          const winnerElo = winnerAgent?.elo ?? 1200;
          const loserElo = loserAgent?.elo ?? 1200;
          const { newWinnerElo, newLoserElo } = calculateNewElo(winnerElo, loserElo);

          await tx
            .update(agents)
            .set({
              elo: newWinnerElo,
              wins: (winnerAgent?.wins ?? 0) + 1,
              totalBattles: (winnerAgent?.totalBattles ?? 0) + 1,
            })
            .where(eq(agents.address, winnerPlayer));

          await tx
            .update(agents)
            .set({
              elo: newLoserElo,
              losses: (loserAgent?.losses ?? 0) + 1,
              totalBattles: (loserAgent?.totalBattles ?? 0) + 1,
            })
            .where(eq(agents.address, loserPlayer));

          // Boost: team-keyed rating (K=32) + the played ledger, in the same
          // transaction as the wallet accounting so both land or neither does
          // (the `settledAt IS NULL` guard above makes a retry safe).
          // kind: a mirrored BattleProposed (phase 5) means the match was
          // played out; settling straight from Active is `_forfeitAsLoss`,
          // which emits BattleSettled without a proposal.
          const teamIds = resolveBattleTeams(existing);
          const kind = existing.phase === 5 ? 'battle' : 'forfeit_loss';
          let teamRating: BattleOutcomeResult | null = null;
          if (teamIds) {
            const epochId = await currentBoostEpochId(tx);
            teamRating = await applyBattleOutcome(tx, {
              battleId,
              teamA: teamIds.teamA,
              teamB: teamIds.teamB,
              winnerTeam: isWinnerA ? teamIds.teamA : teamIds.teamB,
              epochId,
              kind,
              // Baseline rows for teams the indexer never rated (out-of-order
              // events); power falls back to the eligibility floor.
              fallback: {
                ownerA: existing.playerA,
                ownerB: existing.playerB,
                powerA: existing.powerA ?? 3,
                powerB: existing.powerB ?? 3,
              },
            });
          } else {
            pinoLog.warn(
              { battleId: battleId.toString(), module: 'battle-watcher', op: 'BattleSettled' },
              'BattleSettled with unknown team ids - team rating not updated (wallet accounting applied)',
            );
          }

          pinoLog.info(
            {
              battleId: battleId.toString(),
              winner: winnerLower,
              winnerPayout: winnerPayoutDisplay,
              protocolFee: protocolFeeDisplay,
              totalRounds,
              kind,
              teamA: teamIds?.teamA.toString(),
              teamB: teamIds?.teamB.toString(),
              teamRating,
              module: 'battle-watcher',
              op: 'BattleSettled',
            },
            'applied settle accounting + ELO updates',
          );
        });
        break;
      }

      case 'BattleCancelled': {
        // F-13: Cancelled=7 (was misnumbered as 8 under the old game-logic enum).
        const battleId = BigInt(args.battleId);
        await db
          .update(battles)
          .set({ phase: 7 }) // BattlePhase.Cancelled (contract index)
          .where(eq(battles.battleId, battleId));
        break;
      }

      case 'MoveRevealed': {
        // PR-C X2: when both players have revealed for the current round,
        // enqueue a `resolve_round` operator job. The engine's
        // resolveRoundHandler reads chain state, replays prior rounds
        // from on_chain_events (this watcher already stored the args via
        // event-processor.ts:115), resolves the round, persists
        // battle_rounds, and submits advanceRound or settle.
        //
        // Read the chain to confirm both reveals are present for the
        // CURRENT round (the second MoveRevealed event for round R could
        // arrive in a batch with the first; we only enqueue once both are
        // visible). UNIQUE idempotency_key prevents duplicate enqueue.
        const battleId = BigInt(args.battleId);
        const eventRound = Number(args.round);
        try {
          const client = getPublicClient(isTestnet) as any;
          const arena = getBattleArena(client);
          const b = await arena.read.getBattle([battleId]);
          if (
            b.roundRevealedA &&
            b.roundRevealedB &&
            Number(b.currentRound) === eventRound
          ) {
            await db
              .insert(operatorJobs)
              .values({
                jobType: 'resolve_round',
                payload: { battleId: battleId.toString(), round: eventRound },
                idempotencyKey: `resolve_round:${battleId.toString()}:${eventRound}`,
              })
              .onConflictDoNothing();
          }
        } catch (err) {
          pinoLog.warn(
            { err, battleId: battleId.toString(), round: eventRound, module: 'battle-watcher', op: 'MoveRevealed' },
            'failed to enqueue resolve_round; relying on next MoveRevealed event or backfill',
          );
        }
        break;
      }

      // Other events logged in on_chain_events via base class
      case 'MoveCommitted':
      case 'DamageApplied':
      case 'AntiGriefSlashed':
        break;
    }
  }

  /** Boost: write the `battle_participation` rows for both teams at BattleProposed.
   *  Failures are logged, not thrown: the phase mirror above must never depend on the
   *  rating layer, and a miss self-heals at BattleSettled, where applyBattleOutcome
   *  upserts the same ledger rows. */
  private async recordProposedParticipation(battleId: bigint): Promise<void> {
    try {
      const [row] = await db
        .select({
          teamA: battles.teamA,
          teamB: battles.teamB,
          queuedTeamA: battles.queuedTeamA,
          queuedTeamB: battles.queuedTeamB,
        })
        .from(battles)
        .where(eq(battles.battleId, battleId))
        .limit(1);
      const teamIds = row ? resolveBattleTeams(row) : null;
      if (!teamIds) {
        pinoLog.warn(
          { battleId: battleId.toString(), module: 'battle-watcher', op: 'BattleProposed' },
          'BattleProposed with unknown team ids - participation not recorded',
        );
        return;
      }

      const epochId = await currentBoostEpochId(db);
      const recorded = await db.transaction(async (tx) => {
        const a = await recordParticipation(tx, {
          battleId,
          teamId: teamIds.teamA,
          opponentTeamId: teamIds.teamB,
          epochId,
          kind: 'played',
        });
        const b = await recordParticipation(tx, {
          battleId,
          teamId: teamIds.teamB,
          opponentTeamId: teamIds.teamA,
          epochId,
          kind: 'played',
        });
        return { a, b };
      });
      pinoLog.info(
        {
          battleId: battleId.toString(),
          teamA: teamIds.teamA.toString(),
          teamB: teamIds.teamB.toString(),
          epochId,
          recordedA: recorded.a,
          recordedB: recorded.b,
          module: 'battle-watcher',
          op: 'BattleProposed',
        },
        'recorded battle participation',
      );
    } catch (err) {
      pinoLog.error(
        { err, battleId: battleId.toString(), module: 'battle-watcher', op: 'BattleProposed' },
        'failed to record battle participation; BattleSettled will upsert it',
      );
    }
  }
}
