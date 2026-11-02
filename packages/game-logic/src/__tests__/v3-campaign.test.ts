import { describe, expect, test } from 'bun:test';
import { EvolutionTier, LobsterClass } from '../types';
import { v3 } from '../index';

// Balance-campaign instruments (2026-11-02): optional rules, absent by default — today's game is untouched.
const team = (p: string, c: LobsterClass) => [0, 1, 2].map((j) => ({ id: `${p}${j}`, class: c, tier: EvolutionTier.Elite, purity: 0 }));
const battle = (rules?: Partial<v3.BattleRules>) => v3.createBattle({ battleId: 'c', vrfSeed: 7n, tier: 'elite', teamA: team('A', LobsterClass.Ember), teamB: team('B', LobsterClass.Bulwark), rules });

describe('campaign instruments', () => {
  test('absent from DEFAULT_RULES (the rules version cannot move)', () => {
    expect(v3.DEFAULT_RULES.statMult).toBeUndefined();
    expect(v3.DEFAULT_RULES.focusOnWait).toBeUndefined();
  });

  test('statMult scales the chosen stats of the chosen class only', () => {
    const plain = battle(), tuned = battle({ statMult: { [LobsterClass.Ember]: { hp: 1100n, speed: 900n } } });
    const e0 = plain.lobsters[0], e1 = tuned.lobsters[0], b0 = plain.lobsters[3], b1 = tuned.lobsters[3];
    expect(e1.stats.hp).toBe((e0.stats.hp * 1100n) / 1000n);
    expect(e1.maxHp).toBe(e1.stats.hp);
    expect(e1.stats.speed).toBe((e0.stats.speed * 900n) / 1000n);
    expect(e1.stats.attack).toBe(e0.stats.attack);
    expect(b1.stats).toEqual(b0.stats);
  });

  test('focusOnWait: Wait banks 2 charge and a Focus; the next hit deals +bonus, and the Focus is spent', () => {
    const rules = { focusOnWait: { bonusBps: 5000n, bonusCharge: 1 } };
    const hit = (focused: boolean) => {
      const s = battle(rules);
      const a = v3.nextActor(s)!;
      const e = s.lobsters.find((l) => l.team !== a.team)!;
      e.pos = { col: a.pos.col + (a.pos.col < 5 ? 1 : -1), row: a.pos.row };
      if (focused) a.statuses.push({ type: 'focus', turns: 1, value: 5000n, since: 0 });
      const r = v3.applyTurn(s, { lobsterId: a.id, action: 'attack', targetId: e.id });
      return { dmg: r.damage.find((d) => d.targetId === e.id)!.amount, left: a.statuses.some((x) => x.type === 'focus') };
    };
    const plain = hit(false), focused = hit(true);
    expect(focused.dmg).toBe((plain.dmg * 15000n) / 10000n);
    expect(focused.left).toBe(false);
    const s = battle(rules);
    const a = v3.nextActor(s)!;
    v3.applyTurn(s, { lobsterId: a.id, action: 'none' });
    expect(a.charge).toBe(2);
    expect(a.statuses.some((x) => x.type === 'focus')).toBe(true);
  });

  test("without focusOnWait, Wait is today's pass: 1 charge, no Focus", () => {
    const s = battle();
    const a = v3.nextActor(s)!;
    v3.applyTurn(s, { lobsterId: a.id, action: 'none' });
    expect(a.charge).toBe(1);
    expect(a.statuses.length).toBe(0);
  });
});
