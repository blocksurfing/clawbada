/**
 * TypeScript port of BreedingLab.sol _generateOffspringDNA.
 *
 * Given two parent DNAs + VRF seed, produces deterministic offspring DNA.
 * Salt strings match Solidity exactly for cross-validation.
 *
 * Gene inheritance flow:
 *   1. Class: 50/50 from either parent (VRF)
 *   2. Legend: 0.3% chance (3/1000) independent roll
 *   3. Breed type: random 0-63
 *   4. Per body part: select alleles from parents, order by class-match priority
 */

import { NUM_BODY_PARTS, LEGEND_CHANCE_BPS } from './constants';
import { decodeAllele, decodeBodyPart, encodeAllele, encodeDNA, decodeClass } from './dna';
import type { Allele } from './types';
import { LegendStatus, LobsterClass } from './types';
import { keccak256Packed } from './hash';

// ──────────── Top-level DNA generation ────────────

/**
 * Generate offspring DNA from two parents and a VRF seed.
 *
 * Matches BreedingLab.sol `_generateOffspringDNA` exactly.
 *
 * @param parentADna Parent A's packed uint256 DNA
 * @param parentBDna Parent B's packed uint256 DNA
 * @param vrfSeed VRF-derived random seed
 * @returns Offspring's packed uint256 DNA
 */
export function generateOffspringDNA(parentADna: bigint, parentBDna: bigint, vrfSeed: bigint): bigint {
  // Determine offspring class (50/50 from either parent)
  const classA = decodeClass(parentADna);
  const classB = decodeClass(parentBDna);
  const offspringClass = rollClass(classA, classB, vrfSeed);

  // Legend roll: 0.3% chance
  const legend = rollLegend(vrfSeed) ? LegendStatus.Legend : LegendStatus.Normal;

  // Breed type: random 0-63
  const breedType = Number(keccak256Packed(vrfSeed, 'breedtype') % 64n);

  // Inherit body parts
  const alleles: number[] = [];
  for (let slot = 0; slot < NUM_BODY_PARTS; slot++) {
    const partSeed = keccak256Packed(vrfSeed, 'part', slot);
    const [d, r1, r2] = inheritBodyPart(parentADna, parentBDna, slot, offspringClass, partSeed);
    alleles.push(encodeAllele(d), encodeAllele(r1), encodeAllele(r2));
  }

  return encodeDNA(offspringClass, legend, breedType, alleles);
}

// ──────────── Class & Legend rolls ────────────

/**
 * Roll offspring class: 50/50 from either parent.
 * Same-class parents = guaranteed class.
 *
 * Matches: `(keccak256(abi.encodePacked(seed, "class")) % 2 == 0) ? classA : classB`
 */
export function rollClass(classA: LobsterClass, classB: LobsterClass, seed: bigint): LobsterClass {
  if (classA === classB) return classA;
  const rand = keccak256Packed(seed, 'class');
  return (rand % 2n === 0n) ? classA : classB;
}

/**
 * Roll legend status: 0.3% chance (3/1000).
 *
 * Matches: `keccak256(abi.encodePacked(seed, "legend")) % 1000 < 3`
 */
export function rollLegend(seed: bigint): boolean {
  const rand = keccak256Packed(seed, 'legend');
  return (rand % 1000n) < 3n;
}

// ──────────── Per-body-part inheritance ────────────

/**
 * Inherit one body part from two parents: select 3 alleles, then order by class-match priority.
 *
 * Matches BreedingLab.sol `_inheritBodyPart`.
 *
 * @returns [dominant, r1, r2] ordered alleles
 */
export function inheritBodyPart(
  dnaA: bigint,
  dnaB: bigint,
  slot: number,
  offspringClass: LobsterClass,
  seed: bigint,
): [Allele, Allele, Allele] {
  const selected = selectAlleles(dnaA, dnaB, slot, seed);
  return orderAlleles(selected, offspringClass);
}

// ──────────── Allele selection ────────────

