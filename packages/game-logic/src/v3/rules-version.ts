/**
 * Rules version (audit 2026-09, D-27).
 *
 * A battle's two on-chain commitments prove that a log is internally consistent UNDER SOME
 * RULES. Which rules was never recorded: the per-turn state hash covers the tunable
 * `BattleRules` object, but base class stats, the damage formulas, the crit curve, the speed
 * clamps, stun immunity and the HP scale live in code, and the project tunes them from
 * telemetry without redeploying anything. So after a balance patch an honest log stopped
 * replaying at turn 1, the admin judging a dispute (a High-stake window is an hour, the SLA a
 * day) could not tell that from a fabricated log without guessing a git commit — and a
 * dishonest operator could pick whichever historical constants made their log verify.
 *
 * `RULES_VERSION` is a hash of everything that decides an outcome. It is written into the
 * state at `createBattle`, stored on the session row, and folded into `turnLogHash`, so the
 * commitment on-chain names the rules it was played under. Replay under different rules is
 * refused with a message that says so, instead of failing mysteriously at turn 1.
 *
 * How it is built: constants are listed directly, and every FORMULA is sampled on a fixed
 * grid of inputs ("golden vectors"). A changed constant or a changed formula moves at least
 * one number, and the version with it — without anyone remembering to bump anything.
 * `ENGINE_VERSION` is the manual escape hatch for a logic change (turn order, targeting,
 * status handling) that no sampled number would notice: bump it when you make one.
 *
 * Keeping old rules replayable: tag every release that changes RULES_VERSION as
 * `engine-rules-<first 12 hex chars>`; to judge an old battle, check out the tag whose hash
 * matches `battle_sessions.rules_version`.
 */
import { keccak256Packed } from '../hash';
import { DEFEND_COUNTER_BASE, HP_BATTLE_SCALE, MULT_DENOM, SPECIAL_BASE_POWERS } from '../constants';
import {
  calculateAttackDamage,
  calculateDefendCounter,
  calculateSpecialDamage,
  critChance,
  enhancedProcChance,
  getBaseStats,
  getClassAdvantage,
  scaleStats,
} from '../battle-resolver';
import * as V3 from './constants';

/** Bump for a LOGIC change the sampled numbers below cannot see. */
export const ENGINE_VERSION = 'v3.1';

const CLASSES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const TIERS = [0, 1, 2, 3] as const;

/** JSON with bigints as strings and object keys sorted, so the hash is order-stable. */
function canonical(value: unknown): unknown {
  if (typeof value === 'bigint') return `${value}n`;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) out[key] = canonical((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/** Everything that decides a battle's outcome, as one canonical JSON string. */
export function rulesManifest(): string {
  const stats: Record<string, unknown> = {};
  for (const c of CLASSES) {
    for (const t of TIERS) {
      for (const legend of [false, true]) stats[`${c}:${t}:${legend ? 'L' : 'n'}`] = scaleStats(getBaseStats(c as never), t as never, legend);
    }
  }
  const classAdvantage: Record<string, unknown> = {};
  for (const a of CLASSES) for (const d of CLASSES) classAdvantage[`${a}>${d}`] = getClassAdvantage(a as never, d as never);

  // Golden vectors: a fixed grid through every formula. Inputs are arbitrary but frozen.
  const pairs: Array<[bigint, bigint]> = [[70n, 120n], [100n, 100n], [140n, 60n], [130n, 70n], [400n, 100n]];
  const mults = [800n, 1000n, 1250n];
  const rolls = [850n, 1000n, 1150n];
  const formulas: unknown[] = [];
  for (const [atk, armor] of pairs) {
    for (const m of mults) {
      for (const r of rolls) {
        formulas.push([
          calculateAttackDamage(atk, armor, m, false, r),
          calculateAttackDamage(atk, armor, m, true, r),
          calculateDefendCounter(atk, armor, m, r),
          calculateSpecialDamage(150n, atk, armor, m, 0, r),
          calculateSpecialDamage(150n, atk, armor, m, 6, r),
        ]);
      }
    }
  }

  const manifest = {
    engine: ENGINE_VERSION,
    v3: { ...V3 },
    shared: { DEFEND_COUNTER_BASE, HP_BATTLE_SCALE, MULT_DENOM, SPECIAL_BASE_POWERS },
    stats,
    classAdvantage,
    crit: [0n, 50n, 80n, 100n, 130n, 200n, 400n].map((x) => critChance(x)),
    enhanced: [0, 1, 2, 3, 4, 5, 6].map((p) => enhancedProcChance(p)),
    formulas,
  };
  return JSON.stringify(canonical(manifest));
}

/** keccak256 of the manifest, 0x-prefixed. Computed once per process. */
export const RULES_VERSION: string = '0x' + keccak256Packed(rulesManifest()).toString(16).padStart(64, '0');

/** Marker for state persisted before rules versions existed. */
export const UNVERSIONED_RULES = 'unversioned';
