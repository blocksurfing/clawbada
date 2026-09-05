/**
 * Battle-session wire protocol — every shape that crosses the WebSocket (and the
 * REST twins). Server → client events ride the existing `BattleMessage` envelope
 * `{ event, battleId, data, timestamp }`; all payloads are bigint-free.
 *
 * Client → server (WS `message`):
 *   { type: 'submit_turn', battleId, turn, command }   turn = the turn being played
 *   { type: 'ping' }
 */
import { v3 } from '@clawbada/game-logic';

export type Side = 'A' | 'B';
export type SessionKind = 'real' | 'practice';
export type SubmittedBy = 'player' | 'bot' | 'timeout' | 'stun' | 'forfeit';
export type EndReason = 'wipeout' | 'turn_cap' | 'forfeit';

export const SESSION_EVENTS = [
  'battle_snapshot',
  'turn_started',
  'turn_committed',
  'turn_resolved',
  'bar_updated',
  'battle_ended',
  'turn_ack',
  'error',
  'pong',
] as const;
export type SessionEventName = (typeof SESSION_EVENTS)[number];

/** One lobster as shipped to clients (Unity InitBattle + HUD). */
export interface RosterEntry {
  id: string;
  side: Side;
  slot: number;
  classId: number;
  tier: number;
  purity: number;
  legend: boolean;
  /** Lowercase wallet, or `bot:<name>`. */
  owner: string;
  /** Dominant-gene class per body part (Unity part swap); absent for preset rosters. */
  partClassIds?: number[];
  /** On-chain token id when the lobster is a real NFT. */
  tokenId?: string;
}

export interface SessionInfo {
  id: string;
  kind: SessionKind;
  tier: v3.ArenaLayout['tier'];
  playerA: string;
  playerB: string;
  bot: string | null;
  status: 'active' | 'finished' | 'settling' | 'settled' | 'abandoned';
  winner: Side | 'draw' | null;
  createdAt: number;
}

export interface CurrentTurn {
  /** The turn being played (= state.turn + 1); 0 when finished. */
  turn: number;
  lobsterId: string | null;
  side: Side | null;
  /** Wallet that must act, 'bot', or null when finished. */
  controller: string | null;
  /** Epoch ms when the shot clock expires; null for bot turns / finished. */
  deadline: number | null;
}

export interface BattleSnapshot {
  session: SessionInfo;
  state: v3.ClientBattleState;
  current: CurrentTurn;
  timeouts: Record<Side, number>;
  roster: RosterEntry[];
}

export interface WireDamageEvent { targetId: string; amount: string; kind: v3.DamageEvent['kind']; isCrit?: boolean; killed: boolean }
export interface WireHealEvent { targetId: string; amount: string }
export interface WireBarEntry { lobsterId: string; tick: string }

export interface WireTurnResult {
  turn: number;
  tick: string;
  lobsterId: string;
  skipped: 'stun' | null;
  path: v3.HexPos[];
  action: v3.ActionType | null;
  targetId: string | null;
  isEnhanced: boolean;
  damage: WireDamageEvent[];
  heals: WireHealEvent[];
  statuses: v3.StatusEvent[];
  chargeAfter: number;
  bar: WireBarEntry[];
  finished: boolean;
  winner: Side | 'draw' | null;
}

export function turnResultToWire(r: v3.TurnResult): WireTurnResult {
  return {
    turn: r.turn,
    tick: r.tick.toString(),
    lobsterId: r.lobsterId,
    skipped: r.skipped,
    path: r.path,
    action: r.action,
    targetId: r.targetId,
    isEnhanced: r.isEnhanced,
    damage: r.damage.map((d) => ({ targetId: d.targetId, amount: d.amount.toString(), kind: d.kind, ...(d.isCrit ? { isCrit: true } : {}), killed: d.killed })),
    heals: r.heals.map((h) => ({ targetId: h.targetId, amount: h.amount.toString() })),
    statuses: r.statuses,
    chargeAfter: r.chargeAfter,
    bar: r.bar.map((b) => ({ lobsterId: b.lobsterId, tick: b.tick.toString() })),
    finished: r.finished,
    winner: r.winner,
  };
}

// ── server → client payloads ──

export interface TurnStartedPayload { turn: number; lobsterId: string; side: Side; controller: string; deadline: number | null; bar: WireBarEntry[] }
export interface TurnCommittedPayload { turn: number; lobsterId: string; by: SubmittedBy }
export interface TurnResolvedPayload {
  turn: number;
  result: WireTurnResult;
  submittedBy: SubmittedBy;
  postStateHash: string;
  deaths: string[];
  /** Every lobster's HP after this turn — the HUD never derives HP itself. */
  hp: Record<string, { hp: string; maxHp: string; alive: boolean }>;
  nextActorId: string | null;
}
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

// ── client → server ──

export type ClientMessage =
  | { type: 'submit_turn'; battleId: string; turn: number; command: unknown }
  | { type: 'ping' };

const MAX_MESSAGE_BYTES = 4096;

/** Structural parse of an inbound WS frame. Never throws. */
export function parseClientMessage(raw: string | Buffer | ArrayBuffer | Uint8Array): ClientMessage | null {
  let text: string;
  try {
    if (typeof raw === 'string') text = raw;
    else if (raw instanceof ArrayBuffer) text = new TextDecoder().decode(new Uint8Array(raw));
    else text = new TextDecoder().decode(raw as Uint8Array);
  } catch {
    return null;
  }
  if (text.length === 0 || text.length > MAX_MESSAGE_BYTES) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (o.type === 'ping') return { type: 'ping' };
  if (o.type === 'submit_turn') {
    if (typeof o.battleId !== 'string' || o.battleId.length === 0 || o.battleId.length > 64) return null;
    if (typeof o.turn !== 'number' || !Number.isInteger(o.turn) || o.turn < 0) return null;
    if (o.command === undefined) return null;
    return { type: 'submit_turn', battleId: o.battleId, turn: o.turn, command: o.command };
  }
  return null;
}

export const PRACTICE_ID_RE = /^p_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const CHAIN_ID_RE = /^[1-9]\d{0,18}$/;

export function isPracticeId(id: string): boolean {
  return PRACTICE_ID_RE.test(id);
}
