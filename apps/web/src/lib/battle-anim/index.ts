// ── Types ──
export type {
  RGB,
  EasingName,
  EasingFn,
  Keyframe,
  AnimationDef,
  AnimProperties,
  AnimationName,
  IntensityKeyframe,
  PaletteFxEntry,
  PaletteFxShift,
  PaletteFxData,
  Position,
  TeamPositions,
  CustomPositions,
  Particle,
  VFXColors,
  VFXEffect,
  VFXProvider,
  SpriteMeta,
  HitState,
  BattleAnimState,
  ChoreographyPhase,
  ChoreographyAction,
  PlaybackState,
  ChoreographyCallbacks,
  ArenaGradientStop,
  BattleLobsterConfig,
  BattleViewState,
} from './types';

// ── Pure Data ──
export { EASING } from './easing';
export { mulberry32 } from './prng';
export { ANIMATIONS, ANIM_PROPERTIES } from './animations';
export { CANVAS_W, CANVAS_H, SPRITE_SIZE, TEAM_POS, getTeamPos, loadCustomPositions } from './positions';
export { ARENA_BG_GRADIENTS } from './arena';
export { PALETTE_FX, evaluatePaletteFx } from './palette-fx';

// ── Logic ──
export { lerp, lerpRGB, getOffset, getIntensity } from './interpolation';
export { spawnParticle, tickParticles, countParticles, MAX_PARTICLES } from './particles';
export { getVFXColors } from './vfx-colors';
export { createHitState, triggerFlinch, applyDeathEffect, tickHitReactions } from './hit-reactions';

// ── VFX Provider ──
export {
  registerProceduralProvider,
  registerSpriteProvider,
  getProvider,
  autoLoadSpriteSheets,
  NOOP_PROVIDER,
} from './vfx-provider';

// ── VFX Registry ──
export { spawnVFX, tickVFX, renderVFXLayer, getVFXDuration } from './vfx-registry';

// ── Choreography ──
export { initPlaybackState, initBattleAnims, loadRound, tickChoreography } from './choreography';

// ── Renderer ──
export { drawArenaBg, renderLobster, renderBattleFrame } from './renderer';
