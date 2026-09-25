/**
 * TypeScript port of DNALib.sol — lobster DNA encoding/decoding.
 *
 * Bit layout (256 bits, high to low):
 *   [255:252] Class         (4 bits, 0-9)
 *   [251:250] Legend        (2 bits, 0-3)
 *   [249:244] Breed type    (6 bits, 0-63)
 *   [243:240] Reserved      (4 bits)
 *   [239:96]  6 body parts  (144 bits = 6 parts × 3 alleles × 8 bits)
 *   [95:0]    Reserved      (96 bits)
 */

import {
  ALLELE_BITS,
  ALLELE_MASK,
  BREED_TYPE_MASK,
  BREED_TYPE_SHIFT,
  CLASS_MASK,
  CLASS_SHIFT,
  LEGEND_MASK,
  LEGEND_SHIFT,
  ALLELES_PER_PART,
  NUM_BODY_PARTS,
  NUM_CLASSES,
  TOTAL_ALLELES,
} from './constants';
import type { Allele, BodyPartGenes, DecodedDNA } from './types';
import { LegendStatus, LobsterClass } from './types';

/** Extract a single allele byte at index 0-17 from the body parts region. */
function extractAllele(dna: bigint, index: number): number {
  const shift = 232n - BigInt(index) * ALLELE_BITS;
  return Number((dna >> shift) & ALLELE_MASK);
}

/** Split an allele byte into class affinity (high nibble) and variant (low nibble). */
export function decodeAllele(alleleByte: number): Allele {
  return {
    classAffinity: (alleleByte >> 4) & 0xf,
    variant: alleleByte & 0xf,
  };
}

/** Encode an allele into a single byte. */
export function encodeAllele(allele: Allele): number {
  return ((allele.classAffinity & 0xf) << 4) | (allele.variant & 0xf);
}

/** Extract the class field (bits 255:252). */
export function decodeClass(dna: bigint): LobsterClass {
  return Number((dna >> CLASS_SHIFT) & CLASS_MASK) as LobsterClass;
}

/** Extract the legend field (bits 251:250). */
export function decodeLegend(dna: bigint): LegendStatus {
  return Number((dna >> LEGEND_SHIFT) & LEGEND_MASK) as LegendStatus;
}

/** Extract the breed type field (bits 249:244). */
export function decodeBreedType(dna: bigint): number {
  return Number((dna >> BREED_TYPE_SHIFT) & BREED_TYPE_MASK);
}

/** Extract the 3 alleles for a body part slot (0-5). */
export function decodeBodyPart(dna: bigint, slot: number): BodyPartGenes {
  if (slot < 0 || slot >= NUM_BODY_PARTS) {
    throw new Error(`Invalid body part slot: ${slot}`);
  }

  const baseIndex = slot * 3;
  return {
    dominant: decodeAllele(extractAllele(dna, baseIndex)),
    r1: decodeAllele(extractAllele(dna, baseIndex + 1)),
    r2: decodeAllele(extractAllele(dna, baseIndex + 2)),
  };
}

/** Calculate purity: count of body parts where dominant allele's class affinity matches the lobster's class. */
export function calculatePurity(dna: bigint): number {
  const lobsterClass = decodeClass(dna);
  let purity = 0;

  for (let slot = 0; slot < NUM_BODY_PARTS; slot++) {
    const part = decodeBodyPart(dna, slot);
    if (part.dominant.classAffinity === lobsterClass) {
      purity++;
    }
  }

  return purity;
}

/** Fully decode a DNA uint256 into all components. */
export function decodeDNA(dna: bigint): DecodedDNA {
  const lobsterClass = decodeClass(dna);
  const legend = decodeLegend(dna);
  const breedType = decodeBreedType(dna);

  const bodyParts: BodyPartGenes[] = [];
  for (let slot = 0; slot < NUM_BODY_PARTS; slot++) {
    bodyParts.push(decodeBodyPart(dna, slot));
  }

  return {
    class: lobsterClass,
    legend,
    breedType,
    bodyParts,
    purity: calculatePurity(dna),
  };
}

/**
 * Encode all components into a packed uint256 DNA value.
 *
 * @param class_ Lobster class (0-9)
 * @param legend Legend status (0-3)
 * @param breedType Visual subtype (0-63)
 * @param alleles 18 allele bytes: [slot0_D, slot0_R1, slot0_R2, ..., slot5_D, slot5_R1, slot5_R2]
 */
