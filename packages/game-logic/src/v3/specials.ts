/**
 * The ten class Specials under V3 rules. Ranges/durations per docs/gitbook/battle.md
 * "Specials Reference"; durations are turns of the affected lobster.
 */
import { MULT_DENOM, SPECIAL_BASE_POWERS } from '../constants';
import { deriveRandom, deriveVrfRoll } from '../hash';
import { calculateSpecialDamage, getClassAdvantage } from '../battle-resolver';
import { LobsterClass } from '../types';
import { hexDistance } from './board';
import {
  BIND_STUN_TURNS,
  CRUSH_ENHANCED_BONUS,
  FORTIFY_REDUCTION,
  FORTIFY_TURNS,
  HAUNT_ENHANCED_TURNS,
  HAUNT_TURNS,
  INFERNO_SELF_DAMAGE,
  INFERNO_SELF_DAMAGE_ENHANCED,
  MAELSTROM_SLOW,
  MAELSTROM_SLOW_TURNS,
  MANTIS_ARMOR_PIERCE,
  RALLY_SHIELD_REDUCTION,
  RALLY_SHIELD_TURNS,
  REND_TURNS,
  SPECIAL_RANGE,
} from './constants';
import type { AtbBattleState, AtbLobster, TurnResult } from './state';
import { addStatus, applyIncomingDamage, cleanseDebuffs, effectiveStats, findLobster, purityMult } from './effects';

/** Which targets are legal for a class's Special from the actor's position. */
export function specialTargetKind(cls: LobsterClass): 'none' | 'enemy' | 'ally' {
  if (cls === LobsterClass.Bulwark || cls === LobsterClass.Tempest) return 'none';
  if (cls === LobsterClass.Sentinel) return 'ally';
  return 'enemy';
}

/** Special base power under this battle's rules (spec table unless overridden). */
export function specialPowerOf(state: AtbBattleState, cls: LobsterClass): bigint {
  return state.rules.specialPower[cls] ?? SPECIAL_BASE_POWERS[cls];
}

export function specialInRange(actor: AtbLobster, target: AtbLobster): boolean {
  const range = SPECIAL_RANGE[actor.class];
  return hexDistance(actor.pos, target.pos) <= range;
}

function specialDamage(actor: AtbLobster, target: AtbLobster, basePower: bigint, seed: bigint): bigint {
  const a = effectiveStats(actor);
  const t = effectiveStats(target);
  return calculateSpecialDamage(basePower, a.attack, t.armor, getClassAdvantage(actor.class, target.class), actor.purity, deriveVrfRoll(seed, 'special_vrf'));
}

