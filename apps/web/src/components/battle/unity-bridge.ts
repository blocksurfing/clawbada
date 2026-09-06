/**
 * Unity ↔ React contract for the live battle (V3, per turn).
 *
 *   Server (WebSocket) → React (authoritative state) → Unity (render one turn)
 *   Unity (hex / lobster click) → React (decides what the click means, submits the turn)
 *
 * React → Unity: unityContext.sendMessage('BattleBridge', method, JSON)
 * Unity → React: JSBridge.jslib → window.__clawbada.*
 *
 * C# twin: packages/battle-engine/ClawbadaBattle/Assets/Scripts/Bridge/BattleBridge.cs
 */
import { CLASS_NAMES_LIST } from '@clawbada/game-logic';
import type { BattleSnapshot, RosterEntry, Side, TurnResolvedPayload, WireBarEntry } from '@/lib/battle-protocol';

export const UNITY_GAME_OBJECT = 'BattleBridge';

export interface HexPosition { col: number; row: number }

export interface ArenaLayout {
  layoutId: string;
  cols: number;
  rows: number;
  blockedHexes: HexPosition[];
  teamASpawns: HexPosition[];
  teamBSpawns: HexPosition[];
  tier: 'evolved' | 'elite' | 'apex';
}

/** Atomic highlight state. Precedence in Unity: origin > enemy > ally > range. */
export interface HexListData {
  originCol: number;
  originRow: number;
  rangeHexes: HexPosition[];
  enemyTargets: HexPosition[];
  allyTargets: HexPosition[];
}

export interface BattleLobster {
  id: string;
  classId: number;
  className: string;
  tier: number;
  side: Side;
  slot: number;
  maxHp: number;
  currentHp: number;
  position: HexPosition;
  charge: number;
  damage: number;
  moveRange: number;
  alive: boolean;
  partClassIds?: number[];
}

export interface BattleInitData {
  battleId: string;
  arena: ArenaLayout;
  teamA: BattleLobster[];
  teamB: BattleLobster[];
  playerSide: Side | 'spectator';
  playerBadge: string;
  opponentBadge: string;
  stakeBracket: string;
  stakeAmount: number;
}

export interface TurnStartData { turn: number; lobsterId: string; side: Side; deadlineMs: number; isPlayer: boolean }
export interface DamageEventData { targetId: string; amount: number; kind: string; isCrit: boolean; killed: boolean }
export interface HealEventData { targetId: string; amount: number }
export interface StatusEventData { targetId: string; status: string; applied: boolean; turns: number }
export interface TurnPlayData {
  turn: number;
  lobsterId: string;
  path: HexPosition[];
  action: string;
  skipped: string;
  targetId: string;
  damage: DamageEventData[];
  heals: HealEventData[];
  statuses: StatusEventData[];
  deaths: string[];
  isEnhanced: boolean;
}
export interface BarData { turn: number; entries: { lobsterId: string; tick: string }[] }
export interface ClockData { remainingMs: number }
export interface BattleEndData { winner: Side | 'draw'; playerWon: boolean; reason: string }
/** Server truth for one unit after a turn (feeds the in-canvas HUD). */
export interface StatusData { type: string; turns: number }
export interface UnitSyncData {
  lobsterId: string;
  hp: number;
  maxHp: number;
  alive: boolean;
  charge: number;
  defending: boolean;
  col: number;
  row: number;
  statuses: StatusData[];
}
export interface UnitsSyncData { turn: number; units: UnitSyncData[] }

export const UNITY_METHODS = {
  INIT_BATTLE: 'InitBattle',
  START_TURN: 'StartTurn',
  PLAY_TURN: 'PlayTurn',
  UPDATE_BAR: 'UpdateBar',
  SET_CLOCK: 'SetClock',
  BATTLE_END: 'BattleEnd',
  SHOW_SELECTION: 'ShowSelection',
  CLEAR_HIGHLIGHTS: 'ClearHighlights',
  SYNC_UNITS: 'SyncUnits',
} as const;

export const JS_CALLBACKS = {
  ON_UNITY_READY: 'onUnityReady',
  ON_LOBSTER_SELECTED: 'onLobsterSelected',
  ON_HEX_CLICKED: 'onHexClicked',
  ON_TURN_ANIMATION_COMPLETE: 'onTurnAnimationComplete',
  ON_ACTION_SELECTED: 'onActionSelected',
  ON_UNDO_MOVE: 'onUndoMove',
} as const;

export interface UnityCallbackHandler {
  onUnityReady: () => void;
  onLobsterSelected: (lobsterId: string) => void;
  onHexClicked: (hex: HexPosition) => void;
  onTurnAnimationComplete: (turn: number) => void;
  /** In-canvas action bar (attack | special | defend | none). Optional until the bar ships. */
  onActionSelected?: (action: string) => void;
  onUndoMove?: () => void;
}

