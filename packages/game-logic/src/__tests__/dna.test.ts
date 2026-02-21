import { describe, test, expect } from 'bun:test';
import {
  decodeAllele,
  encodeAllele,
  decodeClass,
  decodeLegend,
  decodeBreedType,
  decodeBodyPart,
  calculatePurity,
  encodeDNA,
  decodeDNA,
  isValidDNA,
} from '../dna';
import { LobsterClass, LegendStatus } from '../types';
import { CLASS_SHIFT, LEGEND_SHIFT, BREED_TYPE_SHIFT, NUM_BODY_PARTS } from '../constants';

// ──────────── Helper: build alleles array ────────────

/** Create an array of 18 allele bytes with the given class affinity and variant for all slots. */
function makeUniformAlleles(classAffinity: number, variant: number): number[] {
  const byte = ((classAffinity & 0xf) << 4) | (variant & 0xf);
  return Array(18).fill(byte);
}

/** Create alleles where dominant (every 3rd starting at 0) has the given class affinity, rest have a different one. */
function makeMixedAlleles(dominantClass: number, otherClass: number, variant: number): number[] {
  const alleles: number[] = [];
  for (let part = 0; part < 6; part++) {
    alleles.push(((dominantClass & 0xf) << 4) | (variant & 0xf)); // Dominant
    alleles.push(((otherClass & 0xf) << 4) | (variant & 0xf));    // R1
    alleles.push(((otherClass & 0xf) << 4) | (variant & 0xf));    // R2
  }
  return alleles;
}

// ──────────── decodeAllele / encodeAllele ────────────

describe('decodeAllele', () => {
  test('extracts class affinity from high nibble', () => {
    const allele = decodeAllele(0x93); // classAffinity=9, variant=3
    expect(allele.classAffinity).toBe(9);
  });

  test('extracts variant from low nibble', () => {
    const allele = decodeAllele(0x93);
    expect(allele.variant).toBe(3);
  });

  test('handles zero byte', () => {
    const allele = decodeAllele(0x00);
    expect(allele.classAffinity).toBe(0);
    expect(allele.variant).toBe(0);
  });

  test('handles max valid values (class=9, variant=15)', () => {
    const allele = decodeAllele(0x9f);
    expect(allele.classAffinity).toBe(9);
    expect(allele.variant).toBe(15);
  });

  test('round-trips through encodeAllele for all valid class/variant combos', () => {
    for (let c = 0; c <= 9; c++) {
      for (let v = 0; v <= 15; v++) {
        const encoded = encodeAllele({ classAffinity: c, variant: v });
        const decoded = decodeAllele(encoded);
        expect(decoded.classAffinity).toBe(c);
        expect(decoded.variant).toBe(v);
      }
    }
  });
});

describe('encodeAllele', () => {
  test('packs class affinity into high nibble', () => {
    expect(encodeAllele({ classAffinity: 5, variant: 0 })).toBe(0x50);
  });

  test('packs variant into low nibble', () => {
    expect(encodeAllele({ classAffinity: 0, variant: 12 })).toBe(0x0c);
  });

  test('combined packing', () => {
    expect(encodeAllele({ classAffinity: 7, variant: 11 })).toBe(0x7b);
  });
});

// ──────────── decodeClass ────────────

describe('decodeClass', () => {
  test('decodes all 10 classes from hand-crafted DNA', () => {
    for (let c = 0; c < 10; c++) {
      const dna = BigInt(c) << CLASS_SHIFT;
      expect(decodeClass(dna)).toBe(c);
    }
  });

  test('class field is isolated from other bits', () => {
    // Set class to 3, fill other bits with 1s in non-class region
    const dna = (3n << CLASS_SHIFT) | ((1n << 252n) - 1n);
    expect(decodeClass(dna)).toBe(3);
  });

  test('returns Bulwark (0) for zero DNA', () => {
    expect(decodeClass(0n)).toBe(LobsterClass.Bulwark);
  });

  test('returns Ember (9) for class=9', () => {
    const dna = 9n << CLASS_SHIFT;
    expect(decodeClass(dna)).toBe(LobsterClass.Ember);
  });
});

// ──────────── decodeLegend ────────────

describe('decodeLegend', () => {
  test('returns Normal (0) when legend bits are 0', () => {
    const dna = 0n;
    expect(decodeLegend(dna)).toBe(LegendStatus.Normal);
  });

  test('returns Legend (1) when legend bits are 1', () => {
    const dna = 1n << LEGEND_SHIFT;
    expect(decodeLegend(dna)).toBe(LegendStatus.Legend);
  });

  test('returns 2 for reserved legend value', () => {
    const dna = 2n << LEGEND_SHIFT;
    expect(decodeLegend(dna)).toBe(2);
  });

  test('returns 3 for reserved legend value', () => {
    const dna = 3n << LEGEND_SHIFT;
    expect(decodeLegend(dna)).toBe(3);
  });

  test('isolates legend bits from class bits', () => {
    // class=4 (Specter), legend=1
    const dna = (4n << CLASS_SHIFT) | (1n << LEGEND_SHIFT);
    expect(decodeLegend(dna)).toBe(LegendStatus.Legend);
    expect(decodeClass(dna)).toBe(LobsterClass.Specter);
  });
});

