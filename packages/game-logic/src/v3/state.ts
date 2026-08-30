import type { Stats } from '../types';
import { EvolutionTier, LobsterClass } from '../types';
import type { ArenaLayout, HexPos } from './board';

export type Team = 'A' | 'B';

export type StatusType =
  | 'bleed' // damage at start of each of the target's turns (value = per-turn dmg)
  | 'stun' // target skips its next turn
  | 'haunt' // Atk/Armor reduced (value ×1000)
  | 'fortify' // incoming damage reduced (value ×1000)
  | 'reflect' // enhanced Fortify: portion of blocked damage returned (value ×1000)
  | 'shield' // incoming damage reduced (value ×1000)
  | 'slow'; // effective speed reduced (value ×1000)

export interface Status {
  type: StatusType;
  /** Remaining turns of the affected lobster. Decremented at the end of its turn. */
  turns: number;
  value: bigint;
  /** Enhanced Rend: bleed survives Rally's cleanse. */
  uncleansable?: boolean;
  /** Battle turn number when applied; not decremented on the turn it was applied. */
  since: number;
}

export interface AtbLobster {
  id: string;
  team: Team;
  slot: number;
  class: LobsterClass;
  tier: EvolutionTier;
  purity: number;
  legend: boolean;
  /** Tier/legend/HP×5 scaled stats — the battle's base numbers. */
  stats: Stats;
  maxHp: bigint;
  hp: bigint;
  alive: boolean;
  pos: HexPos;
  charge: number;
  /** True from a Defend until the start of this lobster's next turn. */
  defending: boolean;
  statuses: Status[];
  /** Tick of this lobster's last turn (0 before its first). */
  lastTick: bigint;
  turnsTaken: number;
  /** Turns of this lobster still stun-immune. */
  stunImmunity: number;
  /** VRF-derived, fixed for the battle; breaks equal-tick ties. */
  tiebreak: bigint;
}

export interface AtbBattleState {
  battleId: string;
  vrfSeed: bigint;
  layout: ArenaLayout;
  lobsters: AtbLobster[];
  /** Total scheduled turns so far (including stunned skips). */
  turn: number;
  /** Tick of the most recent turn. */
  tick: bigint;
  finished: boolean;
  winner: Team | 'draw' | null;
  log: TurnLogEntry[];
}

/** 'none' = move-only (or pass) turn. */
export type ActionType = 'attack' | 'defend' | 'special' | 'none';

/** What a player submits on a lobster's turn. */
export interface TurnCommand {
  lobsterId: string;
  moveTo?: HexPos;
  action: ActionType;
  /** Required for attack and single-target specials; ignored otherwise. */
  targetId?: string;
}

export interface DamageEvent {
  targetId: string;
  amount: bigint;
  kind: 'attack' | 'special' | 'counter' | 'bleed' | 'reflect' | 'self';
  isCrit?: boolean;
  killed: boolean;
}

export interface StatusEvent {
  targetId: string;
  status: StatusType;
  applied: boolean; // false = removed/cleansed
  turns?: number;
}

export interface HealEvent {
  targetId: string;
  amount: bigint;
}

export interface TurnResult {
  turn: number;
  tick: bigint;
  lobsterId: string;
  skipped: 'stun' | null;
  path: HexPos[];
  action: ActionType | null;
  targetId: string | null;
  isEnhanced: boolean;
  damage: DamageEvent[];
  heals: HealEvent[];
  statuses: StatusEvent[];
  chargeAfter: number;
  /** Upcoming turns after this one (HUD bar). */
  bar: BarEntry[];
  finished: boolean;
  winner: Team | 'draw' | null;
}

export interface BarEntry {
  lobsterId: string;
  tick: bigint;
}

export interface TurnLogEntry {
  turn: number;
  tick: string;
  lobsterId: string;
  moveTo?: HexPos;
  action: ActionType | 'skip';
  targetId?: string;
  postStateHash: string;
}

/** Minimal input to build a battle lobster (a subset of the on-chain Lobster). */
export interface LobsterInput {
  id: string;
  class: LobsterClass;
  tier: EvolutionTier;
  purity: number;
  legend?: boolean;
}
