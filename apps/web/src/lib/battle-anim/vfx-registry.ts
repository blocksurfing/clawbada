import type { VFXEffect, VFXColors, Position } from './types';
import { tickParticles, countParticles, MAX_PARTICLES } from './particles';
import { getVFXColors } from './vfx-colors';
import { getProvider, registerProceduralProvider, NOOP_PROVIDER } from './vfx-provider';

// Import all effect modules
import * as charge from './vfx-effects/charge';
import * as ambush from './vfx-effects/ambush';
import * as rend from './vfx-effects/rend';
import * as crush from './vfx-effects/crush';
import * as inferno from './vfx-effects/inferno';
import * as rally from './vfx-effects/rally';
import * as haunt from './vfx-effects/haunt';
import * as devour from './vfx-effects/devour';
import * as bind from './vfx-effects/bind';
import * as fortify from './vfx-effects/fortify';
import * as maelstrom from './vfx-effects/maelstrom';

// ── Effect dispatch tables ──

const EFFECT_TICK: Record<string, (fx: VFXEffect, dt: number) => void> = {
  _charge: charge.tick,
  ambush: ambush.tick,
  rend: rend.tick,
  crush: crush.tick,
  inferno: inferno.tick,
  rally: rally.tick,
  haunt: haunt.tick,
  devour: devour.tick,
  bind: bind.tick,
  fortify: fortify.tick,
  maelstrom: maelstrom.tick,
};

const EFFECT_RENDER: Record<
  string,
  (fx: VFXEffect, ctx: CanvasRenderingContext2D, cs: number, layer: 'under' | 'over') => void
> = {
  _charge: charge.render,
  ambush: ambush.render,
  rend: rend.render,
  crush: crush.render,
  inferno: inferno.render,
  rally: rally.render,
  haunt: haunt.render,
  devour: devour.render,
  bind: bind.render,
  fortify: fortify.render,
  maelstrom: maelstrom.render,
};

// ── VFX type to class ID mapping ──

/** Special move names indexed by classId (0-9). */
const SPECIAL_TYPES = [
  'fortify',   // 0: Bulwark
  'ambush',    // 1: Mantis
  'crush',     // 2: Leviathan
  'maelstrom', // 3: Tempest
  'haunt',     // 4: Specter
  'rally',     // 5: Sentinel
  'rend',      // 6: Reaver
  'devour',    // 7: Abyss
  'bind',      // 8: Kraken
  'inferno',   // 9: Ember
];

// ── VFX base durations ──

const VFX_BASE_DURATIONS: Record<string, number> = {
  fortify: 1200,
  ambush: 600,
  crush: 900,
  maelstrom: 1100,
  haunt: 1000,
  rally: 900,
  rend: 700,
  devour: 1000,
  bind: 1000,
  inferno: 800,
};

/** Tier duration multipliers: Evolved=0.8, Elite=0.9, Apex=1.0 */
const TIER_DURATION_MULT = [0.8, 0.9, 1.0];

/** Get the duration for a VFX type at a given tier. */
export function getVFXDuration(type: string, tier: number): number {
  return (VFX_BASE_DURATIONS[type] ?? 800) * (TIER_DURATION_MULT[tier - 1] ?? 1);
}

// ── Register all procedural providers ──

function registerAllProviders(): void {
  const effects: Record<string, { tick: typeof charge.tick; render: typeof charge.render }> = {
    fortify,
    ambush,
    crush,
    maelstrom,
    haunt,
    rally,
    rend,
    devour,
    bind,
    inferno,
  };

  for (let classId = 0; classId < SPECIAL_TYPES.length; classId++) {
    const type = SPECIAL_TYPES[classId];
    const mod = effects[type];
    if (mod) {
      registerProceduralProvider(classId, {
        tick: (fx, dt) => {
          // Also run _charge tick for charge-up sparkles
          EFFECT_TICK._charge(fx, dt);
          mod.tick(fx, dt);
        },
        render: (fx, ctx, cs, layer) => {
          // Render _charge sparkles underneath the effect
          EFFECT_RENDER._charge(fx, ctx, cs, layer);
          mod.render(fx, ctx, cs, layer);
        },
      });
    }
  }
}

// Auto-register on module load
registerAllProviders();

// ── Public API ──

/** Spawn a VFX effect for a class special move. */
export function spawnVFX(
  classId: number,
  tier: number,
  enhanced: boolean,
  origin: Position,
  target: Position | null,
  targets?: Position[],
): VFXEffect | null {
  const type = SPECIAL_TYPES[classId];
  if (!type) return null;

  const colors = getVFXColors(classId);
  const effect: VFXEffect = {
    type,
    classId,
    tier,
    enhanced,
    colors,
    origin: { ...origin },
    target: target ? { ...target } : null,
    targets: (targets ?? []).map((t) => ({ ...t })),
    startTime: performance.now(),
    duration: getVFXDuration(type, tier),
    progress: 0,
    particles: [],
    shapes: [],
    phase: 0,
    _data: {},
    _canSpawn: true,
  };

  return effect;
}

/**
 * Update all active effects: advance progress, tick effect logic + particles,
 * remove completed effects.
 */
export function tickVFX(
  effects: VFXEffect[],
  dt: number,
  battleSpeed: number,
): void {
  const speedDt = dt * battleSpeed;
  // Cap total particles across all effects
  const canSpawn = countParticles(effects) < MAX_PARTICLES;

  for (let i = effects.length - 1; i >= 0; i--) {
    const fx = effects[i];
    fx.progress = Math.min(
      1,
      (performance.now() - fx.startTime) / fx.duration,
    );
    fx._canSpawn = canSpawn;

    // Dispatch to provider (sprite sheet or procedural)
    const provider = getProvider(fx.classId, fx.tier);
    if (provider) {
      provider.tick(fx, speedDt);
    } else {
      // Fallback: try direct dispatch tables
      const tickFn = EFFECT_TICK[fx.type];
      if (tickFn) tickFn(fx, speedDt);
    }

    tickParticles(fx.particles, speedDt);

    if (fx.progress >= 1 && fx.particles.length === 0) {
      effects.splice(i, 1);
    }
  }
}

/** Render all active effects for the given layer ('under' or 'over'). */
export function renderVFXLayer(
  effects: VFXEffect[],
  ctx: CanvasRenderingContext2D,
  cs: number,
  layer: 'under' | 'over',
): void {
  for (const fx of effects) {
    // Dispatch to provider (sprite sheet or procedural)
    const provider = getProvider(fx.classId, fx.tier);
    if (provider) {
      provider.render(fx, ctx, cs, layer);
    } else {
      // Fallback: try direct dispatch tables
      const renderFn = EFFECT_RENDER[fx.type];
      if (renderFn) renderFn(fx, ctx, cs, layer);
    }
  }
}