/**
 * Select 3 alleles: one from each parent + one secondary draw from a VRF-chosen parent.
 *
 * Matches BreedingLab.sol `_selectAlleles`.
 */
function selectAlleles(dnaA: bigint, dnaB: bigint, slot: number, seed: bigint): [Allele, Allele, Allele] {
  const partA = decodeBodyPart(dnaA, slot);
  const partB = decodeBodyPart(dnaB, slot);

  const allelesA: Allele[] = [partA.dominant, partA.r1, partA.r2];
  const allelesB: Allele[] = [partB.dominant, partB.r1, partB.r2];

  // Step 1: Select 1 allele from each parent (50% D / 33% R1 / 17% R2)
  const idxA = selectIndex(keccak256Packed(seed, 'selA'));
  const idxB = selectIndex(keccak256Packed(seed, 'selB'));

  const selected0 = allelesA[idxA];
  const selected1 = allelesB[idxB];

  // Step 2: Third allele — VRF picks one parent, draw from their 2 remaining alleles
  const pickRand = keccak256Packed(seed, 'pick');
  const thirdParentRand = keccak256Packed(seed, 'third');
  let selected2: Allele;

  if (thirdParentRand % 2n === 0n) {
    // Pick from parent A's remaining
    selected2 = pickRemaining(allelesA, idxA, pickRand);
  } else {
    // Pick from parent B's remaining
    selected2 = pickRemaining(allelesB, idxB, pickRand);
  }

  return [selected0, selected1, selected2];
}

/**
 * Map a random value to index 0/1/2 with 50%/33%/17% distribution.
 *
 * Matches BreedingLab.sol `_selectIndex`: `rand % 100` → 0-49=D(50%), 50-82=R1(33%), 83-99=R2(17%).
 */
function selectIndex(rand: bigint): number {
  const r = Number(rand % 100n);
  if (r < 50) return 0;
  if (r < 83) return 1;
  return 2;
}

/**
 * Pick one of the 2 remaining alleles (excluding the one at excludeIdx) with equal probability.
 *
 * Matches BreedingLab.sol `_pickRemaining`.
 */
function pickRemaining(alleles: Allele[], excludeIdx: number, rand: bigint): Allele {
  let first: Allele;
  let second: Allele;

  if (excludeIdx === 0) {
    first = alleles[1];
    second = alleles[2];
  } else if (excludeIdx === 1) {
    first = alleles[0];
    second = alleles[2];
  } else {
    first = alleles[0];
    second = alleles[1];
  }

  return (rand % 2n === 0n) ? first : second;
}

// ──────────── Allele ordering ────────────

/**
 * Order 3 alleles by priority: class-match first, then variant value tiebreak.
 * Returns [dominant, r1, r2] in descending priority.
 *
 * Matches BreedingLab.sol `_orderAlleles`.
 */
export function orderAlleles(alleles: [Allele, Allele, Allele], offspringClass: LobsterClass): [Allele, Allele, Allele] {
  const indexed = alleles.map((a, i) => ({
    allele: a,
    priority: allelePriority(a, offspringClass),
  }));

  // Bubble sort (3 elements, at most 3 comparisons) — matches Solidity exactly
  if (indexed[0].priority < indexed[1].priority) {
    [indexed[0], indexed[1]] = [indexed[1], indexed[0]];
  }
  if (indexed[1].priority < indexed[2].priority) {
    [indexed[1], indexed[2]] = [indexed[2], indexed[1]];
  }
  if (indexed[0].priority < indexed[1].priority) {
    [indexed[0], indexed[1]] = [indexed[1], indexed[0]];
  }

  return [indexed[0].allele, indexed[1].allele, indexed[2].allele];
}

/**
 * Priority = (affinity matches class ? 1 : 0) × 256 + variant.
 *
 * Matches BreedingLab.sol `_allelePriority`.
 */
function allelePriority(allele: Allele, offspringClass: LobsterClass): number {
  const matchBonus = allele.classAffinity === offspringClass ? 256 : 0;
  return matchBonus + allele.variant;
}
