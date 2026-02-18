/**
 * Deterministic RNG wrapping @clawbada/game-logic hash functions.
 * All randomness in asset generation derives from DNA-based seeds.
 */

import { keccak256Packed, deriveRandom, randomInRange } from '@clawbada/game-logic';
import { VARIANT_SALT } from '../constants';

/**
 * Derive a deterministic seed for a body part variant.
 *
 * seed = keccak256Packed(classAffinity, bodyPart, variant, "assetgen-v1")
 */
export function variantSeed(classAffinity: number, bodyPart: number, variant: number): bigint {
  return keccak256Packed(classAffinity, bodyPart, variant, VARIANT_SALT);
}

/**
 * Derive a sub-seed from a parent seed + salt string.
 * Used for per-mutation-step randomness within a variant.
 */
export function subSeed(seed: bigint, salt: string): bigint {
  return deriveRandom(seed, salt);
}

/**
 * Get a random integer in [min, max] (inclusive) from seed + salt.
 */
export function randInt(seed: bigint, salt: string, min: number, max: number): number {
  return Number(randomInRange(seed, salt, BigInt(min), BigInt(max)));
}

/**
 * Get a random boolean with given probability (numerator/denominator).
 */
export function randBool(seed: bigint, salt: string, chance: number, outOf: number): boolean {
  const rand = deriveRandom(seed, salt);
  return Number(rand % BigInt(outOf)) < chance;
}

/**
 * Pick a random element from an array.
 */
export function randPick<T>(seed: bigint, salt: string, items: readonly T[]): T {
  const idx = randInt(seed, salt, 0, items.length - 1);
  return items[idx];
}

/**
 * Shuffle an array deterministically (Fisher-Yates with seeded RNG).
 * Returns a new array.
 */
export function randShuffle<T>(seed: bigint, salt: string, items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(seed, `${salt}_shuf_${i}`, 0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
