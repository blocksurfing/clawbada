/**
 * All battle-session persistence in one place (drizzle over `battle_sessions`,
 * `battle_turns`, `battles`, `operator_jobs`). Injected into the manager so tests
 * can replace it wholesale.
 */
import { and, asc, eq, sql, notExists } from 'drizzle-orm';
import { db, battleSessions, battleTurns, battles, operatorJobs, type Database } from '@clawbada/db';
import type { PersistedTurn, SnapshotWrite } from './session';
import type { RosterEntry, SessionKind, Side } from './protocol';

export type SessionRow = typeof battleSessions.$inferSelect;
export type TurnRow = typeof battleTurns.$inferSelect;

export interface NewSessionRow {
  id: string;
  kind: SessionKind;
  playerA: string;
  playerB: string;
  bot: string | null;
  tier: string;
  vrfRound: number | null;
  roster: RosterEntry[];
  stateJson: string;
  turn: number;
  deadline: Date | null;
  timeouts: Record<Side, number>;
  status: 'active';
}

export interface SettleJobPayload {
  battleId: string;
  winner: string; // wallet or 'draw'
  finalStateHash: string;
  turnLogHash: string;
  damageA: [number, number, number];
  damageB: [number, number, number];
}

export interface PendingRealBattle {
  battleId: bigint;
  playerA: string;
  playerB: string;
  teamA: bigint;
  teamB: bigint;
}

export class SessionStore {
  constructor(private readonly dbx: Database = db) {}

  /** Insert the row; false if the id already exists (claim lost / duplicate). */
  async insertSession(row: NewSessionRow): Promise<boolean> {
    const inserted = await this.dbx
      .insert(battleSessions)
      .values({ ...row, updatedAt: new Date() })
      .onConflictDoNothing()
      .returning({ id: battleSessions.id });
    return inserted.length > 0;
  }

  /** Fill in the fields a real battle only knows after the chain + beacon reads. */
  async initSession(id: string, patch: { tier: string; roster: RosterEntry[]; stateJson: string; vrfRound: number | null }): Promise<void> {
    await this.dbx.update(battleSessions).set({ ...patch, updatedAt: new Date() }).where(eq(battleSessions.id, id));
  }

  async writeTurns(sessionId: string, turns: PersistedTurn[], snap: SnapshotWrite): Promise<void> {
    await this.dbx.transaction(async (tx) => {
      for (const t of turns) {
        await tx
          .insert(battleTurns)
          .values({ sessionId, turn: t.turn, lobsterId: t.lobsterId, command: t.command ?? null, result: t.result, postStateHash: t.postStateHash, submittedBy: t.submittedBy })
          .onConflictDoNothing();
      }
      await tx
        .update(battleSessions)
        .set({ stateJson: snap.stateJson, turn: snap.turn, deadline: snap.deadline, timeouts: snap.timeouts, updatedAt: new Date() })
        .where(eq(battleSessions.id, sessionId));
    });
  }

  async markFinished(id: string, patch: { status: 'finished' | 'settling'; winner: string; finalStateHash: string; turnLogHash: string; stateJson: string; turn: number }): Promise<void> {
    await this.dbx.update(battleSessions).set({ ...patch, deadline: null, updatedAt: new Date() }).where(eq(battleSessions.id, id));
  }

  async markStatus(id: string, status: SessionRow['status']): Promise<void> {
    await this.dbx.update(battleSessions).set({ status, updatedAt: new Date() }).where(eq(battleSessions.id, id));
  }

  async deleteSession(id: string): Promise<void> {
    await this.dbx.delete(battleSessions).where(eq(battleSessions.id, id));
  }

  /** Enqueue the on-chain settle for the engine's operator worker. Idempotent per battle. */
  async enqueueSettle(payload: SettleJobPayload): Promise<void> {
    await this.dbx
      .insert(operatorJobs)
      .values({ jobType: 'settle_battle', payload, idempotencyKey: `settle_battle:${payload.battleId}` })
      .onConflictDoNothing();
  }

  async loadActive(): Promise<SessionRow[]> {
    return this.dbx.select().from(battleSessions).where(eq(battleSessions.status, 'active'));
  }

  async get(id: string): Promise<SessionRow | null> {
    const rows = await this.dbx.select().from(battleSessions).where(eq(battleSessions.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async listTurns(id: string): Promise<TurnRow[]> {
    return this.dbx.select().from(battleTurns).where(eq(battleTurns.sessionId, id)).orderBy(asc(battleTurns.turn));
  }

  async activePracticeFor(owner: string): Promise<SessionRow | null> {
    const rows = await this.dbx
      .select()
      .from(battleSessions)
      .where(and(eq(battleSessions.kind, 'practice'), eq(battleSessions.playerA, owner.toLowerCase()), eq(battleSessions.status, 'active')))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Real battles the indexer has mirrored to Active (phase 4, created) that have no session yet. */
  async pendingRealBattles(limit = 10): Promise<PendingRealBattle[]> {
    const rows = await this.dbx
      .select({ battleId: battles.battleId, playerA: battles.playerA, playerB: battles.playerB, teamA: battles.teamA, teamB: battles.teamB })
      .from(battles)
      .where(
        and(
          eq(battles.phase, 4),
          eq(battles.status, 1),
          notExists(this.dbx.select({ id: battleSessions.id }).from(battleSessions).where(eq(battleSessions.id, sql`${battles.battleId}::text`))),
        ),
      )
      .limit(limit);
    return rows;
  }
}