// ──────────── decodeBreedType ────────────

describe('decodeBreedType', () => {
  test('returns 0 for zero DNA', () => {
    expect(decodeBreedType(0n)).toBe(0);
  });

  test('decodes breed type 63 (max)', () => {
    const dna = 63n << BREED_TYPE_SHIFT;
    expect(decodeBreedType(dna)).toBe(63);
  });

  test('decodes breed type 42', () => {
    const dna = 42n << BREED_TYPE_SHIFT;
    expect(decodeBreedType(dna)).toBe(42);
  });

  test('isolates breed type from class and legend', () => {
    const dna = (7n << CLASS_SHIFT) | (1n << LEGEND_SHIFT) | (33n << BREED_TYPE_SHIFT);
    expect(decodeBreedType(dna)).toBe(33);
    expect(decodeClass(dna)).toBe(7);
    expect(decodeLegend(dna)).toBe(1);
  });
});

// ──────────── decodeBodyPart ────────────

describe('decodeBodyPart', () => {
  test('decodes all 6 body part slots from an encoded DNA', () => {
    // Build a DNA where each part's dominant has class affinity = slot index, variant = slot index
    const alleles: number[] = [];
    for (let slot = 0; slot < 6; slot++) {
      alleles.push(encodeAllele({ classAffinity: slot, variant: slot }));      // D
      alleles.push(encodeAllele({ classAffinity: slot + 1 > 9 ? 0 : slot + 1, variant: 1 })); // R1
      alleles.push(encodeAllele({ classAffinity: 0, variant: 2 }));            // R2
    }
    const dna = encodeDNA(LobsterClass.Bulwark, LegendStatus.Normal, 0, alleles);

    for (let slot = 0; slot < 6; slot++) {
      const part = decodeBodyPart(dna, slot);
      expect(part.dominant.classAffinity).toBe(slot);
      expect(part.dominant.variant).toBe(slot);
      expect(part.r2.variant).toBe(2);
    }
  });

  test('validates D/R1/R2 alleles independently', () => {
    const alleles = makeUniformAlleles(3, 7);
    const dna = encodeDNA(LobsterClass.Tempest, LegendStatus.Normal, 0, alleles);

    const part = decodeBodyPart(dna, 0);
    expect(part.dominant.classAffinity).toBe(3);
    expect(part.dominant.variant).toBe(7);
    expect(part.r1.classAffinity).toBe(3);
    expect(part.r1.variant).toBe(7);
    expect(part.r2.classAffinity).toBe(3);
    expect(part.r2.variant).toBe(7);
  });

  test('throws for invalid slot -1', () => {
    const dna = encodeDNA(LobsterClass.Bulwark, LegendStatus.Normal, 0, makeUniformAlleles(0, 0));
    expect(() => decodeBodyPart(dna, -1)).toThrow('Invalid body part slot');
  });

  test('throws for invalid slot 6', () => {
    const dna = encodeDNA(LobsterClass.Bulwark, LegendStatus.Normal, 0, makeUniformAlleles(0, 0));
    expect(() => decodeBodyPart(dna, 6)).toThrow('Invalid body part slot');
  });

  test('throws for invalid slot 100', () => {
    const dna = encodeDNA(LobsterClass.Bulwark, LegendStatus.Normal, 0, makeUniformAlleles(0, 0));
    expect(() => decodeBodyPart(dna, 100)).toThrow('Invalid body part slot');
  });
});

// ──────────── calculatePurity ────────────

