// All constants mirrored from Solidity contracts using bigint where applicable.

// ──────────── Damage Formula (BattleResolver.sol) ────────────
export const ATTACK_BASE_POWER = 100n;
export const DEFEND_COUNTER_BASE = 30n;
export const DEFEND_REDUCTION_BPS = 5000n; // 50%
export const STAT_RATIO_CAP = 2200n; // 2.2 × 1000
export const MULT_DENOM = 1000n;

// ──────────── Class Advantage (×1000) ────────────
export const CLASS_ADV_MULT = 1250n; // 1.25×
export const CLASS_DISADV_MULT = 800n; // 0.80×
export const CLASS_NEUTRAL_MULT = 1000n; // 1.0×

// ──────────── Crit ────────────
export const CRIT_DENOM = 200n;
export const CRIT_MULT = 1500n; // 1.5×

// ──────────── VRF Range (×1000) ────────────
export const VRF_MIN = 850n;
export const VRF_MAX = 1150n;
export const VRF_RANGE = 300n;

// ──────────── HP Scaling ────────────
export const HP_BATTLE_SCALE = 1n; // was 5n (V2 round pacing); ×1 per 2026-08-29 headless pacing sweep — see docs/gitbook/battle.md

// ──────────── Evolution Tier Multipliers (×1000) ────────────
export const TIER_MULT_BASE = 1000n;
export const TIER_MULT_EVOLVED = 1200n;
export const TIER_MULT_ELITE = 1400n;
export const TIER_MULT_APEX = 1600n;
export const LEGEND_MULT = 1100n; // 1.1×

// ──────────── Purity ────────────
export const PURITY_POTENCY_PER = 100n; // +10% per match (×1000)
export const PURITY_ENHANCED_BASE_BPS = 500n; // 5% (×10000)
export const PURITY_ENHANCED_PER_BPS = 500n; // +5% per match (×10000)

// ──────────── Game Constants ────────────
export const NUM_CLASSES = 10;
export const NUM_BODY_PARTS = 6;
export const ALLELES_PER_PART = 3;
export const TOTAL_ALLELES = 18; // 6 × 3
export const MAX_ROUNDS = 7;
export const SPECIAL_CHARGE_COST = 3;

// ──────────── DNA Bit Layout (DNALib.sol) ────────────
export const CLASS_SHIFT = 252n;
export const CLASS_MASK = 0xFn;
export const LEGEND_SHIFT = 250n;
export const LEGEND_MASK = 0x3n;
export const BREED_TYPE_SHIFT = 244n;
export const BREED_TYPE_MASK = 0x3Fn;
export const ALLELE_BITS = 8n;
export const ALLELE_MASK = 0xFFn;
export const BODY_PARTS_HIGH_BIT = 239n;

// ──────────── Mining ────────────
export const EXPEDITION_DURATION_SECONDS = 4 * 60 * 60; // 4 hours
export const EXPEDITIONS_PER_DAY = 6;
export const S1_BASE_REWARD = 1_250n;
export const TIER_WEIGHTS = [1n, 3n, 10n, 25n] as const; // Base, Evolved, Elite, Apex
export const S1_TOTAL_EMISSION = 387_500_000n;

// ──────────── Evolution Costs ($CLAW) ────────────
export const EVOLUTION_COSTS = [0n, 2_000n, 10_000n, 50_000n] as const; // Base→Evolved, Evolved→Elite, Elite→Apex
export const EVOLUTION_FUEL_COUNT = 2; // 2 fuel lobsters burned per evolution

// ──────────── Breeding ────────────
export const MAX_BREEDS_PER_LOBSTER = 5;
export const BREED_COOLDOWN_SECONDS = 48 * 60 * 60; // 48 hours
export const BREED_BASE_COST = 500n;
export const BREED_MULTIPLIERS = [1_000n, 1_500n, 2_500n, 4_000n, 8_000n] as const; // ×1000
export const GENERATION_COST_MULT = 1_500n; // 1.5× per generation (×1000)

