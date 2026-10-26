import { describe, expect, test } from 'bun:test';
import { EMPTY_SLOTS, builderSummary, dropOnSlot, ownedSummary, pageCount, purityDescription, removeFromSlots, slotsComplete, toggleSlot } from './dojo-model';

describe('dojo lineup edits', () => {
  test('click fills the first free slot, then reports a full team', () => {
    let s = toggleSlot(EMPTY_SLOTS, '101').slots;
    s = toggleSlot(s, '102').slots;
    s = toggleSlot(s, '103').slots;
    expect(s).toEqual(['101', '102', '103']);
    const full = toggleSlot(s, '104');
    expect(full.full).toBe(true);
    expect(full.slots).toEqual(['101', '102', '103']);
  });

  test('clicking a picked lobster removes it and closes ranks', () => {
    expect(toggleSlot(['101', '102', '103'], '101').slots).toEqual(['102', '103', '']);
    expect(toggleSlot(['101', '102', '103'], '101').full).toBe(false);
  });

  test('a removed slot is refilled first', () => {
    const s = toggleSlot(['101', '', '103'], '104').slots;
    expect(s).toEqual(['101', '104', '103']);
  });

  test('drag from the inventory replaces the target slot', () => {
    expect(dropOnSlot(['101', '102', '103'], '104', 1)).toEqual(['101', '104', '103']);
    expect(dropOnSlot(['', '', ''], '104', 2)).toEqual(['', '', '104']);
  });

  test('drag within the lineup swaps, never duplicates', () => {
    const s = dropOnSlot(['101', '102', '103'], '101', 2);
    expect(s).toEqual(['103', '102', '101']);
    expect(new Set(s).size).toBe(3);
    expect(dropOnSlot(['101', '', '103'], '101', 1)).toEqual(['', '101', '103']);
  });

  test('drag onto the inventory removes', () => {
    expect(removeFromSlots(['101', '102', '103'], '102')).toEqual(['101', '103', '']);
  });

  test('a team is three distinct lobsters', () => {
    expect(slotsComplete(['101', '102', '103'])).toBe(true);
    expect(slotsComplete(['101', '102', ''])).toBe(false);
    expect(slotsComplete(['101', '101', '103'])).toBe(false);
  });
});

describe('dojo text', () => {
  test('purity line', () => {
    expect(purityDescription(0)).toBe('Specials hit 100% as hard and fire their enhanced version 5% of the time.');
    expect(purityDescription(6)).toBe('Specials hit 160% as hard and fire their enhanced version 35% of the time.');
  });

  test('builder summary keeps the format the harness waits for', () => {
    expect(builderSummary(['bulwark', 'leviathan', 'sentinel'], 'evolved', 2, 'Charger')).toBe('Bulwark · Leviathan · Sentinel, Evolved, purity 2 vs Charger');
  });

  test('owned summary', () => {
    expect(ownedSummary(['Kraken #7', 'Ember #9', 'Abyss #12'], '3', 'Balanced')).toBe('Team #3: Kraken #7 · Ember #9 · Abyss #12 vs Balanced');
    expect(ownedSummary(['Kraken #7', 'Ember #9', 'Abyss #12'], null, 'Deep')).toBe('Kraken #7 · Ember #9 · Abyss #12 vs Deep');
  });

  test('pages of ten', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(10)).toBe(1);
    expect(pageCount(11)).toBe(2);
  });
});
