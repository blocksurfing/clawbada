/**
 * Deterministic randomness matching Solidity's keccak256(abi.encodePacked(...)) pattern.
 *
 * Used by battle-sim and gene-inheritance for VRF-derived decisions.
 * All functions are pure — same inputs always produce the same outputs.
 */

import { keccak_256 } from '@noble/hashes/sha3.js';

import { VRF_MIN, VRF_SPAN } from './constants';

// ──────────── Encoding helpers ────────────

/** Encode a bigint as a big-endian 32-byte Uint8Array (matching Solidity uint256). */
function encodeBigInt(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Encode a number as a big-endian 32-byte Uint8Array (matching Solidity uint256). */
function encodeNumber(value: number): Uint8Array {
  return encodeBigInt(BigInt(value));
}

/** Encode a string as raw UTF-8 bytes (matching Solidity abi.encodePacked(string)). */
function encodeString(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/**
 * Pack arguments like Solidity's abi.encodePacked.
 *
 * - bigint → 32 bytes (big-endian uint256)
 * - number → 32 bytes (big-endian uint256)
 * - string → raw UTF-8 bytes (no padding)
 * - Uint8Array → raw bytes (no padding)
 */
function encodePacked(...args: (bigint | number | string | Uint8Array)[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const arg of args) {
    if (typeof arg === 'bigint') {
      parts.push(encodeBigInt(arg));
    } else if (typeof arg === 'number') {
      parts.push(encodeNumber(arg));
    } else if (typeof arg === 'string') {
      parts.push(encodeString(arg));
    } else {
      parts.push(arg);
    }
  }

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

// ──────────── Public API ────────────

/**
 * Compute keccak256 of packed arguments, matching Solidity's keccak256(abi.encodePacked(...)).
 *
 * @returns The hash as a bigint (uint256).
 */
export function keccak256Packed(...args: (bigint | number | string | Uint8Array)[]): bigint {
  const packed = encodePacked(...args);
  const hash = keccak_256(packed);
  let result = 0n;
  for (let i = 0; i < 32; i++) {
    result = (result << 8n) | BigInt(hash[i]);
  }
  return result;
}

/**
 * Derive a deterministic random uint256 from a seed and salt string.
 *
 * Matches: `uint256(keccak256(abi.encodePacked(seed, salt)))` in Solidity.
 */
export function deriveRandom(seed: bigint, salt: string): bigint {
  return keccak256Packed(seed, salt);
}

/**
 * Derive a uniform random bigint in [min, max] (inclusive).
 *
 * Uses modular arithmetic: `deriveRandom(seed, salt) % (max - min + 1) + min`.
 */
export function randomInRange(seed: bigint, salt: string, min: bigint, max: bigint): bigint {
  if (min > max) throw new Error(`min (${min}) > max (${max})`);
  if (min === max) return min;
  const range = max - min + 1n;
  const rand = deriveRandom(seed, salt);
  return (rand % range) + min;
}

/**
 * Probabilistic boolean: true with probability chance/outOf.
 *
 * Example: `randomBool(seed, "CRIT", 3000n, 10000n)` → true 30% of the time.
 */
export function randomBool(seed: bigint, salt: string, chance: bigint, outOf: bigint): boolean {
  if (chance >= outOf) return true;
  if (chance <= 0n) return false;
  const rand = deriveRandom(seed, salt);
  return (rand % outOf) < chance;
}

/**
 * Canonical VRF roll mapping — mirrors `BattleResolver.sol::vrfRollFromRandom`.
 * Maps a raw random value into the INCLUSIVE range [VRF_MIN, VRF_MAX] (×1000).
 *
 * F5-04: the divisor is VRF_SPAN = VRF_MAX - VRF_MIN + 1 = 301, NOT VRF_RANGE (300).
 * `% VRF_RANGE` is an off-by-one that can never emit VRF_MAX and diverges from this stream.
 */
export function vrfRollFromRandom(rand: bigint): bigint {
  return VRF_MIN + (rand % VRF_SPAN);
}

/**
 * Derive a VRF roll in the battle damage variance range [850, 1150] (×1000 scale)
 * from a seed + salt. Equivalent to `vrfRollFromRandom(deriveRandom(seed, salt))`.
 */
export function deriveVrfRoll(seed: bigint, salt: string): bigint {
  return vrfRollFromRandom(deriveRandom(seed, salt));
}
