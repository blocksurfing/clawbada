/**
 * D-E (owner decision 2026-10-03): battle stakes as a DAMPED LIVE PEG on the mining rate.
 *
 * Mirrors `BattleArena.stakeFor` exactly (integer maths, same rounding):
 *
 *   stake = multiplier[bracket] × (GENESIS × fixedBps + reference × (10,000 − fixedBps)) / 10,000
 *           (one division), then floored to a whole GOLD
 *
 * where `reference` is MiningPool's `stakeReference` (the base reward sampled once per
 * season-day), falling back to the live base reward and then to GENESIS when the chain has no
 * rate, and capped at GENESIS so a stake never exceeds its launch value.
 *
 * This is a QUOTE helper (UI previews, models, tests). The amount a battle binds is whatever the
 * contract computed at `createBattle`; read it from the chain or the `BattleCreated` event.
 */
import { GENESIS_BASE_REWARD_WEI, STAKE_FIXED_BPS_DEFAULT, STAKE_MULTIPLIERS } from './constants';

const BPS = 10_000n;
const ONE_CLAW = 10n ** 18n;

export type StakeBracket = 0 | 1 | 2;

/** The reference the peg uses, after the contract's fallbacks and cap (in wei). */
export function stakeReferenceWei(stakeReferenceWei_: bigint, liveBaseRewardWei = 0n): bigint {
  let ref = stakeReferenceWei_;
  if (ref === 0n) ref = liveBaseRewardWei;
  if (ref === 0n || ref > GENESIS_BASE_REWARD_WEI) ref = GENESIS_BASE_REWARD_WEI;
  return ref;
}

/** The stake a battle created now in `bracket` would bind, in GOLD wei. */
export function stakeFor(
  bracket: StakeBracket | number,
  referenceWei: bigint,
  fixedBps: bigint = STAKE_FIXED_BPS_DEFAULT,
  liveBaseRewardWei = 0n,
): bigint {
  if (!Number.isInteger(bracket) || bracket < 0 || bracket >= STAKE_MULTIPLIERS.length) {
    throw new Error(`Invalid stake bracket index: ${bracket} (expected 0..${STAKE_MULTIPLIERS.length - 1})`);
  }
  if (fixedBps < 0n || fixedBps > BPS) throw new Error(`Invalid stake fixed share: ${fixedBps} bps`);
  const ref = stakeReferenceWei(referenceWei, liveBaseRewardWei);
  // One division, as in the contract (slither: no multiply on a divided value), then the floor.
  const stake = (STAKE_MULTIPLIERS[bracket] * (GENESIS_BASE_REWARD_WEI * fixedBps + ref * (BPS - fixedBps))) / BPS;
  return stake - (stake % ONE_CLAW);
}

/** All three bracket stakes for one reference, in GOLD wei. */
export function stakesFor(referenceWei: bigint, fixedBps: bigint = STAKE_FIXED_BPS_DEFAULT, liveBaseRewardWei = 0n): [bigint, bigint, bigint] {
  return [0, 1, 2].map((b) => stakeFor(b, referenceWei, fixedBps, liveBaseRewardWei)) as [bigint, bigint, bigint];
}
