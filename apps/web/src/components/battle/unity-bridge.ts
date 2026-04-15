/**
 * Unity ↔ React communication bridge for the Clawbada Battle Engine.
 *
 * Data flow:
 *   Server (WebSocket) → React (game state) → Unity (render)
 *   User input: Unity (hex clicks, action selection) → React (commit to server)
 *
 * Unity calls these JS functions via jslib SendMessage → window.__clawbada.*
 * React calls Unity via unityContext.sendMessage(gameObject, method, data)
 */

// ─── Types: React → Unity (game state pushed to Unity for rendering) ───

export interface HexPosition {
  col: number;
  row: number;
}

export interface ArenaLayout {
  layoutId: string;
  cols: number;
  rows: number;
  blockedHexes: HexPosition[];
  teamASpawns: HexPosition[];
  teamBSpawns: HexPosition[];
  tier: 'evolved' | 'elite' | 'apex';
}

/**
 * Payload for Unity's `ShowSelection` method. Describes the full hex highlight
 * state for the currently selected character as a single atomic update.
 *
 * Dedupe precedence is enemy > ally > range — a hex that appears in both
 * `rangeHexes` and `enemyTargets` renders red only. Origin hex always wins.
 *
 * Populate per phase:
 *   - Phase 1 positioning:  rangeHexes populated; enemy/ally empty
 *   - Phase 2 attack/defend: rangeHexes + enemyTargets populated
 *   - Phase 2 heal/buff:     rangeHexes + allyTargets populated
 */
export interface HexListData {
  /** Selected character's own hex (renders blue). Use -1 / -1 to skip. */
  originCol: number;
  originRow: number;
  /** In-range hexes (stone). Movement range in phase 1, attack max range in phase 2. */
  rangeHexes: HexPosition[];
  /** Enemy-occupied hexes within attack / defend / special range (red). */
  enemyTargets: HexPosition[];
  /** Friendly hexes targetable by heal / buff specials like Sentinel Rally (green). */
  allyTargets: HexPosition[];
}

export interface BattleLobster {
  id: string;
  classId: number;       // 0-9 (Bulwark=0, Mantis=1, ... Ember=9)
  className: string;
  tier: number;          // 1=Evolved, 2=Elite, 3=Apex
  side: 'a' | 'b';
  slot: number;          // 0-2
  maxHp: number;
  currentHp: number;
  position: HexPosition;
  charge: number;        // 0-3
  damage: number;        // accumulated battle damage
  moveRange: number;     // 1, 2, or 3
  alive: boolean;
  effects: StatusEffect[];
}

export interface StatusEffect {
  type: 'bleed' | 'haunt' | 'stun' | 'fortify' | 'shield';
  remainingRounds: number;
}

export interface BattleInitData {
  battleId: string;
  arena: ArenaLayout;
  teamA: BattleLobster[];
  teamB: BattleLobster[];
  playerSide: 'a' | 'b';
  playerBadge: 'human' | 'agent';
  opponentBadge: 'human' | 'agent';
  stakeBracket: 'low' | 'mid' | 'high';
  stakeAmount: number;
}

export interface PhaseData {
  round: number;
  phase: 'positioning' | 'combat';
  timeRemaining: number;    // seconds
  opponentReady: boolean;   // true if opponent already committed
}

export interface RoundResult {
  round: number;
  movements: MovementResult[];
  actions: ActionResult[];
  deaths: string[];          // lobster IDs that died this round
}

export interface MovementResult {
  lobsterId: string;
  from: HexPosition;
  to: HexPosition;
}

export interface ActionResult {
  actorId: string;
  actionType: 'attack' | 'defend' | 'special';
  targetId?: string;
  damage: number;
  healed: number;
  crit: boolean;
  distance: number;
  distanceModifier: number;
  moveType?: string;       // special name for specials
  enhanced?: boolean;
}

// ─── Types: Unity → React (player input from Unity hex grid) ───

export interface PositioningCommit {
  moves: Array<{
    lobsterId: string;
    destinationHex: HexPosition;
  }>;
}

export interface CombatCommit {
  actions: Array<{
    lobsterId: string;
    actionType: 'attack' | 'defend' | 'special';
    targetId?: string;
  }>;
}

// ─── Unity Bridge Method Names ───

/** Methods called on the Unity "BattleBridge" GameObject */
export const UNITY_METHODS = {
  // Initialization
  INIT_BATTLE: 'InitBattle',           // JSON: BattleInitData
  // Phase management
  START_PHASE: 'StartPhase',           // JSON: PhaseData
  UPDATE_TIMER: 'UpdateTimer',         // JSON: { timeRemaining: number }
  OPPONENT_READY: 'OpponentReady',     // no data
  // Round results (for animation playback)
  PLAY_ROUND: 'PlayRound',            // JSON: RoundResult
  // Battle end
  BATTLE_END: 'BattleEnd',            // JSON: { winner: 'a'|'b', playerWon: boolean }
  // Selection highlight state (atomic — all four highlight layers in one call)
  SHOW_SELECTION: 'ShowSelection',     // JSON: HexListData
  CLEAR_HIGHLIGHTS: 'ClearHighlights', // no data
} as const;

/** JS callback function names registered on window.__clawbada by React */
export const JS_CALLBACKS = {
  // Player committed positioning
  ON_POSITIONING_COMMIT: 'onPositioningCommit',  // JSON: PositioningCommit
  // Player committed combat actions
  ON_COMBAT_COMMIT: 'onCombatCommit',            // JSON: CombatCommit
  // Player clicked a lobster (for info/selection)
  ON_LOBSTER_SELECTED: 'onLobsterSelected',      // JSON: { lobsterId: string }
  // Unity scene is loaded and ready
  ON_UNITY_READY: 'onUnityReady',                // no data
  // Round animation completed
  ON_ANIMATION_COMPLETE: 'onAnimationComplete',  // JSON: { round: number }
} as const;

// ─── Bridge Helper ───

export type UnityCallbackHandler = {
  onPositioningCommit: (commit: PositioningCommit) => void;
  onCombatCommit: (commit: CombatCommit) => void;
  onLobsterSelected: (lobsterId: string) => void;
  onUnityReady: () => void;
  onAnimationComplete: (round: number) => void;
};

/**
 * Register JS callbacks on window.__clawbada so Unity's jslib can call them.
 * Returns a cleanup function to remove the callbacks.
 */
export function registerUnityCallbacks(handlers: UnityCallbackHandler): () => void {
  const bridge = {
    [JS_CALLBACKS.ON_POSITIONING_COMMIT]: (json: string) => {
      handlers.onPositioningCommit(JSON.parse(json));
    },
    [JS_CALLBACKS.ON_COMBAT_COMMIT]: (json: string) => {
      handlers.onCombatCommit(JSON.parse(json));
    },
    [JS_CALLBACKS.ON_LOBSTER_SELECTED]: (json: string) => {
      const { lobsterId } = JSON.parse(json);
      handlers.onLobsterSelected(lobsterId);
    },
    [JS_CALLBACKS.ON_UNITY_READY]: () => {
      handlers.onUnityReady();
    },
    [JS_CALLBACKS.ON_ANIMATION_COMPLETE]: (json: string) => {
      const { round } = JSON.parse(json);
      handlers.onAnimationComplete(round);
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__clawbada = bridge;

  return () => {
    delete // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__clawbada;
  };
}