describe('calculatePurity', () => {
  test('returns 0 when no dominant alleles match the lobster class', () => {
    // Class is Bulwark (0), but all dominant alleles have class affinity 1 (Mantis)
    const alleles = makeUniformAlleles(1, 5);
    const dna = encodeDNA(LobsterClass.Bulwark, LegendStatus.Normal, 0, alleles);
    expect(calculatePurity(dna)).toBe(0);
  });

  test('returns 6 when all dominant alleles match the lobster class', () => {
    // Class is Tempest (3), all alleles have class affinity 3
    const alleles = makeUniformAlleles(3, 5);
    const dna = encodeDNA(LobsterClass.Tempest, LegendStatus.Normal, 0, alleles);
    expect(calculatePurity(dna)).toBe(6);
  });

  test('returns correct count for mixed purity', () => {
    // Class is Reaver (6). Make 3 dominant alleles match, 3 don't.
    const alleles: number[] = [];
    for (let slot = 0; slot < 6; slot++) {
      const matchClass = slot < 3 ? 6 : 0; // First 3 parts match, last 3 don't
      alleles.push(encodeAllele({ classAffinity: matchClass, variant: 5 })); // D
      alleles.push(encodeAllele({ classAffinity: 0, variant: 0 }));          // R1
      alleles.push(encodeAllele({ classAffinity: 0, variant: 0 }));          // R2
    }
    const dna = encodeDNA(LobsterClass.Reaver, LegendStatus.Normal, 0, alleles);
    expect(calculatePurity(dna)).toBe(3);
  });

  test('purity 1 for single match', () => {
    const alleles: number[] = [];
    for (let slot = 0; slot < 6; slot++) {
      const matchClass = slot === 0 ? 2 : 5;
      alleles.push(encodeAllele({ classAffinity: matchClass, variant: 0 }));
      alleles.push(encodeAllele({ classAffinity: 0, variant: 0 }));
      alleles.push(encodeAllele({ classAffinity: 0, variant: 0 }));
    }
    const dna = encodeDNA(LobsterClass.Leviathan, LegendStatus.Normal, 0, alleles);
    expect(calculatePurity(dna)).toBe(1);
  });

  test('only dominant allele matters for purity, not R1/R2', () => {
    // Class is Ember (9). Dominant alleles are class 0 (no match), but R1/R2 are class 9
    const alleles: number[] = [];
    for (let slot = 0; slot < 6; slot++) {
      alleles.push(encodeAllele({ classAffinity: 0, variant: 0 })); // D (no match)
      alleles.push(encodeAllele({ classAffinity: 9, variant: 0 })); // R1 (match, but ignored)
      alleles.push(encodeAllele({ classAffinity: 9, variant: 0 })); // R2 (match, but ignored)
    }
    const dna = encodeDNA(LobsterClass.Ember, LegendStatus.Normal, 0, alleles);
    expect(calculatePurity(dna)).toBe(0);
  });
});

// ──────────── encodeDNA / decodeDNA round-trip ────────────

describe('encodeDNA / decodeDNA round-trip', () => {
  test('encodes and decodes class correctly', () => {
    for (let c = 0; c < 10; c++) {
      const alleles = makeUniformAlleles(c, 5);
      const dna = encodeDNA(c as LobsterClass, LegendStatus.Normal, 0, alleles);
      const decoded = decodeDNA(dna);
      expect(decoded.class).toBe(c);
    }
  });

  test('encodes and decodes legend status correctly', () => {
    const alleles = makeUniformAlleles(0, 0);
    const normalDna = encodeDNA(LobsterClass.Bulwark, LegendStatus.Normal, 0, alleles);
    const legendDna = encodeDNA(LobsterClass.Bulwark, LegendStatus.Legend, 0, alleles);

    expect(decodeDNA(normalDna).legend).toBe(LegendStatus.Normal);
    expect(decodeDNA(legendDna).legend).toBe(LegendStatus.Legend);
  });

  test('encodes and decodes breed type correctly', () => {
    const alleles = makeUniformAlleles(0, 0);
    for (const bt of [0, 1, 31, 63]) {
      const dna = encodeDNA(LobsterClass.Bulwark, LegendStatus.Normal, bt, alleles);
      expect(decodeDNA(dna).breedType).toBe(bt);
    }
  });

  test('full round-trip preserves all fields', () => {
    const alleles: number[] = [];
    for (let slot = 0; slot < 6; slot++) {
      alleles.push(encodeAllele({ classAffinity: (slot * 2) % 10, variant: slot }));
      alleles.push(encodeAllele({ classAffinity: (slot * 2 + 1) % 10, variant: slot + 6 }));
      alleles.push(encodeAllele({ classAffinity: (slot * 3) % 10, variant: 15 - slot }));
    }

    const dna = encodeDNA(LobsterClass.Kraken, LegendStatus.Legend, 42, alleles);
    const decoded = decodeDNA(dna);

    expect(decoded.class).toBe(LobsterClass.Kraken);
    expect(decoded.legend).toBe(LegendStatus.Legend);
    expect(decoded.breedType).toBe(42);
    expect(decoded.bodyParts).toHaveLength(6);

    // Verify each body part's alleles
    for (let slot = 0; slot < 6; slot++) {
      const part = decoded.bodyParts[slot];
      expect(part.dominant.classAffinity).toBe((slot * 2) % 10);
      expect(part.dominant.variant).toBe(slot);
      expect(part.r1.classAffinity).toBe((slot * 2 + 1) % 10);
      expect(part.r1.variant).toBe(slot + 6);
      expect(part.r2.classAffinity).toBe((slot * 3) % 10);
      expect(part.r2.variant).toBe(15 - slot);
    }
  });

  test('purity is computed correctly in decoded result', () => {
    // Class Mantis (1), all dominants have affinity 1
    const alleles = makeMixedAlleles(1, 5, 3);
    const dna = encodeDNA(LobsterClass.Mantis, LegendStatus.Normal, 0, alleles);
    const decoded = decodeDNA(dna);
    expect(decoded.purity).toBe(6);
  });

  test('decodeDNA returns 6 body parts', () => {
    const alleles = makeUniformAlleles(0, 0);
    const dna = encodeDNA(LobsterClass.Bulwark, LegendStatus.Normal, 0, alleles);
    const decoded = decodeDNA(dna);
    expect(decoded.bodyParts).toHaveLength(NUM_BODY_PARTS);
  });
});

