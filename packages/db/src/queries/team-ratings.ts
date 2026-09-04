/**
 * Team rating persistence — the shared primitives behind the battle-rank mining boost.
 *
 * Used by three processes, so the rules live here once:
 *  - API `POST /queue`  → `ensureTeamRating` (lazy lineage safety net, rating for the band)
 *  - indexer            → `recordParticipation` at BattleProposed, `applyBattleOutcome` at
 *                          BattleSettled, `ensureTeamRating` at TeamCreated,
 *                          `applyPowerChange` at LobsterEvolved
 *  - engine epoch job   → reads `team_ratings` / `battle_participation`, applies idle decay
 *
 * Every function accepts either the root `db` or a transaction handle and is idempotent
 * where a replay is possible (indexer re-delivery, two settlement writers).
 */

import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { RATING_BASELINE, eloUpdate, lineageDecision } from '@clawbada/game-logic';
import type { Database } from '../client';
import { battleParticipation, ratingEvents, teamRatings, teams } from '../schema/index';

/** Root db or a transaction handle — both expose the same query builders. */
export type DbExecutor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

export interface RosterInput {
  teamId: bigint;
  owner: string;
  lobsterIds: readonly [bigint, bigint, bigint];
  /** Team Power 3..9 (sum of evolution tiers). */
  power: number;
  /** Current boost window index. */
  epochId: number;
}

export interface LineageMatch {
  parentTeamId: bigint;
  shared: number;
  parent: { rating: number; power: number; gamesPlayedEpoch: number; epochId: number };
}

/** Find the disbanded team this roster descends from: the un-consumed rated team sharing
 *  the most lobsters (ties → most recently disbanded). Owner-agnostic on purpose — rank
 *  rides with the roster. */
