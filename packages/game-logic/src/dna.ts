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
