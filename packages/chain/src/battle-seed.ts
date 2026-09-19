import { keccak256, encodePacked, stringToBytes, toHex } from 'viem';

/**
 * D-01 — how a staked battle's randomness is fixed. Single source of truth for the API (which
 * plays the battle), the engine (which commits the secret on-chain and later discloses it) and
 * any dispute tooling.
 *
 *   seed = keccak256(abi.encodePacked(drandRandomness(R), seedSecret, battleId))
 *
 * - `seedSecret` is per battle, derived from one master secret both services hold. Its hash is
 *   committed on-chain inside `BattleArena.revealTeams` and the secret itself is disclosed (and
 *   checked against that commitment) in `BattleArena.settle`.
 * - `R` is the first drand round emitted at or after `revealedAt + SEED_ROUND_DELAY`, where
 *   `revealedAt` is the block timestamp of the revealTeams transaction. That round does not exist
 *   yet when the transaction is sent.
 *
 * Why both halves are needed. The raw beacon is public, so with it alone a player could look the
 * seed up and foresee every crit, variance roll and enhanced proc (the original D-01 finding: a
 * proof won 67.5% of mirror games). The secret alone would let the operator pick a favourable
 * seed after seeing both teams. Together: players cannot compute the seed during the battle, the
 * operator cannot choose it — its secret is committed before the round it is mixed with exists —
 * and after settle anyone can recompute the seed from public data and replay the log.
 *
 * Residual risk, accepted and visible on-chain: an operator that dislikes a seed can refuse to
 * settle, which refunds both players after ACTIVE_WINDOW. It cannot turn that into a win.
 */

/** Mirrors `BattleArena.SEED_ROUND_DELAY` (seconds). A drift test pins the two together. */
export const SEED_ROUND_DELAY_S = 6;

const DOMAIN = 'clawbada:battle-seed:v1';

/** Per-battle secret from the services' shared master secret. Deterministic, so a restarted
 *  process re-derives the same secret and no secret ever needs to be stored or queued. */
export function deriveSeedSecret(masterSecret: string, battleId: bigint): `0x${string}` {
  if (!masterSecret) throw new Error('battle seed: empty master secret');
  const masterKey = keccak256(stringToBytes(masterSecret));
  return keccak256(encodePacked(['bytes32', 'string', 'uint256'], [masterKey, DOMAIN, battleId]));
}

/** Must byte-for-byte match `BattleArena.sol`: keccak256(abi.encodePacked(battleId, seedSecret)). */
export function seedCommitment(battleId: bigint, seedSecret: `0x${string}`): `0x${string}` {
  return keccak256(encodePacked(['uint256', 'bytes32'], [battleId, seedSecret]));
}

/** The battle's VRF seed. `randomness` is the drand round's hex randomness (32 bytes). */
export function battleSeed(randomness: string, seedSecret: `0x${string}`, battleId: bigint): bigint {
  const r = `0x${randomness.replace(/^0x/, '').padStart(64, '0')}` as `0x${string}`;
  if (r.length !== 66) throw new Error('battle seed: drand randomness must be 32 bytes');
  return BigInt(keccak256(encodePacked(['bytes32', 'bytes32', 'uint256'], [r, seedSecret, battleId])));
}

export interface DrandChainInfo {
  /** Unix seconds at which round 1 was emitted. */
  genesisTime: number;
  /** Seconds between rounds. */
  period: number;
}

/** Emission time (unix seconds) of a round. */
export function roundTime(info: DrandChainInfo, round: number): number {
  return info.genesisTime + (round - 1) * info.period;
}

/** First round emitted at or after `timestamp`. */
export function roundAtOrAfter(info: DrandChainInfo, timestamp: number): number {
  if (timestamp <= info.genesisTime) return 1;
  return Math.ceil((timestamp - info.genesisTime) / info.period) + 1;
}

/** The round a battle revealed at `revealedAt` (block timestamp, seconds) must use. */
export function seedRoundFor(info: DrandChainInfo, revealedAt: number): number {
  return roundAtOrAfter(info, revealedAt + SEED_ROUND_DELAY_S);
}

let processEphemeral: string | null = null;

/**
 * The master secret from the environment. Production must set BATTLE_SEED_SECRET identically on
 * the API and the engine. Elsewhere a missing value falls back to a random secret so local runs
 * work — but two processes then disagree, the API refuses to start the session (its commitment
 * check fails) and the battle refunds at ACTIVE_WINDOW. Set it for any multi-process run.
 *
 * Call this LAZILY, when a staked battle actually needs the secret — never at import time. A
 * service that only runs practice battles must keep booting without it. Against `process.env`
 * the random fallback is generated once per process: the reveal and the settle of one battle
 * happen minutes apart and must open the same commitment.
 */
export function loadSeedMasterSecret(env: Record<string, string | undefined> = process.env): { secret: string; ephemeral: boolean } {
  const v = env.BATTLE_SEED_SECRET;
  if (v && v.length >= 32) return { secret: v, ephemeral: false };
  if (v) throw new Error('BATTLE_SEED_SECRET must be at least 32 characters');
  if (env.NODE_ENV === 'production') throw new Error('BATTLE_SEED_SECRET is required in production (D-01: battle randomness)');
  if (env === process.env && processEphemeral) return { secret: processEphemeral, ephemeral: true };
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = toHex(bytes);
  if (env === process.env) processEphemeral = secret;
  return { secret, ephemeral: true };
}