// ──────────── Battle ────────────
export const STAKE_BRACKETS = [2_500n, 10_000n, 50_000n] as const; // Low, Mid, High
export const BATTLE_PROTOCOL_FEE_BPS = 1000n; // 10%
export const ANTI_GRIEF_DEPOSIT_BPS = 500n; // 5%
export const COMMIT_TIMEOUT_SECONDS = 15;
export const REVEAL_TIMEOUT_SECONDS = 10;
export const AUTO_FORFEIT_TIMEOUTS = 3;
export const DAMAGE_THRESHOLD = 80; // ≥80 blocks battle entry

// ──────────── Repair Rates ($CLAW per damage point) ────────────
export const REPAIR_RATES = [0n, 5n, 15n, 40n] as const; // Base, Evolved, Elite, Apex

// ──────────── Winner/Loser Damage Ranges ────────────
export const WINNER_DAMAGE_MIN = 5;
export const WINNER_DAMAGE_MAX = 15;
export const LOSER_DAMAGE_MIN = 20;
export const LOSER_DAMAGE_MAX = 40;

// ──────────── Protocol Fee Split ────────────
export const BURN_SHARE_BPS = 8500n; // 85%
export const DEV_SHARE_BPS = 1500n; // 15%

// ──────────── Faucet ────────────
export const FAUCET_LOBSTER_COUNT = 5;
export const FAUCET_CLAW_DRIP = 7_000n;
export const FAUCET_MIN_ETH = 1_000_000_000_000_000n; // 0.001 ETH in wei
export const FAUCET_WALLET_AGE_DAYS = 7;
export const FAUCET_MIN_TX_COUNT = 3;

// ──────────── Legend ────────────
export const LEGEND_CHANCE_BPS = 30n; // 0.3% (×10000)
export const LEGEND_STAT_BONUS_MULT = 1100n; // 1.1× (×1000)

// ──────────── Special Base Powers (by class ID) ────────────
export const SPECIAL_BASE_POWERS = [
  0n, // Bulwark — Fortify (utility, no damage)
  150n, // Mantis — Ambush
  180n, // Leviathan — Crush
  90n, // Tempest — Maelstrom (AoE)
  60n, // Specter — Haunt (debuff)
  0n, // Sentinel — Rally (heal, no damage)
  70n, // Reaver — Rend (DoT)
  120n, // Abyss — Devour (drain)
  60n, // Kraken — Bind (CC)
  200n, // Ember — Inferno (nuke)
] as const;

// ──────────── Base Stats [HP, Atk, Armor, Spd, Crit] ────────────
export const BASE_STATS: readonly [bigint, bigint, bigint, bigint, bigint][] = [
  [700n, 100n, 120n, 80n, 90n], // Bulwark — Atk 70→100 (2026-08-30 balance: at 70 it could not threaten its designed prey; sweep in docs/_generated or session notes)
  [375n, 100n, 70n, 130n, 125n], // Mantis
  [600n, 130n, 100n, 70n, 80n], // Leviathan
  [450n, 110n, 80n, 105n, 115n], // Tempest
  [425n, 85n, 85n, 125n, 120n], // Specter
  [650n, 70n, 110n, 90n, 100n], // Sentinel
  [475n, 120n, 80n, 110n, 95n], // Reaver
  [525n, 110n, 90n, 95n, 100n], // Abyss
  [550n, 90n, 100n, 105n, 95n], // Kraken
  [350n, 140n, 60n, 100n, 130n], // Ember
];

// ──────────── Season Schedule ────────────
export const SEASON_DURATION_DAYS = 60;
export const SEASON_EMISSIONS = [
  387_500_000n,
  193_750_000n,
  96_875_000n,
  48_437_500n,
  24_218_750n,
  12_109_375n,
  7_750_000n, // Floor — S7+
] as const;

/** Get emission budget for a given season number (1-indexed). S7+ returns the floor. */
export function getSeasonEmission(season: number): bigint {
  if (season < 1) throw new Error('Season must be >= 1');
  const idx = Math.min(season - 1, SEASON_EMISSIONS.length - 1);
  return SEASON_EMISSIONS[idx];
}
