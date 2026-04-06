import type { LobsterClass, MoveType, EvolutionTier } from '@clawbada/game-logic';

// Re-export for convenience
export type { LobsterClass, MoveType, EvolutionTier };

// ── Color ──

export type RGB = [number, number, number];

// ── Easing ──

export type EasingName =
  | 'linear'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeOutBack'
  | 'easeOutElastic'
  | 'bounce';

export type EasingFn = (t: number) => number;

// ── Animation Keyframes ──

export interface Keyframe {
  frame: number;
  dx: number;
  dy: number;
  ease?: EasingName;
}

export interface AnimationDef {
  name: string;
  totalFrames: number;
  fps: number;
  description: string;
  keyframes: Record<number, Keyframe[]>;
}

export interface AnimProperties {
  loop: boolean;
  returnTo?: string;
}

export type AnimationName = 'idle' | 'advance' | 'retreat' | 'attack' | 'defend' | 'special';

// ── Palette FX ──

export interface IntensityKeyframe {
  frame: number;
  v: number;
  ease?: EasingName;
}

export interface PaletteFxEntry {
  role: number;
  target: number;
  kf: IntensityKeyframe[];
}

/** Per-animation FX: `all` applies to every body part, numeric keys apply to specific parts */
export type PaletteFxAnim = {
  all?: PaletteFxEntry[];
} & {
  [bodyPartIdx: number]: PaletteFxEntry[] | undefined;
};

/** Per-class palette FX definitions, keyed by animation name */
export type PaletteFxClass = Partial<Record<AnimationName, PaletteFxAnim | null>>;

/** Full palette FX data: classIdx (1-10) → animation FX */
export type PaletteFxData = Record<number, PaletteFxClass>;

export interface PaletteFxShift {
  role: number;
  target: number;
  intensity: number;
}

// ── Positions ──

export interface Position {
  x: number;
  y: number;
}

export interface TeamPositions {
  a: Position[];
  b: Position[];
}

/** Custom positions keyed by `"${tier}:${scene}"` */
export type CustomPositions = Record<string, TeamPositions>;

// ── Particles ──

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: RGB;
  size: number;
  life: number;
  maxLife: number;
  alpha: number;
  shape: 'square' | 'circle';
  gravity: number;
  drag: number;
}

// ── VFX ──

export interface VFXColors {
  primary: RGB;
  primaryHi: RGB;
  primaryDk: RGB;
  secondary: RGB;
  secondaryHi: RGB;
  accent: RGB;
  accentHi: RGB;
  outline: RGB;
}

export interface VFXEffect {
  type: string;
  classId: number;
  tier: number;
  enhanced: boolean;
  colors: VFXColors;
  origin: Position;
  target: Position | null;
  targets: Position[];
  progress: number;
  startTime: number;
  duration: number;
  particles: Particle[];
  shapes: unknown[];
  phase: number;
  _data: Record<string, unknown>;
  _canSpawn: boolean;
}

export interface VFXProvider {
  tick: (fx: VFXEffect, dt: number) => void;
  render: (
    fx: VFXEffect,
    ctx: CanvasRenderingContext2D,
    cs: number,
    layer: 'under' | 'over',
  ) => void;
}

export interface SpriteMeta {
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
  fps: number;
  layer: 'under' | 'over';
}

// ── Hit Reactions ──

export interface HitState {
  flash: number; // ms remaining for white flash
  knockX: number; // px knockback X
  knockY: number; // px knockback Y
  tilt: number; // degrees rotation
  timer: number; // total reaction timer
  grayscale: boolean; // death effect
}

// ── Battle Animation State ──

export interface BattleAnimState {
  id: string; // e.g. "a0", "b2"
  classId: number;
  tier: number;
  side: 'a' | 'b';
  slot: number;
  anim: AnimationName;
  frame: number;
  posX: number; // current canvas X offset from home
  posY: number; // current canvas Y offset from home
  homeX: number; // home position X
  homeY: number; // home position Y
  hp: number;
  maxHp: number;
  charge: number;
  alive: boolean;
  highlight: boolean;
  hit: HitState;
}

// ── Choreography ──

export type ChoreographyPhase =
  | 'idle'
  | 'intro_ready'
  | 'intro_go'
  | 'highlight'
  | 'special_overlay'
  | 'advance'
  | 'strike'
  | 'impact'
  | 'retreat'
  | 'pause'
  | 'victory';

export interface ChoreographyAction {
  actorId: string;
  actorClass: number;
  moveType: 'attack' | 'defend' | 'special' | 'stunned';
  targetId: string;
  damage: number;
  crit: boolean;
  enhanced: boolean;
  aoeDamage?: { targetId: string; damage: number }[];
  selfDamage?: { targetId: string; damage: number };
  healed?: number;
  healTargetId?: string;
}

export interface PlaybackState {
  phase: ChoreographyPhase;
  timer: number;
  queue: ChoreographyAction[];
  queueIdx: number;
  autoPlay: boolean;
  autoTimer: number;
  _phaseDur: number;
  currentRound: number;
  totalRounds: number;
}

export interface ChoreographyCallbacks {
  onBanner(text: string, type: 'ready' | 'go' | 'victory'): void;
  onHideBanner(): void;
  onSpecialOverlay(classId: number): void;
  onHideSpecialOverlay(): void;
  onDamageFloat(
    lobsterId: string,
    amount: number,
    isCrit: boolean,
    isHeal: boolean,
  ): void;
  onStatusText(lobsterId: string, text: string, color: string): void;
  onScreenShake(amount: number): void;
  onRoundComplete(roundNumber: number, totalRounds: number): void;
  onBattleComplete(winner: string): void;
}

// ── Arena ──

export interface ArenaGradientStop {
  stop: number;
  color: string;
}

// ── Battle Viewer Config ──

export interface BattleLobsterConfig {
  id: string; // "a0", "a1", "a2", "b0", "b1", "b2"
  dna: string;
  classId: number;
  tier: number;
  side: 'a' | 'b';
  slot: number;
  maxHp: number;
}

export interface BattleViewState {
  anims: Record<string, BattleAnimState>;
  playback: PlaybackState;
  effects: VFXEffect[];
  shakeAmount: number;
  lobsterOrder: string[]; // y-sorted render order
}
