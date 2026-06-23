// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BattleResolver} from "../../libraries/BattleResolver.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Harness — exposes internal BattleResolver functions externally for vm.expectRevert
// ─────────────────────────────────────────────────────────────────────────────

contract BattleResolverHarness {
    function getClassAdvantage(uint8 atkClass, uint8 defClass) external pure returns (uint256) {
        return BattleResolver.getClassAdvantage(atkClass, defClass);
    }

    function getBaseStats(uint8 classId) external pure returns (BattleResolver.Stats memory) {
        return BattleResolver.getBaseStats(classId);
    }

    function scaleStats(BattleResolver.Stats memory base, uint8 tier, bool legend)
        external
        pure
        returns (BattleResolver.Stats memory)
    {
        return BattleResolver.scaleStats(base, tier, legend);
    }

    function vrfRollFromRandom(uint256 rand) external pure returns (uint256) {
        return BattleResolver.vrfRollFromRandom(rand);
    }
}

/// @dev Fuzz tests for BattleResolver pure math: damage formulas, class advantage, stat scaling.
///      Tests library functions via a thin wrapper since they are internal.
contract FuzzBattleResolver is Test {
    BattleResolverHarness internal harness;

    function setUp() public {
        harness = new BattleResolverHarness();
    }

    // ── Expose internal functions via internal wrapper ────────────

    function _attackDamage(
        uint256 atk, uint256 armor, uint256 classMult, bool isCrit, uint256 vrfRoll
    ) internal pure returns (uint256) {
        return BattleResolver.calculateAttackDamage(atk, armor, classMult, isCrit, vrfRoll);
    }

    function _defendCounter(
        uint256 atk, uint256 armor, uint256 classMult, uint256 vrfRoll
    ) internal pure returns (uint256) {
        return BattleResolver.calculateDefendCounter(atk, armor, classMult, vrfRoll);
    }

    function _specialDamage(
        uint256 basePower, uint256 atk, uint256 armor, uint256 classMult, uint8 purity, uint256 vrfRoll
    ) internal pure returns (uint256) {
        return BattleResolver.calculateSpecialDamage(basePower, atk, armor, classMult, purity, vrfRoll);
    }

    // ── Attack damage: no overflow, bounded output ────────────────

    function testFuzz_attack_damage_no_overflow(
        uint256 atk,
        uint256 armor,
        bool isCrit,
        uint256 vrfSeed
    ) public pure {
        atk   = bound(atk,   1, 10_000); // realistic stat range
        armor = bound(armor, 1, 10_000);

        // VRF roll in valid range [850, 1150]
        uint256 vrfRoll = BattleResolver.VRF_MIN + (vrfSeed % (BattleResolver.VRF_RANGE + 1));

        uint256 classMult = BattleResolver.CLASS_NEUTRAL_MULT;
        uint256 damage = _attackDamage(atk, armor, classMult, isCrit, vrfRoll);

        // Damage should be > 0 and within sane upper bound
        // Max: ATTACK_BASE_POWER × 2.2 × 1.25 × 1.5 × 1.15 / (MULT_DENOM^3)
        // = 100 × 2200 × 1250 × 1500 × 1150 / 1e12 ≈ 5,981
        assertLe(damage, 10_000, "damage must be within sane bound");
    }

    // ── Crit increases damage ─────────────────────────────────────

    function testFuzz_crit_increases_damage(uint256 atk, uint256 armor, uint256 vrfSeed) public pure {
        atk   = bound(atk,   1, 5_000);
        armor = bound(armor, 1, 5_000);
        uint256 vrfRoll = BattleResolver.VRF_MIN + (vrfSeed % (BattleResolver.VRF_RANGE + 1));
        uint256 classMult = BattleResolver.CLASS_NEUTRAL_MULT;

        uint256 normalDmg = _attackDamage(atk, armor, classMult, false, vrfRoll);
        uint256 critDmg   = _attackDamage(atk, armor, classMult, true,  vrfRoll);

        assertGe(critDmg, normalDmg, "crit must be >= normal damage");
    }

    // ── Class advantage: correctness of advantage graph ───────────

    function testFuzz_class_advantage_graph(uint8 atkClass, uint8 defClass) public pure {
        atkClass = uint8(atkClass % 10);
        defClass = uint8(defClass % 10);

        uint256 mult = BattleResolver.getClassAdvantage(atkClass, defClass);

        if (atkClass == defClass) {
            assertEq(mult, BattleResolver.CLASS_NEUTRAL_MULT, "same class = neutral");
        } else {
            uint256 diff = (uint256(defClass) + 10 - uint256(atkClass)) % 10;
            if (diff >= 1 && diff <= 4) {
                assertEq(mult, BattleResolver.CLASS_ADV_MULT, "diff 1-4 = advantage");
            } else if (diff == 5) {
                assertEq(mult, BattleResolver.CLASS_NEUTRAL_MULT, "diff 5 = neutral");
            } else {
                assertEq(mult, BattleResolver.CLASS_DISADV_MULT, "diff 6-9 = disadvantage");
            }
        }
    }

    // ── Advantage graph is anti-symmetric ────────────────────────

    function testFuzz_advantage_anti_symmetry(uint8 a, uint8 b) public pure {
        a = uint8(a % 10);
        b = uint8(b % 10);
        vm.assume(a != b);

        uint256 aVsB = BattleResolver.getClassAdvantage(a, b);
        uint256 bVsA = BattleResolver.getClassAdvantage(b, a);

        // If a has advantage over b, b has disadvantage over a
        if (aVsB == BattleResolver.CLASS_ADV_MULT) {
            assertEq(bVsA, BattleResolver.CLASS_DISADV_MULT, "anti-symmetry: adv <-> disadv");
        } else if (aVsB == BattleResolver.CLASS_DISADV_MULT) {
            assertEq(bVsA, BattleResolver.CLASS_ADV_MULT, "anti-symmetry: disadv <-> adv");
        } else {
            // Both neutral when diff==5 (opposite in 10-ring)
            assertEq(bVsA, BattleResolver.CLASS_NEUTRAL_MULT, "anti-symmetry: neutral <-> neutral");
        }
    }

    // ── Invalid class reverts (via harness — internal functions need external call for vm.expectRevert) ─

    function testFuzz_invalid_class_reverts(uint8 invalidClass) public {
        invalidClass = uint8(bound(invalidClass, 10, type(uint8).max));
        vm.expectRevert();
        harness.getClassAdvantage(invalidClass, 0);
    }

    // ── Stat scaling: legend adds 10% bonus ──────────────────────

    function testFuzz_legend_bonus(uint8 classId, uint8 tier) public pure {
        classId = uint8(classId % 10);
        tier    = uint8(tier % 4);

        BattleResolver.Stats memory base = BattleResolver.getBaseStats(classId);
        BattleResolver.Stats memory normal = BattleResolver.scaleStats(base, tier, false);
        BattleResolver.Stats memory legend = BattleResolver.scaleStats(base, tier, true);

        // Legend is exactly floor(normal * LEGEND_MULT / 1000) — integer division applies
        assertEq(
            legend.attack,
            normal.attack * BattleResolver.LEGEND_MULT / 1000,
            "legend attack = floor(normal * 1100/1000)"
        );
    }

    // ── Special base powers by class ─────────────────────────────

    function test_special_base_powers() public pure {
        assertEq(BattleResolver.getSpecialBasePower(0), 0,   "Bulwark = 0 (utility)");
        assertEq(BattleResolver.getSpecialBasePower(1), 150, "Mantis = 150");
        assertEq(BattleResolver.getSpecialBasePower(2), 180, "Leviathan = 180");
        assertEq(BattleResolver.getSpecialBasePower(3), 120, "Tempest = 120");
        assertEq(BattleResolver.getSpecialBasePower(4), 60,  "Specter = 60");
        assertEq(BattleResolver.getSpecialBasePower(5), 0,   "Sentinel = 0 (heal)");
        assertEq(BattleResolver.getSpecialBasePower(6), 70,  "Reaver = 70");
        assertEq(BattleResolver.getSpecialBasePower(7), 150, "Abyss = 150");
        assertEq(BattleResolver.getSpecialBasePower(8), 60,  "Kraken = 60");
        assertEq(BattleResolver.getSpecialBasePower(9), 200, "Ember = 200");
    }

    // ── Crit chance formula ───────────────────────────────────────

    function testFuzz_crit_chance_bounded(uint256 critStat) public pure {
        critStat = bound(critStat, 0, 10_000);
        uint256 chance = BattleResolver.critChance(critStat);
        // Chance should always be in [0, 10000] BPS
        assertLe(chance, 10_000, "crit chance must be <= 10000 BPS");
    }

    function test_crit_chance_increases_with_stat() public pure {
        uint256 low  = BattleResolver.critChance(50);
        uint256 high = BattleResolver.critChance(200);
        assertGt(high, low, "higher crit stat = higher crit chance");
    }

    // ── Purity enhanced proc chance ───────────────────────────────

    function testFuzz_enhanced_proc_chance(uint8 purity) public pure {
        purity = uint8(purity % 7); // 0-6
        uint256 chance = BattleResolver.enhancedProcChance(purity);

        // Base 5% + 5% per purity, max at purity=6 → 35% = 3500 BPS
        uint256 expected = BattleResolver.PURITY_ENHANCED_BASE_BPS
            + uint256(purity) * BattleResolver.PURITY_ENHANCED_PER_BPS;
        assertEq(chance, expected);
        assertLe(chance, 10_000, "proc chance <= 100%");
    }

    // ── Special damage: purity multiplier ────────────────────────

    function testFuzz_special_damage_purity_scaling(uint8 purity, uint256 vrfSeed) public pure {
        purity = uint8(purity % 7); // 0-6

        uint256 atk    = 100;
        uint256 armor  = 100;
        uint256 vrfRoll = BattleResolver.VRF_MIN + (vrfSeed % (BattleResolver.VRF_RANGE + 1));
        uint256 basePow = 100;

        uint256 dmgLow  = _specialDamage(basePow, atk, armor, BattleResolver.CLASS_NEUTRAL_MULT, 0, vrfRoll);
        uint256 dmgHigh = _specialDamage(basePow, atk, armor, BattleResolver.CLASS_NEUTRAL_MULT, purity, vrfRoll);

        assertGe(dmgHigh, dmgLow, "higher purity >= lower purity damage");
    }

    // ── Stat ratio cap at 2.2× ────────────────────────────────────

    function testFuzz_stat_ratio_cap(uint256 atk, uint256 armor, uint256 vrfSeed) public pure {
        atk   = bound(atk,   1, type(uint128).max);
        armor = bound(armor, 1, type(uint128).max);
        uint256 vrfRoll = BattleResolver.VRF_MIN + (vrfSeed % (BattleResolver.VRF_RANGE + 1));

        // Should not revert (capped internally)
        uint256 dmg = _attackDamage(atk, armor, BattleResolver.CLASS_NEUTRAL_MULT, false, vrfRoll);

        // With cap at 2.2 and neutral class, max damage:
        // = 100 × 2200 × 1000 × 1000 × 1150 / 1e12 = 253
        assertLe(dmg, 400, "damage capped by ratio cap");
    }

    // ── Base stats by class ───────────────────────────────────────

    function testFuzz_base_stats_valid_class(uint8 classId) public pure {
        classId = uint8(classId % 10);
        BattleResolver.Stats memory s = BattleResolver.getBaseStats(classId);
        assertGt(s.hp,     0);
        assertGt(s.attack, 0);
        assertGt(s.armor,  0);
        assertGt(s.speed,  0);
        assertGt(s.critical, 0);
    }

    function test_base_stats_invalid_class_reverts() public {
        vm.expectRevert();
        harness.getBaseStats(10);
    }

    // ── Defend counter < attack damage (base power difference) ────

    function testFuzz_defend_less_than_attack(uint256 atk, uint256 armor, uint256 vrfSeed) public pure {
        atk   = bound(atk,   1, 5_000);
        armor = bound(armor, 1, 5_000);
        uint256 vrfRoll = BattleResolver.VRF_MIN + (vrfSeed % (BattleResolver.VRF_RANGE + 1));

        uint256 attackDmg  = _attackDamage(atk, armor, BattleResolver.CLASS_NEUTRAL_MULT, false, vrfRoll);
        uint256 counterDmg = _defendCounter(atk, armor, BattleResolver.CLASS_NEUTRAL_MULT, vrfRoll);

        // Counter base power is 30, attack base power is 100 → counter always < attack (same stats)
        assertLe(counterDmg, attackDmg, "defend counter <= attack damage");
    }

    // ─────────────────────────────────────────────────────────────
    // Phase 1 BattleResolver pass — additional property tests
    // ─────────────────────────────────────────────────────────────

    // Tournament graph balance: every class must have exactly 4 adv / 4
    // disadv / 2 neutral matchups (self + opposite in 10-ring). The
    // existing anti-symmetry test doesn't guarantee this count property.
    // Design spec (CLAUDE.md): "each class beats 4, loses to 4, neutral 2".
    function test_tournament_graph_four_four_two() public pure {
        for (uint8 atk = 0; atk < 10; atk++) {
            uint8 adv = 0;
            uint8 disadv = 0;
            uint8 neutral = 0;
            for (uint8 def = 0; def < 10; def++) {
                uint256 mult = BattleResolver.getClassAdvantage(atk, def);
                if (mult == BattleResolver.CLASS_ADV_MULT) adv++;
                else if (mult == BattleResolver.CLASS_DISADV_MULT) disadv++;
                else if (mult == BattleResolver.CLASS_NEUTRAL_MULT) neutral++;
                else revert("unknown class multiplier");
            }
            assertEq(adv,     4, "class must have exactly 4 advantages");
            assertEq(disadv,  4, "class must have exactly 4 disadvantages");
            assertEq(neutral, 2, "class must have exactly 2 neutrals (self + opposite)");
        }
    }

    // scaleStats monotonic across tiers — tier 3 > tier 2 > tier 1 > tier 0
    // for every stat (except when base stat is so small that integer
    // division floors to the same value — we assert weak monotonic).
    function testFuzz_scaleStats_tier_monotonic(uint8 classId, bool legend) public pure {
        classId = uint8(classId % 10);
        BattleResolver.Stats memory base = BattleResolver.getBaseStats(classId);

        BattleResolver.Stats memory t0 = BattleResolver.scaleStats(base, 0, legend);
        BattleResolver.Stats memory t1 = BattleResolver.scaleStats(base, 1, legend);
        BattleResolver.Stats memory t2 = BattleResolver.scaleStats(base, 2, legend);
        BattleResolver.Stats memory t3 = BattleResolver.scaleStats(base, 3, legend);

        assertGe(t1.attack, t0.attack, "tier1 attack >= tier0");
        assertGe(t2.attack, t1.attack, "tier2 attack >= tier1");
        assertGe(t3.attack, t2.attack, "tier3 attack >= tier2");

        assertGe(t1.hp, t0.hp, "tier1 hp >= tier0");
        assertGe(t2.hp, t1.hp, "tier2 hp >= tier1");
        assertGe(t3.hp, t2.hp, "tier3 hp >= tier2");

        assertGe(t1.armor,    t0.armor,    "tier1 armor >= tier0");
        assertGe(t1.speed,    t0.speed,    "tier1 speed >= tier0");
        assertGe(t1.critical, t0.critical, "tier1 critical >= tier0");
    }

    // HP battle scale (HP_BATTLE_SCALE) is baked into scaleStats. At tier 0
    // with no legend, scaled HP should equal base HP × HP_BATTLE_SCALE.
    function testFuzz_hp_battle_scale_at_base_tier(uint8 classId) public pure {
        classId = uint8(classId % 10);
        BattleResolver.Stats memory base = BattleResolver.getBaseStats(classId);
        BattleResolver.Stats memory scaled = BattleResolver.scaleStats(base, 0, false);
        assertEq(
            scaled.hp,
            base.hp * BattleResolver.HP_BATTLE_SCALE,
            "scaled HP at tier 0 non-legend = base HP x HP_BATTLE_SCALE"
        );
    }

    // Attack/Armor stat ratio cap: any two atk/armor pairs that both
    // overshoot the 2.2x cap must produce identical damage, because
    // _cappedRatio clamps both to STAT_RATIO_CAP before multiplying.
    function testFuzz_ratio_cap_clamps_extreme_attacks(uint256 extremeAtk, uint256 armor, uint256 vrfSeed) public pure {
        armor = bound(armor, 1, 1_000);
        // Two atk values both guaranteed past the 2.2x cap.
        extremeAtk = bound(extremeAtk, 3 * armor, type(uint128).max);
        uint256 referenceAtk = 3 * armor; // lowest possible value that still hits the cap
        uint256 vrfRoll = BattleResolver.VRF_MIN + (vrfSeed % (BattleResolver.VRF_RANGE + 1));
        uint256 classMult = BattleResolver.CLASS_NEUTRAL_MULT;

        uint256 extremeDmg   = _attackDamage(extremeAtk,   armor, classMult, false, vrfRoll);
        uint256 referenceDmg = _attackDamage(referenceAtk, armor, classMult, false, vrfRoll);

        assertEq(extremeDmg, referenceDmg, "past-cap atk/armor pairs must produce identical damage");
    }

    // Out-of-spec purity values (> 6) produce valid but scaled output —
    // the library itself does NOT validate purity ≤ 6. This documents
    // caller-responsibility for bounds and prevents silent ambiguity.
    function testFuzz_purity_above_spec_scales_predictably(uint8 purity, uint256 vrfSeed) public pure {
        purity = uint8(bound(purity, 7, 50)); // intentionally above spec
        uint256 atk = 100;
        uint256 armor = 100;
        uint256 vrfRoll = BattleResolver.VRF_MIN + (vrfSeed % (BattleResolver.VRF_RANGE + 1));

        uint256 dmgAtSpec = _specialDamage(100, atk, armor, BattleResolver.CLASS_NEUTRAL_MULT, 6, vrfRoll);
        uint256 dmgBeyond = _specialDamage(100, atk, armor, BattleResolver.CLASS_NEUTRAL_MULT, purity, vrfRoll);

        // Documents: library happily scales past spec. Callers (BattleArena,
        // off-chain engine) are responsible for bounding purity ≤ 6.
        assertGt(dmgBeyond, dmgAtSpec, "out-of-spec purity produces larger damage (caller bounds input)");
    }

    // deriveRandom is deterministic: same (seed, salt) always returns the
    // same output. Sanity check — protects against accidental migration
    // to block-data randomness in this pure helper.
    function testFuzz_deriveRandom_deterministic(uint256 seed, bytes32 salt) public pure {
        uint256 a = BattleResolver.deriveRandom(seed, salt);
        uint256 b = BattleResolver.deriveRandom(seed, salt);
        assertEq(a, b, "deriveRandom must be deterministic");
    }

    // Varying salt must vary output (otherwise hash collision).
    function testFuzz_deriveRandom_saltSensitivity(uint256 seed, bytes32 salt1, bytes32 salt2) public pure {
        vm.assume(salt1 != salt2);
        uint256 a = BattleResolver.deriveRandom(seed, salt1);
        uint256 b = BattleResolver.deriveRandom(seed, salt2);
        assertTrue(a != b, "different salts must produce different outputs (keccak collision would be catastrophic)");
    }

    // R-06: enhancedProcChance must cap at 10_000 BPS to preserve its
    // probability contract. Raw formula crosses 100% at purity > 19.
    // Pre-fix: callers using the BPS against a 0..9999 roll got unconditional
    // procs at high purity. Post-fix: result is clamped to 10_000.
    function testFuzz_enhancedProcChance_capped_at_100pct(uint8 purity) public pure {
        uint256 chance = BattleResolver.enhancedProcChance(purity);
        assertLe(chance, 10_000, "R-06: enhancedProcChance must never exceed 100% BPS");
    }

    function test_enhancedProcChance_capAtHighPurity() public pure {
        // Raw formula would give 128_000 at purity=255; clamped to 10_000.
        assertEq(BattleResolver.enhancedProcChance(255), 10_000, "R-06: clamp at max uint8 purity");
        // At purity=19 (exactly at cap boundary): raw = 500 + 19*500 = 10_000. No clamp needed.
        assertEq(BattleResolver.enhancedProcChance(19), 10_000, "R-06: boundary at purity=19");
        // At purity=20: raw = 500 + 20*500 = 10_500; clamped to 10_000.
        assertEq(BattleResolver.enhancedProcChance(20), 10_000, "R-06: clamp at purity=20");
        // In-spec still correct: purity=6 → 3500 BPS
        assertEq(BattleResolver.enhancedProcChance(6), 3500, "in-spec purity unaffected");
    }

    // R-03: _cappedRatio must short-circuit before `atk * MULT_DENOM` overflows.
    // Pre-fix: atk > type(uint256).max / 1000 caused arithmetic panic.
    // Post-fix: the cap kicks in without touching the overflow-prone multiply.
    function testFuzz_cappedRatio_overflowGuard(uint256 armor, uint256 vrfSeed) public pure {
        armor = bound(armor, 1, type(uint128).max);
        uint256 atk = type(uint256).max; // guaranteed beyond the overflow-safe threshold
        uint256 vrfRoll = BattleResolver.VRF_MIN + (vrfSeed % (BattleResolver.VRF_RANGE + 1));

        // Should not revert, and should produce the same damage as any other
        // past-cap atk (since both clamp to STAT_RATIO_CAP before multiplying).
        uint256 hugeDmg = _attackDamage(atk, armor, BattleResolver.CLASS_NEUTRAL_MULT, false, vrfRoll);
        uint256 cappedDmg = _attackDamage(3 * armor, armor, BattleResolver.CLASS_NEUTRAL_MULT, false, vrfRoll);
        assertEq(hugeDmg, cappedDmg, "past-cap atk must match regardless of magnitude (no overflow panic)");
    }

    // ── F5-04: canonical VRF roll mapping + fail-closed tier ──────

    // vrfRollFromRandom maps into the INCLUSIVE [VRF_MIN, VRF_MAX] range; VRF_MAX must be
    // reachable (the `% VRF_RANGE` off-by-one could never emit it).
    function test_F5_04_vrfRollFromRandom_inclusiveEndpoints() public view {
        assertEq(harness.vrfRollFromRandom(0), BattleResolver.VRF_MIN, "rand 0 -> VRF_MIN");
        assertEq(harness.vrfRollFromRandom(BattleResolver.VRF_SPAN - 1), BattleResolver.VRF_MAX, "rand 300 -> VRF_MAX");
        assertEq(harness.vrfRollFromRandom(BattleResolver.VRF_SPAN), BattleResolver.VRF_MIN, "rand 301 wraps to VRF_MIN");
    }

    function testFuzz_F5_04_vrfRoll_alwaysInRange(uint256 rand) public view {
        uint256 roll = harness.vrfRollFromRandom(rand);
        assertGe(roll, BattleResolver.VRF_MIN);
        assertLe(roll, BattleResolver.VRF_MAX);
    }

    function test_F5_04_scaleStats_invalidTier_reverts() public {
        BattleResolver.Stats memory base = BattleResolver.getBaseStats(0);
        vm.expectRevert(abi.encodeWithSelector(BattleResolver.InvalidTier.selector, uint8(4)));
        harness.scaleStats(base, 4, false);
    }

    // ── S2 cross-implementation parity (KAT) ─────────────────────
    // Known-answer vectors. The SAME inputs and expected outputs are asserted against the
    // TypeScript engine in packages/game-logic/src/__tests__/parity.test.ts. If either
    // implementation drifts from these canonical values (or from each other), one side's
    // KAT fails — locking Solidity⇄TS parity in CI ahead of the S2 replay() port.
    function test_S2_parity_knownAnswers() public view {
        // scaleStats: Bulwark (700/70/120/80/90) at Apex (tier 3) + legend.
        BattleResolver.Stats memory s = harness.scaleStats(BattleResolver.getBaseStats(0), 3, true);
        assertEq(s.hp, 6160, "KAT scaleStats hp");
        assertEq(s.attack, 123, "KAT scaleStats attack");
        assertEq(s.armor, 211, "KAT scaleStats armor");
        assertEq(s.speed, 140, "KAT scaleStats speed");
        assertEq(s.critical, 158, "KAT scaleStats critical");

        // calculateAttackDamage(atk=200, armor=100, classMult=ADV, crit, vrf=1000)
        assertEq(
            BattleResolver.calculateAttackDamage(200, 100, BattleResolver.CLASS_ADV_MULT, true, 1000),
            375,
            "KAT attack damage"
        );
        // calculateSpecialDamage(base=150, atk=200, armor=100, neutral, purity=6, vrf=1150)
        assertEq(
            BattleResolver.calculateSpecialDamage(150, 200, 100, BattleResolver.CLASS_NEUTRAL_MULT, 6, 1150),
            552,
            "KAT special damage"
        );
        // calculateDefendCounter(atk=150, armor=120, disadv, vrf=900)
        assertEq(
            BattleResolver.calculateDefendCounter(150, 120, BattleResolver.CLASS_DISADV_MULT, 900),
            27,
            "KAT defend counter"
        );

        assertEq(BattleResolver.critChance(130), 3939, "KAT crit chance");
        assertEq(BattleResolver.enhancedProcChance(6), 3500, "KAT proc chance in-spec");
        assertEq(BattleResolver.enhancedProcChance(20), 10_000, "KAT proc chance capped");

        assertEq(harness.vrfRollFromRandom(12345), 854, "KAT vrf roll mapping");

        assertEq(BattleResolver.getClassAdvantage(0, 1), BattleResolver.CLASS_ADV_MULT, "KAT adv");
        assertEq(BattleResolver.getClassAdvantage(0, 5), BattleResolver.CLASS_NEUTRAL_MULT, "KAT neutral");
        assertEq(BattleResolver.getClassAdvantage(0, 6), BattleResolver.CLASS_DISADV_MULT, "KAT disadv");
    }
}
