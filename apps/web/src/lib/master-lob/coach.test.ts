import { describe, expect, test } from 'bun:test';
import { CoachCadence, chooseTip, resetIfExhausted, type CoachContext, type CoachTip } from './coach';
import { TIPS } from './tips';

const tip = (id: string, tier: CoachTip['tier'], extra: Partial<CoachTip> = {}): CoachTip => ({ id, tier, text: id, ...extra });

describe('Master Lob cadence', () => {
  test('speaks on the first player turn, then every 2–4 player turns', () => {
    for (const r of [0, 0.5, 0.99]) {
      const c = new CoachCadence(() => r);
      const spoke: number[] = [];
      for (let turn = 1; turn <= 20; turn++) {
        if (c.onPlayerTurn()) { spoke.push(turn); c.spoke(); }
      }
      expect(spoke[0]).toBe(1);
      for (let i = 1; i < spoke.length; i++) {
        const gap = spoke[i] - spoke[i - 1];
        expect(gap).toBeGreaterThanOrEqual(2);
        expect(gap).toBeLessThanOrEqual(4);
      }
    }
  });
  test('a refused moment retries on the next turn', () => {
    const c = new CoachCadence(() => 0);
    expect(c.onPlayerTurn()).toBe(true);
    c.retryNext();
    expect(c.onPlayerTurn()).toBe(true);
  });
});

describe('Master Lob tip choice', () => {
  const ctx = {} as CoachContext;
  const tips = [
    tip('b1', 'beginner'), tip('b2', 'beginner'), tip('i1', 'intermediate'), tip('a1', 'advanced'),
    tip('i-bulwark', 'intermediate', { classes: ['bulwark'] }),
    tip('s1', 'beginner', { when: () => true }),
    tip('s2', 'intermediate', { when: () => false }),
  ];
  test('a situational tip that fires comes first, once a battle', () => {
    expect(chooseTip(tips, ctx, new Set(), new Set(), new Set())?.id).toBe('s1');
    expect(chooseTip(tips, ctx, new Set(), new Set(), new Set(['s1']))?.id).toBe('b1');
  });
  test('the curriculum goes in tier order and skips what was seen', () => {
    expect(chooseTip(tips, null, new Set(), new Set(['b1']), new Set())?.id).toBe('b2');
    expect(chooseTip(tips, null, new Set(), new Set(['b1', 'b2']), new Set())?.id).toBe('i1');
    expect(chooseTip(tips, null, new Set(), new Set(['b1', 'b2', 'i1']), new Set())?.id).toBe('a1');
  });
  test('class tips only with that class on the team', () => {
    const seen = new Set(['b1', 'b2', 'i1']);
    expect(chooseTip(tips, null, new Set(['mantis']), seen, new Set())?.id).toBe('a1');
    expect(chooseTip(tips, null, new Set(['bulwark']), seen, new Set())?.id).toBe('i-bulwark');
  });
  test('a trigger that throws never breaks the choice', () => {
    const bad = [tip('boom', 'beginner', { when: () => { throw new Error('x'); } }), tip('b1', 'beginner')];
    expect(chooseTip(bad, ctx, new Set(), new Set(), new Set())?.id).toBe('b1');
  });
  test('once everything relevant is seen the curriculum starts over', () => {
    const seen = new Set(['b1', 'b2', 'i1', 'a1']);
    resetIfExhausted(tips, new Set(['mantis']), seen);
    expect(seen.size).toBe(0);
  });
});

describe('the tip list', () => {
  test('unique ids, ≤ 160 characters, a healthy curriculum in every tier', () => {
    const ids = new Set(TIPS.map((t) => t.id));
    expect(ids.size).toBe(TIPS.length);
    for (const t of TIPS) {
      expect(t.text.length).toBeLessThanOrEqual(160);
      expect(t.text.trim()).toBe(t.text);
    }
    for (const tier of ['beginner', 'intermediate', 'advanced'] as const) {
      expect(TIPS.filter((t) => t.tier === tier && !t.when).length).toBeGreaterThanOrEqual(15);
    }
    expect(TIPS.filter((t) => t.when).length).toBeGreaterThanOrEqual(8);
  });
});
