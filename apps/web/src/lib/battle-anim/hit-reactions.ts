import type { HitState, BattleAnimState } from './types';

/** Create a fresh (no-hit) state. */
export function createHitState(): HitState {
  return {
    flash: 0,
    knockX: 0,
    knockY: 0,
    tilt: 0,
    timer: 0,
    grayscale: false,
  };
}

/** Trigger a flinch reaction on a lobster (from taking damage). */
export function triggerFlinch(
  anim: BattleAnimState,
  damage: number,
  fromRight: boolean,
): void {
  const intensity = Math.min(damage / 200, 1);
  const dir = fromRight ? 1 : -1;

  anim.hit.flash = 250;
  anim.hit.knockX = dir * (4 + intensity * 6);
  anim.hit.knockY = -(2 + intensity * 3);
  anim.hit.tilt = dir * (3 + intensity * 5);
  anim.hit.timer = 350;
}

/** Apply death effect (grayscale, slight sink). */
export function applyDeathEffect(anim: BattleAnimState): void {
  anim.hit.grayscale = true;
  anim.alive = false;
}

/** Tick hit reaction state: decay flash, knockback, tilt over time. */
export function tickHitReactions(anim: BattleAnimState, dt: number): void {
  const h = anim.hit;
  if (h.timer <= 0) return;

  h.timer -= dt;
  h.flash = Math.max(0, h.flash - dt);

  // Exponential decay for knockback and tilt
  const decay = Math.pow(0.88, dt / 16);
  h.knockX *= decay;
  h.knockY *= decay;
  h.tilt *= decay;

  if (h.timer <= 0) {
    h.knockX = 0;
    h.knockY = 0;
    h.tilt = 0;
    h.timer = 0;
  }
}
