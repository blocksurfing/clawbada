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
        assertEq(BattleResolver.getSpecialBasePower(3), 90,  "Tempest = 90");
        assertEq(BattleResolver.getSpecialBasePower(4), 60,  "Specter = 60");
        assertEq(BattleResolver.getSpecialBasePower(5), 0,   "Sentinel = 0 (heal)");
        assertEq(BattleResolver.getSpecialBasePower(6), 70,  "Reaver = 70");
        assertEq(BattleResolver.getSpecialBasePower(7), 120, "Abyss = 120");
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
}
