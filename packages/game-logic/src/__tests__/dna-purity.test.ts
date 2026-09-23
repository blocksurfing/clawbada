/**
 * `randomDNAWithPurity` — the dojo needs a lobster of a CHOSEN purity, and purity is counted
 * from the genes rather than stored, so the genes have to actually be built that way.
 */
import { describe, expect, test } from 'bun:test';
import { calculatePurity, decodeBodyPart, decodeClass, isValidDNA, randomDNAWithPurity } from '../dna';
import { NUM_BODY_PARTS } from '../constants';
import { LobsterClass } from '../types';

const CLASSES = Object.values(LobsterClass).filter((v): v is LobsterClass => typeof v === 'number');
/** Deterministic generator so a failure is reproducible. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

describe('randomDNAWithPurity', () => {
  test('every purity 0-6 is produced exactly, for every class', () => {
    for (const cls of CLASSES) {
      for (let target = 0; target <= NUM_BODY_PARTS; target++) {
        const dna = randomDNAWithPurity(cls, target, seeded(cls * 100 + target));
        expect(calculatePurity(dna)).toBe(target);
        expect(decodeClass(dna)).toBe(cls);
        expect(isValidDNA(dna)).toBe(true);
      }
    }
  });

  test('holds across many draws — a non-matching dominant never lands on the class by luck', () => {
    // The overshoot this guards against: picking a random affinity for a non-matching slot
    // and happening to draw the lobster's own class, which silently raises purity.
    for (let i = 0; i < 300; i++) {
      const cls = CLASSES[i % CLASSES.length]!;
      const target = i % (NUM_BODY_PARTS + 1);
      expect(calculatePurity(randomDNAWithPurity(cls, target, seeded(i)))).toBe(target);
    }
  });

  test('purity 6 means every dominant is the lobster\'s own class — it looks pure, not just scores pure', () => {
    const dna = randomDNAWithPurity(LobsterClass.Kraken, 6, seeded(7));
    for (let slot = 0; slot < NUM_BODY_PARTS; slot++) {
      expect(decodeBodyPart(dna, slot).dominant.classAffinity).toBe(LobsterClass.Kraken);
    }
  });

  test('purity 0 means no dominant matches', () => {
    const dna = randomDNAWithPurity(LobsterClass.Ember, 0, seeded(11));
    for (let slot = 0; slot < NUM_BODY_PARTS; slot++) {
      expect(decodeBodyPart(dna, slot).dominant.classAffinity).not.toBe(LobsterClass.Ember);
    }
  });

  test('which slots match varies — two pure-3 lobsters of a class are not identical', () => {
    const shapes = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const dna = randomDNAWithPurity(LobsterClass.Mantis, 3, seeded(1000 + i));
      shapes.add([...Array(NUM_BODY_PARTS).keys()].map(s => (decodeBodyPart(dna, s).dominant.classAffinity === LobsterClass.Mantis ? '1' : '0')).join(''));
    }
    expect(shapes.size).toBeGreaterThan(1);
  });

  test('rejects a purity outside 0-6 rather than clamping it', () => {
    expect(() => randomDNAWithPurity(LobsterClass.Bulwark, 7)).toThrow(/0-6/);
    expect(() => randomDNAWithPurity(LobsterClass.Bulwark, -1)).toThrow(/0-6/);
    expect(() => randomDNAWithPurity(LobsterClass.Bulwark, 2.5)).toThrow(/0-6/);
  });

  test('is deterministic for a given rng — practice rosters replay identically', () => {
    expect(randomDNAWithPurity(LobsterClass.Abyss, 4, seeded(42))).toBe(randomDNAWithPurity(LobsterClass.Abyss, 4, seeded(42)));
  });
});