export async function resolveLineage(dbx: DbExecutor, r: RosterInput): Promise<LineageMatch | null> {
  const ids = [...r.lobsterIds];
  const shared = sql<number>`(
    (CASE WHEN ${inArray(teams.lobster0, ids)} THEN 1 ELSE 0 END) +
    (CASE WHEN ${inArray(teams.lobster1, ids)} THEN 1 ELSE 0 END) +
    (CASE WHEN ${inArray(teams.lobster2, ids)} THEN 1 ELSE 0 END)
  )`;
  const rows = await dbx
    .select({
      parentTeamId: teamRatings.teamId,
      rating: teamRatings.rating,
      power: teamRatings.power,
      gamesPlayedEpoch: teamRatings.gamesPlayedEpoch,
      epochId: teamRatings.epochId,
      shared,
    })
    .from(teamRatings)
    .innerJoin(teams, eq(teams.teamId, teamRatings.teamId))
    .where(
      and(
        isNotNull(teams.disbandedAt),
        isNull(teamRatings.lineageConsumedBy),
        ne(teamRatings.teamId, r.teamId),
        or(inArray(teams.lobster0, ids), inArray(teams.lobster1, ids), inArray(teams.lobster2, ids)),
      ),
    )
    .orderBy(desc(shared), desc(teams.disbandedAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    parentTeamId: row.parentTeamId,
    shared: Number(row.shared),
    parent: { rating: row.rating, power: row.power, gamesPlayedEpoch: row.gamesPlayedEpoch, epochId: row.epochId },
  };
}

export interface EnsureResult {
  rating: number;
  power: number;
  /** A new team_ratings row was written. */
  created: boolean;
  /** An existing row was reset because the roster's Power changed. */
  reset: boolean;
}

/** Make sure a live team has a rating row, resolving lineage on first sight and forcing a
 *  full re-qualification if the stored Power no longer matches. Safe to call from several
 *  processes: the insert is conflict-tolerant and a parent's rating is consumed exactly once. */
export async function ensureTeamRating(dbx: DbExecutor, r: RosterInput): Promise<EnsureResult> {
  const [existing] = await dbx.select().from(teamRatings).where(eq(teamRatings.teamId, r.teamId)).limit(1);
  if (existing) {
    if (existing.power !== r.power) {
      await applyPowerChange(dbx, r.teamId, r.power, r.epochId);
      return { rating: RATING_BASELINE, power: r.power, created: false, reset: true };
    }
    return { rating: existing.rating, power: existing.power, created: false, reset: false };
  }

  const match = await resolveLineage(dbx, r);
  let decision = lineageDecision({
    parent: match?.parent ?? null,
    shared: match?.shared ?? 0,
    childPower: r.power,
    currentEpochId: r.epochId,
  });

  // Consume the parent BEFORE inserting so two successors racing for the same parent
  // cannot both inherit: whoever flips lineage_consumed_by first wins, the other is fresh.
  let parentTeamId: bigint | null = null;
  if (match && decision.reason !== 'fresh') {
    const consumed = await dbx
      .update(teamRatings)
      .set({ lineageConsumedBy: r.teamId, updatedAt: new Date() })
      .where(and(eq(teamRatings.teamId, match.parentTeamId), isNull(teamRatings.lineageConsumedBy)))
      .returning({ teamId: teamRatings.teamId });
    if (consumed.length === 1) {
      parentTeamId = match.parentTeamId;
    } else {
      decision = lineageDecision({ parent: null, shared: 0, childPower: r.power, currentEpochId: r.epochId });
    }
  }

  const inserted = await dbx
    .insert(teamRatings)
    .values({
      teamId: r.teamId,
      owner: r.owner.toLowerCase(),
      rating: decision.rating,
      power: r.power,
      epochId: r.epochId,
      gamesPlayedEpoch: decision.gamesPlayedEpoch,
      lineageParentId: parentTeamId,
      lineageShared: parentTeamId === null ? null : match!.shared,
      lineageReason: decision.reason,
    })
    .onConflictDoNothing()
    .returning({ teamId: teamRatings.teamId });

  if (inserted.length === 0) {
    // Another writer created the row between our select and insert; report theirs.
    const [row] = await dbx.select().from(teamRatings).where(eq(teamRatings.teamId, r.teamId)).limit(1);
    return { rating: row?.rating ?? RATING_BASELINE, power: row?.power ?? r.power, created: false, reset: false };
  }

  await dbx.insert(ratingEvents).values({
    teamId: r.teamId,
    opponentTeamId: parentTeamId,
    epochId: r.epochId,
    kind: 'lineage',
    ratingBefore: parentTeamId === null ? RATING_BASELINE : match!.parent.rating,
    ratingAfter: decision.rating,
  });

  return { rating: decision.rating, power: r.power, created: true, reset: false };
}

/** Full re-qualification: rating back to baseline, played counter cleared, Power updated.
 *  No-op (false) if the team is unrated or already at that Power. */
export async function applyPowerChange(
  dbx: DbExecutor,
  teamId: bigint,
  newPower: number,
  epochId: number,
): Promise<boolean> {
  const [row] = await dbx.select().from(teamRatings).where(eq(teamRatings.teamId, teamId)).limit(1);
  if (!row || row.power === newPower) return false;
  await dbx
    .update(teamRatings)
    .set({
      rating: RATING_BASELINE,
      power: newPower,
      epochId,
      gamesPlayedEpoch: 0,
      lineageReason: 'power_changed',
      updatedAt: new Date(),
    })
    .where(eq(teamRatings.teamId, teamId));
  await dbx.insert(ratingEvents).values({
    teamId,
    epochId,
    kind: 'power_reset',
    ratingBefore: row.rating,
    ratingAfter: RATING_BASELINE,
  });
  return true;
}

export interface ParticipationInput {
  battleId: bigint;
  teamId: bigint;
  opponentTeamId: bigint | null;
  epochId: number;
  kind?: 'played' | 'forfeit_loss';
}

/** Record that a team played a battle in an epoch. Returns false on replay. Also keeps the
 *  `team_ratings.games_played_epoch` cache in step (the ledger stays authoritative). */
export async function recordParticipation(dbx: DbExecutor, p: ParticipationInput): Promise<boolean> {
  const inserted = await dbx
    .insert(battleParticipation)
    .values({
      battleId: p.battleId,
      teamId: p.teamId,
      opponentTeamId: p.opponentTeamId,
      epochId: p.epochId,
      kind: p.kind ?? 'played',
    })
    .onConflictDoNothing()
    .returning({ battleId: battleParticipation.battleId });
  if (inserted.length === 0) return false;

  await dbx
    .update(teamRatings)
    .set({
      gamesPlayedEpoch: sql`CASE
        WHEN ${teamRatings.epochId} = ${p.epochId} THEN ${teamRatings.gamesPlayedEpoch} + 1
        WHEN ${teamRatings.epochId} < ${p.epochId} THEN 1
        ELSE ${teamRatings.gamesPlayedEpoch} END`,
      epochId: sql`GREATEST(${teamRatings.epochId}, ${p.epochId})`,
      gamesPlayedTotal: sql`${teamRatings.gamesPlayedTotal} + 1`,
      lastBattleAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(teamRatings.teamId, p.teamId));
  return true;
}

export interface BattleOutcomeInput {
  battleId: bigint;
  teamA: bigint;
  teamB: bigint;
  winnerTeam: bigint;
  epochId: number;
  /** 'forfeit_loss' when the loser forfeited during play (BattleArena._forfeitAsLoss). */
  kind?: 'battle' | 'forfeit_loss';
  /** Used to create baseline rows for teams the indexer has not rated yet. */
  fallback?: { ownerA: string; ownerB: string; powerA: number; powerB: number };
}

export interface BattleOutcomeResult {
  applied: boolean;
  ratingA?: number;
  ratingB?: number;
}

/** Apply a final battle result to both teams' ratings (K=32), exactly once per battle.
 *  Call inside a transaction: rows are locked FOR UPDATE in teamId order so concurrent
 *  writers (engine + indexer) serialize instead of double-applying. */
export async function applyBattleOutcome(dbx: DbExecutor, o: BattleOutcomeInput): Promise<BattleOutcomeResult> {
  if (o.winnerTeam !== o.teamA && o.winnerTeam !== o.teamB) {
    throw new Error(`winnerTeam ${o.winnerTeam} is neither teamA ${o.teamA} nor teamB ${o.teamB}`);
  }
  const kind = o.kind ?? 'battle';
  const loserTeam = o.winnerTeam === o.teamA ? o.teamB : o.teamA;

  // The played ledger must exist regardless of whether the rating step is a replay.
  await recordParticipation(dbx, { battleId: o.battleId, teamId: o.winnerTeam, opponentTeamId: loserTeam, epochId: o.epochId });
  await recordParticipation(dbx, {
    battleId: o.battleId,
    teamId: loserTeam,
    opponentTeamId: o.winnerTeam,
    epochId: o.epochId,
    kind: kind === 'forfeit_loss' ? 'forfeit_loss' : 'played',
  });

  const ids = [o.teamA, o.teamB].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let rows = await dbx.select().from(teamRatings).where(inArray(teamRatings.teamId, ids)).for('update');

  // Create baseline rows for anything the indexer has not rated yet (out-of-order events).
  if (rows.length < 2 && o.fallback) {
    const have = new Set(rows.map((r) => r.teamId));
    const missing: { teamId: bigint; owner: string; power: number }[] = [];
    if (!have.has(o.teamA)) missing.push({ teamId: o.teamA, owner: o.fallback.ownerA, power: o.fallback.powerA });
    if (!have.has(o.teamB)) missing.push({ teamId: o.teamB, owner: o.fallback.ownerB, power: o.fallback.powerB });
    for (const m of missing) {
      await dbx
        .insert(teamRatings)
        .values({ teamId: m.teamId, owner: m.owner.toLowerCase(), power: m.power, epochId: o.epochId })
        .onConflictDoNothing();
    }
    rows = await dbx.select().from(teamRatings).where(inArray(teamRatings.teamId, ids)).for('update');
  }
  if (rows.length < 2) {
    throw new Error(`applyBattleOutcome: missing team_ratings rows for battle ${o.battleId} (have ${rows.length})`);
  }

  // Idempotency check AFTER taking the row locks, so a concurrent writer sees our events.
  const [dup] = await dbx
    .select({ id: ratingEvents.id })
    .from(ratingEvents)
    .where(
      and(
        eq(ratingEvents.battleId, o.battleId),
        eq(ratingEvents.teamId, o.winnerTeam),
        inArray(ratingEvents.kind, ['battle', 'forfeit_loss']),
      ),
    )
    .limit(1);
  if (dup) return { applied: false };

  const winnerRow = rows.find((r) => r.teamId === o.winnerTeam)!;
  const loserRow = rows.find((r) => r.teamId === loserTeam)!;
  const next = eloUpdate(winnerRow.rating, loserRow.rating);
  const now = new Date();

  await dbx
    .update(teamRatings)
    .set({ rating: next.winner, wins: sql`${teamRatings.wins} + 1`, lastBattleAt: now, updatedAt: now })
    .where(eq(teamRatings.teamId, o.winnerTeam));
  await dbx
    .update(teamRatings)
    .set({ rating: next.loser, losses: sql`${teamRatings.losses} + 1`, lastBattleAt: now, updatedAt: now })
    .where(eq(teamRatings.teamId, loserTeam));

  await dbx.insert(ratingEvents).values([
    {
      battleId: o.battleId,
      teamId: o.winnerTeam,
      opponentTeamId: loserTeam,
      epochId: o.epochId,
      kind: 'battle',
      outcome: 1,
      ratingBefore: winnerRow.rating,
      ratingAfter: next.winner,
    },
    {
      battleId: o.battleId,
      teamId: loserTeam,
      opponentTeamId: o.winnerTeam,
      epochId: o.epochId,
      kind,
      outcome: 0,
      ratingBefore: loserRow.rating,
      ratingAfter: next.loser,
    },
  ]);

  const ratingA = o.winnerTeam === o.teamA ? next.winner : next.loser;
  const ratingB = o.winnerTeam === o.teamB ? next.winner : next.loser;
  return { applied: true, ratingA, ratingB };
}

/** Apply one epoch of idle decay to a team. Returns false if the (team, epoch) pair was
 *  already decayed — the partial unique index makes a re-run a no-op. */
export async function applyIdleDecay(
  dbx: DbExecutor,
  teamId: bigint,
  epochId: number,
  ratingBefore: number,
  ratingAfter: number,
): Promise<boolean> {
  const inserted = await dbx
    .insert(ratingEvents)
    .values({ teamId, epochId, kind: 'idle_decay', ratingBefore, ratingAfter })
    .onConflictDoNothing()
    .returning({ id: ratingEvents.id });
  if (inserted.length === 0) return false;
  if (ratingAfter !== ratingBefore) {
    await dbx
      .update(teamRatings)
      .set({ rating: ratingAfter, updatedAt: new Date() })
      .where(eq(teamRatings.teamId, teamId));
  }
  return true;
}
