/** Shared damage/status helpers used by turn resolution and Specials. */
import { DEFEND_REDUCTION_BPS, MULT_DENOM, PURITY_POTENCY_PER } from '../constants';
import type { Stats } from '../types';
import type { AtbBattleState, AtbLobster, DamageEvent, Status, TurnResult } from './state';

export function findLobster(state: AtbBattleState, id: string): AtbLobster | undefined {
  return state.lobsters.find(l => l.id === id);
}

export function purityMult(l: AtbLobster): bigint {
  return MULT_DENOM + BigInt(l.purity) * PURITY_POTENCY_PER;
}

/** Stats after Haunt (Atk/Armor reduction). Speed is handled by atb.effectiveSpeed. */
export function effectiveStats(l: AtbLobster): Stats {
  let { attack, armor } = l.stats;
  for (const s of l.statuses)
    if (s.type === 'haunt') {
      attack = (attack * (MULT_DENOM - s.value)) / MULT_DENOM;
      armor = (armor * (MULT_DENOM - s.value)) / MULT_DENOM;
    }
  return { ...l.stats, attack, armor: armor > 0n ? armor : 1n };
}

export function hasStatus(l: AtbLobster, type: Status['type']): boolean {
  return l.statuses.some(s => s.type === type);
}

/** Same-type status refreshes rather than stacks (durations don't compound). */
export function addStatus(l: AtbLobster, status: Omit<Status, 'since'>, out: TurnResult): void {
  const existing = l.statuses.find(s => s.type === status.type);
  if (existing) {
    existing.turns = Math.max(existing.turns, status.turns);
    if (status.value > existing.value) existing.value = status.value;
    existing.uncleansable = existing.uncleansable || status.uncleansable;
  } else {
    l.statuses.push({ ...status, since: out.turn });
  }
  out.statuses.push({ targetId: l.id, status: status.type, applied: true, turns: status.turns });
}

export function cleanseDebuffs(l: AtbLobster, out: TurnResult): void {
  const keep: Status[] = [];
  for (const s of l.statuses) {
    const isDebuff = s.type === 'bleed' || s.type === 'haunt' || s.type === 'stun' || s.type === 'slow';
    if (isDebuff && !s.uncleansable) out.statuses.push({ targetId: l.id, status: s.type, applied: false });
    else keep.push(s);
  }
  l.statuses = keep;
}

interface DamageOpts {
  pierceDefend?: boolean;
  isCrit?: boolean;
  /** Skip Defend/Fortify/Shield mitigation (self-damage, bleed). */
  raw?: boolean;
}

/**
 * Apply damage to `target` with V3 mitigation: Defend halves (unless pierced),
 * Fortify and Shield reduce, enhanced-Fortify reflects a share of what was
 * blocked back at the attacker. Returns damage actually dealt.
 */
export function applyIncomingDamage(
  state: AtbBattleState,
  source: AtbLobster,
  target: AtbLobster,
  amount: bigint,
  kind: DamageEvent['kind'],
  out: TurnResult,
  opts: DamageOpts = {},
): bigint {
  if (amount < 0n) amount = 0n;
  let dmg = amount;
  if (!opts.raw) {
    if (target.defending && !opts.pierceDefend) dmg = (dmg * DEFEND_REDUCTION_BPS) / 10_000n;
    for (const s of target.statuses) if (s.type === 'fortify' || s.type === 'shield') dmg = (dmg * (MULT_DENOM - s.value)) / MULT_DENOM;
  }
  const blocked = amount - dmg;
  dealDamage(target, dmg, kind, out, opts.isCrit);
  if (!opts.raw && blocked > 0n && source.id !== target.id) {
    const reflect = target.statuses.find(s => s.type === 'reflect');
    if (reflect && source.alive) dealDamage(source, (blocked * reflect.value) / MULT_DENOM, 'reflect', out);
  }
  return dmg;
}

export function dealDamage(target: AtbLobster, amount: bigint, kind: DamageEvent['kind'], out: TurnResult, isCrit?: boolean): void {
  if (amount <= 0n && kind !== 'attack' && kind !== 'special') return;
  target.hp -= amount;
  let killed = false;
  if (target.hp <= 0n) {
    target.hp = 0n;
    if (target.alive) killed = true;
    target.alive = false;
  }
  out.damage.push({ targetId: target.id, amount, kind, isCrit, killed });
}
