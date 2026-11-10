import { describe, test, expect } from 'bun:test';
import { LiveBattleBudget, maxLivePerIpFromEnv, DEFAULT_MAX_LIVE_PER_IP } from '../../lib/live-battle-budget';

/** A budget over a set of battle ids the test marks live or finished. */
function setup(max = 2) {
  const live = new Set<string>();
  const budget = new LiveBattleBudget((id) => live.has(id), () => max);
  const start = (ip: string, id: string): boolean => {
    if (!budget.tryStart(ip)) return false;
    live.add(id);
    budget.started(ip, id);
    return true;
  };
  return { live, budget, start };
}

describe('LiveBattleBudget', () => {
  test('an IP gets its share and no more; another IP is unaffected', () => {
    const { budget, start } = setup(2);
    expect(start('1.1.1.1', 'p_1')).toBe(true);
    expect(start('1.1.1.1', 'p_2')).toBe(true);
    expect(budget.atLimit('1.1.1.1')).toBe(true);
    expect(start('1.1.1.1', 'p_3')).toBe(false);
    expect(start('2.2.2.2', 'p_4')).toBe(true);
    expect(budget.liveFor('1.1.1.1')).toBe(2);
  });

  test('a finished battle frees its slot without anyone telling the budget', () => {
    const { live, budget, start } = setup(1);
    expect(start('1.1.1.1', 'p_1')).toBe(true);
    expect(start('1.1.1.1', 'p_2')).toBe(false);
    live.delete('p_1');
    expect(budget.atLimit('1.1.1.1')).toBe(false);
    expect(start('1.1.1.1', 'p_2')).toBe(true);
    expect(budget.has('p_1')).toBe(false);   // forgotten once it was seen finished
  });

  test('starts in flight hold a slot, so a burst cannot slip under the cap', () => {
    const { budget } = setup(2);
    expect(budget.tryStart('1.1.1.1')).toBe(true);
    expect(budget.tryStart('1.1.1.1')).toBe(true);
    expect(budget.tryStart('1.1.1.1')).toBe(false);   // both slots held, neither battle exists yet
    budget.abandoned('1.1.1.1');                       // one start failed
    expect(budget.tryStart('1.1.1.1')).toBe(true);
  });

  test('a start that did not happen gives the slot back', () => {
    const { budget } = setup(1);
    expect(budget.tryStart('1.1.1.1')).toBe(true);
    budget.abandoned('1.1.1.1');
    expect(budget.liveFor('1.1.1.1')).toBe(0);
    budget.abandoned('1.1.1.1');                       // one too many does not go negative
    expect(budget.tryStart('1.1.1.1')).toBe(true);
    expect(budget.tryStart('1.1.1.1')).toBe(false);
  });

  test('has() tells whether a battle is already counted (a friend battle is started by one of two requests)', () => {
    const { budget, start } = setup(3);
    expect(budget.has('f_1')).toBe(false);
    start('1.1.1.1', 'f_1');
    expect(budget.has('f_1')).toBe(true);
  });

  test('an unresolved IP is never refused and never recorded', () => {
    const { budget, live } = setup(1);
    for (let i = 0; i < 5; i++) {
      expect(budget.tryStart('unknown')).toBe(true);
      live.add(`p_${i}`);
      budget.started('unknown', `p_${i}`);
    }
    expect(budget.atLimit('unknown')).toBe(false);
    expect(budget.has('p_0')).toBe(false);
  });

  test('the share comes from PRACTICE_MAX_LIVE_PER_IP, default 6', () => {
    expect(DEFAULT_MAX_LIVE_PER_IP).toBe(6);
    expect(maxLivePerIpFromEnv({})).toBe(6);
    expect(maxLivePerIpFromEnv({ PRACTICE_MAX_LIVE_PER_IP: '2' })).toBe(2);
    expect(maxLivePerIpFromEnv({ PRACTICE_MAX_LIVE_PER_IP: '-1' })).toBe(6);
    expect(maxLivePerIpFromEnv({ PRACTICE_MAX_LIVE_PER_IP: 'many' })).toBe(6);
  });
});