/** Register the callbacks Unity's jslib calls. Returns a cleanup. */
export function registerUnityCallbacks(handlers: UnityCallbackHandler): () => void {
  const bridge: Record<string, (json?: string) => void> = {
    [JS_CALLBACKS.ON_UNITY_READY]: () => handlers.onUnityReady(),
    [JS_CALLBACKS.ON_LOBSTER_SELECTED]: (json) => handlers.onLobsterSelected(JSON.parse(json ?? '{}').lobsterId),
    [JS_CALLBACKS.ON_HEX_CLICKED]: (json) => {
      const { col, row } = JSON.parse(json ?? '{}');
      handlers.onHexClicked({ col, row });
    },
    [JS_CALLBACKS.ON_TURN_ANIMATION_COMPLETE]: (json) => handlers.onTurnAnimationComplete(JSON.parse(json ?? '{}').turn),
    [JS_CALLBACKS.ON_ACTION_SELECTED]: (json) => handlers.onActionSelected?.(JSON.parse(json ?? '{}').action),
    [JS_CALLBACKS.ON_UNDO_MOVE]: () => handlers.onUndoMove?.(),
  };
  (window as unknown as { __clawbada?: unknown }).__clawbada = bridge;
  return () => {
    delete (window as unknown as { __clawbada?: unknown }).__clawbada;
  };
}

// ─── Adapters: protocol → Unity payloads ───

const MOVE_RANGE: Record<number, number> = { 0: 1, 1: 3, 2: 1, 3: 3, 4: 3, 5: 2, 6: 2, 7: 2, 8: 2, 9: 3 };

export function rosterToLobsters(snapshot: BattleSnapshot, side: Side): BattleLobster[] {
  return snapshot.roster
    .filter((r) => r.side === side)
    .sort((a, b) => a.slot - b.slot)
    .map((r) => {
      const l = snapshot.state.lobsters.find((x) => x.id === r.id);
      return {
        id: r.id,
        classId: r.classId,
        className: CLASS_NAMES_LIST[r.classId] ?? `Class${r.classId}`,
        tier: Math.max(1, r.tier),
        side,
        slot: r.slot,
        maxHp: Number(l?.maxHp ?? 0),
        currentHp: Number(l?.hp ?? 0),
        position: l ? { col: l.pos.col, row: l.pos.row } : { col: 0, row: 0 },
        charge: l?.charge ?? 0,
        damage: 0,
        moveRange: MOVE_RANGE[r.classId] ?? 2,
        alive: l?.alive ?? true,
        ...(r.partClassIds ? { partClassIds: r.partClassIds } : {}),
      };
    });
}

export function buildInitData(snapshot: BattleSnapshot, playerSide: Side | 'spectator'): BattleInitData {
  const { session } = snapshot;
  const isBot = (owner: string) => owner.startsWith('bot:');
  const badge = (side: Side) => (isBot(side === 'A' ? session.playerA : session.playerB) ? 'bot' : 'player');
  return {
    battleId: session.id,
    arena: snapshot.state.layout as ArenaLayout,
    teamA: rosterToLobsters(snapshot, 'A'),
    teamB: rosterToLobsters(snapshot, 'B'),
    playerSide,
    playerBadge: playerSide === 'spectator' ? 'spectator' : badge(playerSide),
    opponentBadge: playerSide === 'A' ? badge('B') : playerSide === 'B' ? badge('A') : badge('B'),
    stakeBracket: session.kind,
    stakeAmount: 0,
  };
}

export function turnToPlayData(t: TurnResolvedPayload): TurnPlayData {
  const r = t.result;
  return {
    turn: t.turn,
    lobsterId: r.lobsterId,
    path: r.path,
    action: r.action ?? '',
    skipped: r.skipped ?? '',
    targetId: r.targetId ?? '',
    damage: r.damage.map((d) => ({ targetId: d.targetId, amount: Number(d.amount), kind: d.kind, isCrit: !!d.isCrit, killed: d.killed })),
    heals: r.heals.map((h) => ({ targetId: h.targetId, amount: Number(h.amount) })),
    statuses: r.statuses.map((s) => ({ targetId: s.targetId, status: s.status, applied: s.applied, turns: s.turns ?? 0 })),
    deaths: t.deaths,
    isEnhanced: r.isEnhanced,
  };
}

export function barToData(turn: number, bar: WireBarEntry[]): BarData {
  return { turn, entries: bar.map((b) => ({ lobsterId: b.lobsterId, tick: b.tick })) };
}

/** Authoritative per-unit state for Unity's HUD (sent after InitBattle and after each animated turn). */
export function unitsToSync(snapshot: BattleSnapshot): UnitsSyncData {
  return {
    turn: snapshot.state.turn,
    units: snapshot.state.lobsters.map((l) => ({
      lobsterId: l.id,
      hp: Number(l.hp),
      maxHp: Number(l.maxHp),
      alive: l.alive,
      charge: l.charge,
      defending: !!l.defending,
      col: l.pos.col,
      row: l.pos.row,
      statuses: (l.statuses ?? []).map((s) => ({ type: s.type, turns: s.turns ?? 0 })),
    })),
  };
}

export function rosterEntry(snapshot: BattleSnapshot, id: string): RosterEntry | undefined {
  return snapshot.roster.find((r) => r.id === id);
}
