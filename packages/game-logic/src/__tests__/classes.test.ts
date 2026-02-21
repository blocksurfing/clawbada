import { describe, test, expect } from 'bun:test';
import {
  CLASS_NAMES,
  CLASS_NAMES_LIST,
  CLASS_ROLES,
  CLASS_SPECIAL_NAMES,
  CLASS_ADVANTAGE_GRAPH,
} from '../classes';
import { LobsterClass } from '../types';
import { NUM_CLASSES } from '../constants';

describe('CLASS_NAMES', () => {
  test('has exactly 10 entries', () => {
    expect(Object.keys(CLASS_NAMES)).toHaveLength(NUM_CLASSES);
  });

  test('all values are non-empty strings', () => {
    for (let i = 0; i < NUM_CLASSES; i++) {
      const name = CLASS_NAMES[i as LobsterClass];
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

describe('CLASS_NAMES_LIST', () => {
  test('has exactly 10 entries', () => {
    expect(CLASS_NAMES_LIST).toHaveLength(NUM_CLASSES);
  });

  test('matches CLASS_NAMES by index', () => {
    for (let i = 0; i < NUM_CLASSES; i++) {
      expect(CLASS_NAMES_LIST[i]).toBe(CLASS_NAMES[i as LobsterClass]);
    }
  });
});

describe('CLASS_ROLES', () => {
  test('has exactly 10 entries', () => {
    expect(Object.keys(CLASS_ROLES)).toHaveLength(NUM_CLASSES);
  });

  test('all values are non-empty strings', () => {
    for (let i = 0; i < NUM_CLASSES; i++) {
      const role = CLASS_ROLES[i as LobsterClass];
      expect(typeof role).toBe('string');
      expect(role.length).toBeGreaterThan(0);
    }
  });
});

describe('CLASS_SPECIAL_NAMES', () => {
  test('has exactly 10 entries', () => {
    expect(Object.keys(CLASS_SPECIAL_NAMES)).toHaveLength(NUM_CLASSES);
  });

  test('all values are non-empty strings', () => {
    for (let i = 0; i < NUM_CLASSES; i++) {
      const special = CLASS_SPECIAL_NAMES[i as LobsterClass];
      expect(typeof special).toBe('string');
      expect(special.length).toBeGreaterThan(0);
    }
  });
});

describe('CLASS_ADVANTAGE_GRAPH', () => {
  test('has exactly 10 entries', () => {
    expect(Object.keys(CLASS_ADVANTAGE_GRAPH)).toHaveLength(NUM_CLASSES);
  });

  test('each class beats exactly 4 others', () => {
    for (let i = 0; i < NUM_CLASSES; i++) {
      const beats = CLASS_ADVANTAGE_GRAPH[i as LobsterClass];
      expect(beats.size).toBe(4);
    }
  });

  test('each class loses to exactly 4 others', () => {
    for (let i = 0; i < NUM_CLASSES; i++) {
      let lossCount = 0;
      for (let j = 0; j < NUM_CLASSES; j++) {
        if (i === j) continue;
        if (CLASS_ADVANTAGE_GRAPH[j as LobsterClass].has(i as LobsterClass)) {
          lossCount++;
        }
      }
      expect(lossCount).toBe(4);
    }
  });

  test('no class beats itself', () => {
    for (let i = 0; i < NUM_CLASSES; i++) {
      const beats = CLASS_ADVANTAGE_GRAPH[i as LobsterClass];
      expect(beats.has(i as LobsterClass)).toBe(false);
    }
  });

  test('circulant pattern: class i beats (i+1)..(i+4) mod 10', () => {
    for (let i = 0; i < NUM_CLASSES; i++) {
      const beats = CLASS_ADVANTAGE_GRAPH[i as LobsterClass];
      for (let j = 1; j <= 4; j++) {
        const target = ((i + j) % 10) as LobsterClass;
        expect(beats.has(target)).toBe(true);
      }
      // Classes i+5 through i+9 mod 10 should NOT be beaten by i
      for (let j = 5; j <= 9; j++) {
        const target = ((i + j) % 10) as LobsterClass;
        expect(beats.has(target)).toBe(false);
      }
    }
  });

  test('advantage relationship is asymmetric: if A beats B then B does not beat A', () => {
    for (let i = 0; i < NUM_CLASSES; i++) {
      for (const target of CLASS_ADVANTAGE_GRAPH[i as LobsterClass]) {
        // If i beats target, then target should NOT beat i
        expect(CLASS_ADVANTAGE_GRAPH[target].has(i as LobsterClass)).toBe(false);
      }
    }
  });
});