export function resolveSpecial(
  state: AtbBattleState,
  actor: AtbLobster,
  target: AtbLobster | null,
  seed: bigint,
  isEnhanced: boolean,
  out: TurnResult,
): void {
  const base = specialPowerOf(state, actor.class);
  switch (actor.class) {
    case LobsterClass.Bulwark: {
      for (const ally of state.lobsters) {
        if (ally.team !== actor.team || !ally.alive) continue;
        addStatus(ally, { type: 'fortify', turns: FORTIFY_TURNS, value: FORTIFY_REDUCTION }, out);
        const reflect = isEnhanced ? state.rules.fortifyReflectEnhanced : state.rules.fortifyReflectBase;
        if (reflect > 0n) addStatus(ally, { type: 'reflect', turns: FORTIFY_TURNS, value: reflect }, out);
      }
      if (state.rules.fortifyTaunt) addStatus(actor, { type: 'taunt', turns: FORTIFY_TURNS, value: 0n }, out);
      return;
    }
    case LobsterClass.Mantis: {
      const t = target!;
      const a = effectiveStats(actor);
      const ts = effectiveStats(t);
      const armor = (ts.armor * (MULT_DENOM - MANTIS_ARMOR_PIERCE)) / MULT_DENOM;
      const classMult = getClassAdvantage(actor.class, t.class);
      let dmg = calculateSpecialDamage(base, a.attack, armor > 0n ? armor : 1n, classMult, actor.purity, deriveVrfRoll(seed, 'special_vrf'));
      if (isEnhanced) dmg = (dmg * 1500n) / MULT_DENOM; // guaranteed crit
      applyIncomingDamage(state, actor, t, dmg, 'special', out, { pierceDefend: false, isCrit: isEnhanced });
      return;
    }
    case LobsterClass.Leviathan: {
      const t = target!;
      let power = base;
      if (isEnhanced && t.hp * 2n < t.maxHp) power = (power * CRUSH_ENHANCED_BONUS) / MULT_DENOM;
      applyIncomingDamage(state, actor, t, specialDamage(actor, t, power, seed), 'special', out);
      return;
    }
    case LobsterClass.Tempest: {
      let i = 0;
      for (const enemy of state.lobsters) {
        if (enemy.team === actor.team || !enemy.alive) continue;
        if (hexDistance(actor.pos, enemy.pos) > SPECIAL_RANGE[actor.class]) continue;
        const dmg = specialDamage(actor, enemy, base, deriveRandom(seed, `maelstrom_${i++}`));
        applyIncomingDamage(state, actor, enemy, dmg, 'special', out);
        if (isEnhanced && enemy.alive) addStatus(enemy, { type: 'slow', turns: MAELSTROM_SLOW_TURNS, value: MAELSTROM_SLOW }, out);
      }
      return;
    }
    case LobsterClass.Specter: {
      const t = target!;
      applyIncomingDamage(state, actor, t, specialDamage(actor, t, base, seed), 'special', out);
      if (t.alive)
        addStatus(t, { type: 'haunt', turns: isEnhanced ? HAUNT_ENHANCED_TURNS : HAUNT_TURNS, value: state.rules.hauntReduction + (isEnhanced ? 100n : 0n) }, out);
      return;
    }
    case LobsterClass.Sentinel: {
      const ally = target!;
      const heal = (ally.maxHp * state.rules.rallyHealPct * purityMult(actor)) / (MULT_DENOM * MULT_DENOM);
      const before = ally.hp;
      ally.hp = ally.hp + heal > ally.maxHp ? ally.maxHp : ally.hp + heal;
      out.heals.push({ targetId: ally.id, amount: ally.hp - before });
      cleanseDebuffs(ally, out);
      if (isEnhanced) addStatus(ally, { type: 'shield', turns: RALLY_SHIELD_TURNS, value: RALLY_SHIELD_REDUCTION }, out);
      return;
    }
    case LobsterClass.Reaver: {
      const t = target!;
      applyIncomingDamage(state, actor, t, specialDamage(actor, t, base, seed), 'special', out);
      if (t.alive) {
        const bleed = (state.rules.rendBleedPerTurn * purityMult(actor)) / MULT_DENOM;
        addStatus(t, { type: 'bleed', turns: REND_TURNS, value: bleed, uncleansable: isEnhanced }, out);
      }
      return;
    }
    case LobsterClass.Abyss: {
      const t = target!;
      const dealt = applyIncomingDamage(state, actor, t, specialDamage(actor, t, base, seed), 'special', out);
      const before = actor.hp;
      actor.hp += dealt;
      if (!isEnhanced && actor.hp > actor.maxHp) actor.hp = actor.maxHp; // enhanced: overheal stays as temp HP
      out.heals.push({ targetId: actor.id, amount: actor.hp - before });
      return;
    }
    case LobsterClass.Kraken: {
      const t = target!;
      applyIncomingDamage(state, actor, t, specialDamage(actor, t, base, seed), 'special', out, { pierceDefend: isEnhanced });
      if (t.alive && t.stunImmunity === 0) addStatus(t, { type: 'stun', turns: BIND_STUN_TURNS, value: 0n }, out);
      return;
    }
    case LobsterClass.Ember: {
      const t = target!;
      const dealt = applyIncomingDamage(state, actor, t, specialDamage(actor, t, base, seed), 'special', out);
      const self = (dealt * (isEnhanced ? INFERNO_SELF_DAMAGE_ENHANCED : INFERNO_SELF_DAMAGE)) / MULT_DENOM;
      applyIncomingDamage(state, actor, actor, self, 'self', out, { raw: true });
      return;
    }
  }
}

export { findLobster };
