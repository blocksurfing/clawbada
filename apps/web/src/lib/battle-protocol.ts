/**
 * Wire shapes of the V3 live battle protocol, mirrored from
 * apps/api/src/lib/battle-session/protocol.ts (the API is the source of truth).
 * Everything here is bigint-free JSON.
 */
import type { v3 } from '@clawbada/game-logic';

export type Side = 'A' | 'B';
export type SessionKind = 'real' | 'practice';
export type SubmittedBy = 'player' | 'bot' | 'timeout' | 'stun' | 'forfeit';
export type EndReason = 'wipeout' | 'turn_cap' | 'forfeit';

export interface RosterEntry {
  id: string;
  side: Side;
  slot: number;
  classId: number;
  tier: number;
  purity: number;
  legend: boolean;
  owner: string;
  partClassIds?: number[];
  tokenId?: string;
}

export interface SessionInfo {
  id: string;
  kind: SessionKind;
  tier: 'evolved' | 'elite' | 'apex';
  playerA: string;
  playerB: string;
  bot: string | null;
  status: 'active' | 'finished' | 'settling' | 'settled' | 'abandoned';
  winner: Side | 'draw' | null;
  createdAt: number;
}

export interface CurrentTurn {
  turn: number;
  lobsterId: string | null;
  side: Side | null;
  controller: string | null;
  deadline: number | null;
}

export interface BattleSnapshot {
  session: SessionInfo;
  state: v3.ClientBattleState;
  current: CurrentTurn;
  timeouts: Record<Side, number>;
  roster: RosterEntry[];
}

export interface WireDamageEvent { targetId: string; amount: string; kind: 'attack' | 'special' | 'counter' | 'bleed' | 'reflect' | 'self'; isCrit?: boolean; killed: boolean }
export interface WireHealEvent { targetId: string; amount: string }
export interface WireBarEntry { lobsterId: string; tick: string }
export interface WireStatusEvent { targetId: string; status: string; applied: boolean; turns?: number }

export interface WireTurnResult {
  turn: number;
  tick: string;
  lobsterId: string;
  skipped: 'stun' | null;
  path: { col: number; row: number }[];
  action: 'attack' | 'defend' | 'special' | 'none' | null;
  targetId: string | null;
  isEnhanced: boolean;
  damage: WireDamageEvent[];
  heals: WireHealEvent[];
  statuses: WireStatusEvent[];
  chargeAfter: number;
  bar: WireBarEntry[];
  finished: boolean;
  winner: Side | 'draw' | null;
}

export interface TurnStartedPayload { turn: number; lobsterId: string; side: Side; controller: string; deadline: number | null; bar: WireBarEntry[] }
export interface TurnCommittedPayload { turn: number; lobsterId: string; by: SubmittedBy }
export interface TurnResolvedPayload {
  turn: number;
  result: WireTurnResult;
  submittedBy: SubmittedBy;
  postStateHash: string;
  deaths: string[];
  hp: Record<string, { hp: string; maxHp: string; alive: boolean }>;
  nextActorId: string | null;
  /** Full client-safe state after this turn; replaces the local state once animated. */
  state?: v3.ClientBattleState;
}
export interface BarUpdatedPayload { turn: number; bar: WireBarEntry[] }
export interface BattleEndedPayload {
  winner: Side | 'draw';
  reason: EndReason;
  finalStateHash: string;
  turnLogHash: string;
  damage?: { damageA: [number, number, number]; damageB: [number, number, number] };
  settle: 'queued' | 'n/a';
}
export interface SessionErrorPayload { code: string; message: string; turn?: number }
export interface TurnAckPayload { turn: number; duplicate: boolean }

export interface TurnCommand {
  lobsterId: string;
  moveTo?: { col: number; row: number };
  action: 'attack' | 'defend' | 'special' | 'none';
  targetId?: string;
}

/** Server → client envelope (apps/api/src/lib/ws.ts). */
export interface WsEnvelope<T = unknown> {
  event: string;
  battleId: string;
  data: T;
  timestamp: number;
}

export const PRACTICE_ID_RE = /^p_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isPracticeId = (id: string): boolean => PRACTICE_ID_RE.test(id);