// ──────────── encodeDNA validation ────────────

describe('encodeDNA validation', () => {
  test('rejects class >= 10', () => {
    const alleles = makeUniformAlleles(0, 0);
    expect(() => encodeDNA(10 as LobsterClass, LegendStatus.Normal, 0, alleles)).toThrow('Invalid class');
  });

  test('rejects legend > 3', () => {
    const alleles = makeUniformAlleles(0, 0);
    expect(() => encodeDNA(LobsterClass.Bulwark, 4 as LegendStatus, 0, alleles)).toThrow('Invalid legend');
  });

  test('rejects breedType > 63', () => {
    const alleles = makeUniformAlleles(0, 0);
    expect(() => encodeDNA(LobsterClass.Bulwark, LegendStatus.Normal, 64, alleles)).toThrow('Invalid breed type');
  });

  test('rejects wrong allele count (too few)', () => {
    expect(() => encodeDNA(LobsterClass.Bulwark, LegendStatus.Normal, 0, [0, 0, 0])).toThrow('Expected 18 alleles');
  });

  test('rejects wrong allele count (too many)', () => {
    const alleles = Array(20).fill(0);
    expect(() => encodeDNA(LobsterClass.Bulwark, LegendStatus.Normal, 0, alleles)).toThrow('Expected 18 alleles');
  });

  test('rejects allele with class affinity >= 10', () => {
    const alleles = makeUniformAlleles(0, 0);
    alleles[0] = encodeAllele({ classAffinity: 10, variant: 0 }); // 0xA0
    expect(() => encodeDNA(LobsterClass.Bulwark, LegendStatus.Normal, 0, alleles)).toThrow('Invalid class affinity');
  });

  test('rejects allele with class affinity = 15', () => {
    const alleles = makeUniformAlleles(0, 0);
    alleles[5] = encodeAllele({ classAffinity: 15, variant: 0 }); // 0xF0
    expect(() => encodeDNA(LobsterClass.Bulwark, LegendStatus.Normal, 0, alleles)).toThrow('Invalid class affinity');
  });
});

// ──────────── isValidDNA ────────────

describe('isValidDNA', () => {
  test('returns true for valid DNA', () => {
    const alleles = makeUniformAlleles(5, 10);
    const dna = encodeDNA(LobsterClass.Specter, LegendStatus.Normal, 20, alleles);
    expect(isValidDNA(dna)).toBe(true);
  });

  test('returns true for legend DNA', () => {
    const alleles = makeUniformAlleles(0, 0);
    const dna = encodeDNA(LobsterClass.Bulwark, LegendStatus.Legend, 0, alleles);
    expect(isValidDNA(dna)).toBe(true);
  });

  test('returns false for class = 15 (invalid)', () => {
    // Manually construct DNA with class = 15 (0xF in bits 255:252)
    const dna = 15n << CLASS_SHIFT;
    expect(isValidDNA(dna)).toBe(false);
  });

  test('returns false for class = 10 (just out of range)', () => {
    const dna = 10n << CLASS_SHIFT;
    expect(isValidDNA(dna)).toBe(false);
  });

  test('returns false when an allele has class affinity = 15', () => {
    // Start with valid DNA, then set one allele to have affinity 15
    const alleles = makeUniformAlleles(0, 0);
    let dna = encodeDNA(LobsterClass.Bulwark, LegendStatus.Normal, 0, alleles);
    // Manually set the first allele's high nibble to 0xF (affinity 15)
    // First allele is at bit position 232 (high 8 bits of body parts region)
    const shift = 232n;
    // Clear the first allele byte
    dna = dna & ~(0xFFn << shift);
    // Set it to 0xF0 (affinity 15, variant 0)
    dna = dna | (0xF0n << shift);
    expect(isValidDNA(dna)).toBe(false);
  });

  test('returns true for zero DNA (class=0 is valid, all alleles are 0)', () => {
    // DNA = 0 means class=0 (Bulwark), legend=0, all alleles have affinity=0, variant=0
    expect(isValidDNA(0n)).toBe(true);
  });
});
