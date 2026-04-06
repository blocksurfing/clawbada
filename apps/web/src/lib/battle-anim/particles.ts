import type { Particle, RGB, VFXEffect } from './types';

/** Maximum total particles across all active VFX effects. */
export const MAX_PARTICLES = 300;

/** Create a new particle and add it to an effect's particle array. */
export function spawnParticle(
  effect: VFXEffect,
  x: number,
  y: number,
  vx: number,
  vy: number,
  color: RGB,
  size: number,
  life: number,
  shape: 'square' | 'circle' = 'square',
  gravity: number = 0,
): void {
  if (!effect._canSpawn) return;
  effect.particles.push({
    x,
    y,
    vx,
    vy,
    color,
    size,
    life,
    maxLife: life,
    alpha: 1,
    shape,
    gravity,
    drag: 0.98,
  });
}

/** Update all particle physics: position, velocity, gravity, drag, alpha, lifecycle. */
export function tickParticles(particles: Particle[], dt: number): void {
  const dtS = dt / 1000;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dtS;
    p.y += p.vy * dtS;
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.vy += p.gravity * dtS;
    p.life -= dt;
    p.alpha = Math.max(0, p.life / p.maxLife);
    if (p.life <= 0) {
      particles.splice(i, 1);
    }
  }
}

/** Count total particles across all active effects. */
export function countParticles(effects: VFXEffect[]): number {
  let total = 0;
  for (const fx of effects) total += fx.particles.length;
  return total;
}
