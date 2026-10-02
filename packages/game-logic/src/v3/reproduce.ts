/**
 * Reproduce a finished battle from what the server stored about it, and derive everything
 * `BattleArena.settle` carries: winner, forfeiter, repair damage and both commitments.
 *
 * Shared by the API (which builds the settle payload when a battle ends), the engine's settle
 * reconciler (which rebuilds a lost payload) and the engine's WATCHDOG (which replays every
 * settled battle during its review window and freezes any result it cannot reproduce). Pure:
 * no database, no chain.
 */
import { repairDamage } from './battle-damage';
import { hashState } from './log';
import { turnLogHash, verifyLog } from './replay';
import { deserializeState } from './serialize';
import type { BattleConfig } from './sim';
import type { AtbBattleState, LobsterInput, Team } from './state';
import type { ArenaLayout } from './board';
import type { EvolutionTier, LobsterClass } from '../types';

/**
 * The side whose player forfeited (resigned, or timed out TIMEOUTS_TO_FORFEIT turns in a row),
 * read from the hashed log: a forfeit is always its last entry. Null when the battle was played
 * out — and always null for a draw (a forfeit hands the other side the win).
 */
export function forfeitedSide(state: AtbBattleState): Team | null {
  const last = state.log[state.log.length - 1];
  if (last?.action !== 'forfeit' || !last.loser) return null;
  return last.loser;
}

/** A roster entry as the session row stores it (`battle_sessions.roster`). */
export interface StoredRosterEntry {
  id: string;
  side: string;
  slot: number;
  classId: number;
  tier: number;
  purity: number;
  legend?: boolean;
}

export interface StoredSession {
  /** The on-chain battle id (decimal string). */
  battleId: string;
  tier: string;
  roster: StoredRosterEntry[];
  /** `v3.serializeState` of the FINAL state. */
  stateJson: string;
}

export type Reproduction =
  | {
      ok: true;
      winner: Team | 'draw';
      forfeiter: Team | null;
      finalStateHash: string;
      turnLogHash: string;
      damageA: [number, number, number];
      damageB: [number, number, number];
    }
  | { ok: false; reason: string };

/** Roster entries of one side, in slot order, as engine inputs. */
export function rosterSide(roster: StoredRosterEntry[], side: Team): LobsterInput[] {
  return roster
    .filter((r) => r.side === side)
    .sort((a, b) => a.slot - b.slot)
    .map((r) => ({ id: r.id, class: r.classId as LobsterClass, tier: r.tier as EvolutionTier, purity: r.purity, legend: !!r.legend }));
}

/**
 * Re-execute the stored battle from scratch (fresh state from roster + seed + layout + rules
 * version, then every logged turn with its post-state hash checked) and derive the settlement.
 * Any inconsistency — unreadable state, unfinished battle, wrong battle id, a turn that does not
 * replay to its recorded hash, a forfeit the log does not justify — is `ok: false`.
 */
export function reproduceSession(stored: StoredSession): Reproduction {
  let recorded: AtbBattleState;
  try {
    recorded = deserializeState(stored.stateJson);
  } catch (err) {
    return { ok: false, reason: `state unreadable: ${(err as Error).message}` };
  }
  if (!recorded.finished) return { ok: false, reason: 'the stored battle is not finished' };
  if (recorded.battleId !== stored.battleId) return { ok: false, reason: `state is for battle ${recorded.battleId}, not ${stored.battleId}` };
  const teamA = rosterSide(stored.roster, 'A');
  const teamB = rosterSide(stored.roster, 'B');
  if (teamA.length !== 3 || teamB.length !== 3) return { ok: false, reason: 'roster does not have three lobsters a side' };

  const cfg: BattleConfig = {
    battleId: stored.battleId,
    vrfSeed: recorded.vrfSeed,
    tier: stored.tier as ArenaLayout['tier'],
    layout: recorded.layout,
    teamA,
    teamB,
    rulesVersion: recorded.rulesVersion,
  };
  const verdict = verifyLog(cfg, recorded.log);
  if (!verdict.ok) return { ok: false, reason: `log does not replay at entry ${verdict.failedAt}: expected ${verdict.expected}, got ${verdict.got}` };
  const state = verdict.state;
  if (!state.finished || !state.winner) return { ok: false, reason: 'the replayed battle does not finish' };
  if (state.log.length !== recorded.log.length) return { ok: false, reason: 'replay length differs from the stored log' };

  const damage = repairDamage(state);
  return {
    ok: true,
    winner: state.winner,
    forfeiter: state.winner === 'draw' ? null : forfeitedSide(state),
    finalStateHash: hashState(state),
    turnLogHash: turnLogHash(state, [...teamA, ...teamB]),
    damageA: damage.damageA,
    damageB: damage.damageB,
  };
}