export function encodeDNA(
  class_: LobsterClass,
  legend: LegendStatus,
  breedType: number,
  alleles: number[],
): bigint {
  if (class_ >= NUM_CLASSES) throw new Error(`Invalid class: ${class_}`);
  if (legend > 3) throw new Error(`Invalid legend: ${legend}`);
  if (breedType > 63) throw new Error(`Invalid breed type: ${breedType}`);
  if (alleles.length !== TOTAL_ALLELES) throw new Error(`Expected ${TOTAL_ALLELES} alleles, got ${alleles.length}`);

  let dna = BigInt(class_) << CLASS_SHIFT;
  dna |= BigInt(legend) << LEGEND_SHIFT;
  dna |= BigInt(breedType) << BREED_TYPE_SHIFT;

  for (let i = 0; i < TOTAL_ALLELES; i++) {
    const allele = alleles[i];
    const affinity = allele >> 4;
    if (affinity >= NUM_CLASSES) throw new Error(`Invalid class affinity ${affinity} at allele index ${i}`);

    const shift = 232n - BigInt(i) * ALLELE_BITS;
    dna |= BigInt(allele) << shift;
  }

  return dna;
}

/** Validate that DNA has a valid class, legend, and all allele class affinities in range. */
/**
 * Random genetics for a lobster of a given class: random breed type, and every one of
 * the 18 alleles drawn uniformly (class affinity 0–9, variant 0–15). Purity therefore
 * follows the faucet-like distribution (~0.6 matching dominants on average) rather than a
 * chosen value — read it back with calculatePurity. `rng` returns [0, 1); pass a seeded
 * generator for reproducible rosters (practice bots).
 */
export function randomDNA(class_: LobsterClass, rng: () => number = Math.random): bigint {
  const u = (n: number) => Math.min(n - 1, Math.floor(rng() * n));
  const alleles: number[] = [];
  for (let i = 0; i < TOTAL_ALLELES; i++) alleles.push(encodeAllele({ classAffinity: u(NUM_CLASSES), variant: u(16) }));
  return encodeDNA(class_, LegendStatus.Normal, u(64), alleles);
}

/**
 * Random genetics with a CHOSEN purity — the dojo's "pick your lobster" knob.
 *
 * `randomDNA` draws every allele at random, which lands near the faucet average (~0.6
 * matching dominants) and cannot be asked for a particular value. Purity is not a separate
 * field: it is COUNTED from the dominant alleles (see calculatePurity), so the only way to
 * have a lobster of purity N is to build DNA whose dominants match in exactly N slots.
 *
 * Doing it in the genes rather than overriding a number keeps the lobster honest — the body
 * parts a pure lobster is drawn with are its own class's, which is the point of showing one.
 *
 * `targetPurity` is 0-6; recessives stay random, as does everything else.
 */
export function randomDNAWithPurity(class_: LobsterClass, targetPurity: number, rng: () => number = Math.random): bigint {
  if (!Number.isInteger(targetPurity) || targetPurity < 0 || targetPurity > NUM_BODY_PARTS) {
    throw new Error(`targetPurity must be an integer 0-${NUM_BODY_PARTS}, got ${targetPurity}`);
  }
  const u = (n: number) => Math.min(n - 1, Math.floor(rng() * n));
  // Which slots match is itself random, so two pure-3 lobsters of a class differ.
  const slots = [...Array(NUM_BODY_PARTS).keys()];
  for (let i = slots.length - 1; i > 0; i--) {
    const j = u(i + 1);
    [slots[i], slots[j]] = [slots[j]!, slots[i]!];
  }
  const matching = new Set(slots.slice(0, targetPurity));

  const alleles: number[] = [];
  for (let i = 0; i < TOTAL_ALLELES; i++) {
    const slot = Math.floor(i / ALLELES_PER_PART);
    const isDominant = i % ALLELES_PER_PART === 0;
    let affinity = u(NUM_CLASSES);
    if (isDominant) {
      if (matching.has(slot)) affinity = class_;
      // A non-matching dominant must be a DIFFERENT class, or the purity overshoots.
      else if (affinity === class_) affinity = (class_ + 1 + u(NUM_CLASSES - 1)) % NUM_CLASSES;
    }
    alleles.push(encodeAllele({ classAffinity: affinity, variant: u(16) }));
  }
  return encodeDNA(class_, LegendStatus.Normal, u(64), alleles);
}

export function isValidDNA(dna: bigint): boolean {
  const class_ = Number((dna >> CLASS_SHIFT) & CLASS_MASK);
  if (class_ >= NUM_CLASSES) return false;

  const legend = Number((dna >> LEGEND_SHIFT) & LEGEND_MASK);
  if (legend > 3) return false;

  for (let i = 0; i < TOTAL_ALLELES; i++) {
    const allele = extractAllele(dna, i);
    const affinity = allele >> 4;
    if (affinity >= NUM_CLASSES) return false;
  }

  return true;
}
