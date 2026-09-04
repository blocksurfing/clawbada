// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BattleResolver} from "../contracts/libraries/BattleResolver.sol";

/// @dev Thin harness to expose internal library functions for testing.
contract BattleResolverHarness {
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

    function getClassAdvantage(uint8 atkClass, uint8 defClass) external pure returns (uint256) {
        return BattleResolver.getClassAdvantage(atkClass, defClass);
    }

    function calculateAttackDamage(uint256 atk, uint256 armor, uint256 classMult, bool isCrit, uint256 vrfRoll)
        external
        pure
        returns (uint256)
    {
        return BattleResolver.calculateAttackDamage(atk, armor, classMult, isCrit, vrfRoll);
    }

    function calculateDefendCounter(uint256 atk, uint256 armor, uint256 classMult, uint256 vrfRoll)
        external
        pure
        returns (uint256)
    {
        return BattleResolver.calculateDefendCounter(atk, armor, classMult, vrfRoll);
    }

    function calculateSpecialDamage(
        uint256 basePower,
        uint256 atk,
        uint256 armor,
        uint256 classMult,
        uint8 purity,
        uint256 vrfRoll
    ) external pure returns (uint256) {
        return BattleResolver.calculateSpecialDamage(basePower, atk, armor, classMult, purity, vrfRoll);
    }

    function critChance(uint256 critStat) external pure returns (uint256) {
        return BattleResolver.critChance(critStat);
    }

    function getSpecialBasePower(uint8 classId) external pure returns (uint256) {
        return BattleResolver.getSpecialBasePower(classId);
    }

    function enhancedProcChance(uint8 purity) external pure returns (uint256) {
        return BattleResolver.enhancedProcChance(purity);
    }

    function deriveRandom(uint256 seed, bytes32 salt) external pure returns (uint256) {
        return BattleResolver.deriveRandom(seed, salt);
    }
}

contract BattleResolverTest is Test {
    BattleResolverHarness resolver;

    function setUp() public {
        resolver = new BattleResolverHarness();
    }

    // ──────────── Base Stats ────────────

    function test_getBaseStatsAllClasses() public view {
        // Bulwark
        BattleResolver.Stats memory s = resolver.getBaseStats(0);
        assertEq(s.hp, 700);
        assertEq(s.attack, 100); // 70->100 (2026-08-30 balance)
        assertEq(s.armor, 120);
        assertEq(s.speed, 80);
        assertEq(s.critical, 90);

        // Mantis
        s = resolver.getBaseStats(1);
        assertEq(s.hp, 375);
        assertEq(s.attack, 100);
        assertEq(s.armor, 70);
        assertEq(s.speed, 130);
        assertEq(s.critical, 125);

        // Leviathan
        s = resolver.getBaseStats(2);
        assertEq(s.hp, 600);
        assertEq(s.attack, 130);
        assertEq(s.armor, 100);
        assertEq(s.speed, 70);
        assertEq(s.critical, 80);

        // Tempest
        s = resolver.getBaseStats(3);
        assertEq(s.hp, 450);
        assertEq(s.attack, 110);
        assertEq(s.armor, 80);
        assertEq(s.speed, 105);
        assertEq(s.critical, 115);

        // Specter
        s = resolver.getBaseStats(4);
        assertEq(s.hp, 425);
        assertEq(s.attack, 85);
        assertEq(s.armor, 85);
        assertEq(s.speed, 125);
        assertEq(s.critical, 120);

        // Sentinel
        s = resolver.getBaseStats(5);
        assertEq(s.hp, 650);
        assertEq(s.attack, 70);
        assertEq(s.armor, 110);
        assertEq(s.speed, 90);
        assertEq(s.critical, 100);

        // Reaver
        s = resolver.getBaseStats(6);
        assertEq(s.hp, 475);
        assertEq(s.attack, 120);
        assertEq(s.armor, 80);
        assertEq(s.speed, 110);
        assertEq(s.critical, 95);

        // Abyss
        s = resolver.getBaseStats(7);
        assertEq(s.hp, 525);
        assertEq(s.attack, 110);
        assertEq(s.armor, 90);
        assertEq(s.speed, 95);
        assertEq(s.critical, 100);

        // Kraken
        s = resolver.getBaseStats(8);
        assertEq(s.hp, 550);
        assertEq(s.attack, 90);
        assertEq(s.armor, 100);
        assertEq(s.speed, 105);
        assertEq(s.critical, 95);

        // Ember
        s = resolver.getBaseStats(9);
        assertEq(s.hp, 350);
        assertEq(s.attack, 140);
        assertEq(s.armor, 60);
        assertEq(s.speed, 100);
        assertEq(s.critical, 130);
    }

    function test_baseStatsNonHPTotals() public view {
        // Verify non-HP stat totals match spec values for each class
        uint256[10] memory expectedTotals = [
            uint256(390), // Bulwark: 100+120+80+90 (Atk 70->100, 2026-08-30)
            uint256(425), // Mantis: 100+70+130+125
            uint256(380), // Leviathan: 130+100+70+80
            uint256(410), // Tempest: 110+80+105+115
            uint256(415), // Specter: 85+85+125+120
            uint256(370), // Sentinel: 70+110+90+100
            uint256(405), // Reaver: 120+80+110+95
            uint256(395), // Abyss: 110+90+95+100
            uint256(390), // Kraken: 90+100+105+95
            uint256(430)  // Ember: 140+60+100+130
        ];

        for (uint8 i = 0; i < 10; i++) {
            BattleResolver.Stats memory s = resolver.getBaseStats(i);
            uint256 total = s.attack + s.armor + s.speed + s.critical;
            assertEq(total, expectedTotals[i], string.concat("Non-HP total mismatch for class ", vm.toString(i)));
        }
    }

    function test_getBaseStatsInvalidClassReverts() public {
        vm.expectRevert(abi.encodeWithSelector(BattleResolver.InvalidClassId.selector, 10));
        resolver.getBaseStats(10);

        vm.expectRevert(abi.encodeWithSelector(BattleResolver.InvalidClassId.selector, 255));
        resolver.getBaseStats(255);
    }

    // ──────────── Stat Scaling ────────────

    function test_scaleStatsBaseTier() public view {
        // Base tier: ×1.0 stats, HP×5
        BattleResolver.Stats memory base = resolver.getBaseStats(0); // Bulwark
        BattleResolver.Stats memory scaled = resolver.scaleStats(base, 0, false);

        assertEq(scaled.hp, 700); // HP_BATTLE_SCALE = 1 (was 5)
        assertEq(scaled.attack, 100);
        assertEq(scaled.armor, 120);
        assertEq(scaled.speed, 80);
        assertEq(scaled.critical, 90);
    }

    function test_scaleStatsEvolvedTier() public view {
        // Evolved: ×1.2 stats, HP×5
        BattleResolver.Stats memory base = resolver.getBaseStats(0); // Bulwark
        BattleResolver.Stats memory scaled = resolver.scaleStats(base, 1, false);

        assertEq(scaled.hp, 700 * 1200 / 1000); // 700 × 1.2 = 840 (HP scale ×1)
        assertEq(scaled.attack, 100 * 1200 / 1000); // 120
        assertEq(scaled.armor, 120 * 1200 / 1000); // 144
        assertEq(scaled.speed, 80 * 1200 / 1000); // 96
        assertEq(scaled.critical, 90 * 1200 / 1000); // 108
    }

    function test_scaleStatsApexLegend() public view {
        // Apex (×1.6) + Legend (×1.1) = ×1.76
        BattleResolver.Stats memory base = resolver.getBaseStats(9); // Ember
        BattleResolver.Stats memory scaled = resolver.scaleStats(base, 3, true);

        // HP: 350 × 1600 × 1100 / (1000 × 1000) = 350 × 1.6 × 1.1 = 616 (HP scale ×1)
        assertEq(scaled.hp, uint256(350) * 1600 * 1100 / (1000 * 1000));
        // Attack: 140 × 1.6 × 1.1 = 246.4 → 246 (integer)
        assertEq(scaled.attack, uint256(140) * 1600 * 1100 / (1000 * 1000));
        assertEq(scaled.armor, uint256(60) * 1600 * 1100 / (1000 * 1000));
        assertEq(scaled.speed, uint256(100) * 1600 * 1100 / (1000 * 1000));
        assertEq(scaled.critical, uint256(130) * 1600 * 1100 / (1000 * 1000));
    }

    function test_scaleStatsNonLegend() public view {
        // Non-legend should have legendMult = 1000 (×1.0)
        BattleResolver.Stats memory base = resolver.getBaseStats(1); // Mantis
        BattleResolver.Stats memory scaled = resolver.scaleStats(base, 0, false);

        assertEq(scaled.hp, 375); // no tier or legend bonus (HP scale ×1)
        assertEq(scaled.attack, 100);
    }

    // ──────────── Class Advantage ────────────

    function test_classAdvantageBeatsNext4() public view {
        // Class 0 beats 1, 2, 3, 4
        assertEq(resolver.getClassAdvantage(0, 1), 1250);
        assertEq(resolver.getClassAdvantage(0, 2), 1250);
        assertEq(resolver.getClassAdvantage(0, 3), 1250);
        assertEq(resolver.getClassAdvantage(0, 4), 1250);
    }

    function test_classAdvantageLosesToPrev4() public view {
        // Class 0 loses to 6, 7, 8, 9
        assertEq(resolver.getClassAdvantage(0, 6), 800);
        assertEq(resolver.getClassAdvantage(0, 7), 800);
        assertEq(resolver.getClassAdvantage(0, 8), 800);
        assertEq(resolver.getClassAdvantage(0, 9), 800);
    }

    function test_classAdvantageNeutralOpposite() public view {
        // Class 0 neutral with 5 (opposite in 10-class ring)
        assertEq(resolver.getClassAdvantage(0, 5), 1000);
        // Also test other opposites
        assertEq(resolver.getClassAdvantage(3, 8), 1000);
        assertEq(resolver.getClassAdvantage(7, 2), 1000);
    }

    function test_classAdvantageSameClass() public view {
        for (uint8 i = 0; i < 10; i++) {
            assertEq(resolver.getClassAdvantage(i, i), 1000);
        }
    }

    // ──────────── Damage Formulas ────────────

    function test_attackDamageBasicFormula() public view {
        // 100 atk vs 100 armor, neutral, no crit, VRF 1.0
        // 100 × (100/100 = 1.0) × 1.0 × 1.0 × 1.0 = 100
        uint256 dmg = resolver.calculateAttackDamage(100, 100, 1000, false, 1000);
        assertEq(dmg, 100);
    }

    function test_attackDamageWithCrit() public view {
        // 100 atk vs 100 armor, neutral, CRIT, VRF 1.0
        // 100 × 1.0 × 1.0 × 1.5 × 1.0 = 150
        uint256 dmg = resolver.calculateAttackDamage(100, 100, 1000, true, 1000);
        assertEq(dmg, 150);
    }

    function test_attackDamageRatioCapped() public view {
        // 500 atk vs 100 armor → ratio 5.0, capped at 2.2
        // 100 × 2.2 × 1.0 × 1.0 × 1.0 = 220
        uint256 dmg = resolver.calculateAttackDamage(500, 100, 1000, false, 1000);
        assertEq(dmg, 220);
    }

    function test_defendCounterDamage() public view {
        // 100 atk vs 100 armor, neutral, VRF 1.0
        // 30 × 1.0 × 1.0 × 1.0 = 30
        uint256 dmg = resolver.calculateDefendCounter(100, 100, 1000, 1000);
        assertEq(dmg, 30);
    }

    function test_specialDamageWithPurity() public view {
        // Leviathan Crush (base 180), 100 atk vs 100 armor, neutral, VRF 1.0
        // Purity 0: 180 × 1.0 × 1.0 × 1.0 × 1.0 = 180
        uint256 dmg0 = resolver.calculateSpecialDamage(180, 100, 100, 1000, 0, 1000);
        assertEq(dmg0, 180);

        // Purity 6: 180 × 1.0 × 1.0 × 1.6 × 1.0 = 288
        uint256 dmg6 = resolver.calculateSpecialDamage(180, 100, 100, 1000, 6, 1000);
        assertEq(dmg6, 288);

        // 60% increase from 0 to 6 purity
        assertEq(dmg6 * 1000 / dmg0, 1600);
    }

    function test_attackDamageWithClassAdvantage() public view {
        // 100 atk vs 100 armor, 1.25× advantage, no crit, VRF 1.0
        // 100 × 1.0 × 1.25 × 1.0 × 1.0 = 125
        uint256 dmg = resolver.calculateAttackDamage(100, 100, 1250, false, 1000);
        assertEq(dmg, 125);
    }

    // ──────────── Crit & Purity ────────────

    function test_critChanceFormula() public view {
        // critStat = 100 → 100 × 10000 / (100 + 200) = 3333 BPS (33.33%)
        assertEq(resolver.critChance(100), 3333);

        // critStat = 200 → 200 × 10000 / (200 + 200) = 5000 BPS (50%)
        assertEq(resolver.critChance(200), 5000);

        // critStat = 0 → 0
        assertEq(resolver.critChance(0), 0);

        // critStat = 130 (Ember) → 130 × 10000 / 330 = 3939
        assertEq(resolver.critChance(130), 3939);
    }

    function test_enhancedProcPurity0() public view {
        // 500 BPS = 5%
        assertEq(resolver.enhancedProcChance(0), 500);
    }

    function test_enhancedProcPurity6() public view {
        // 500 + 6 × 500 = 3500 BPS = 35%
        assertEq(resolver.enhancedProcChance(6), 3500);
    }

    function test_getSpecialBasePowerAllClasses() public view {
        uint256[10] memory expected = [uint256(0), 150, 180, 120, 60, 0, 70, 150, 60, 200]; // Maelstrom 120, Devour 150 (2026-08-30)
        for (uint8 i = 0; i < 10; i++) {
            assertEq(resolver.getSpecialBasePower(i), expected[i]);
        }
    }

    // ──────────── Derive Random ────────────

    function test_deriveRandomDeterministic() public view {
        uint256 r1 = resolver.deriveRandom(12345, bytes32("salt1"));
        uint256 r2 = resolver.deriveRandom(12345, bytes32("salt1"));
        assertEq(r1, r2);
    }

    function test_deriveRandomDifferentSalts() public view {
        uint256 r1 = resolver.deriveRandom(12345, bytes32("salt1"));
        uint256 r2 = resolver.deriveRandom(12345, bytes32("salt2"));
        assertTrue(r1 != r2);
    }

    // ──────────── Fuzz Tests ────────────

    function testFuzz_classAdvantageSymmetry(uint8 a, uint8 b) public view {
        a = uint8(bound(a, 0, 9));
        b = uint8(bound(b, 0, 9));

        uint256 abMult = resolver.getClassAdvantage(a, b);
        uint256 baMult = resolver.getClassAdvantage(b, a);

        if (a == b) {
            assertEq(abMult, 1000);
            assertEq(baMult, 1000);
        } else if (abMult == 1250) {
            // A beats B → B loses to A
            assertEq(baMult, 800);
        } else if (abMult == 800) {
            // A loses to B → B beats A
            assertEq(baMult, 1250);
        } else {
            // Neutral — both should be neutral
            assertEq(abMult, 1000);
            assertEq(baMult, 1000);
        }
    }

    function testFuzz_attackDamageNeverZero(uint256 atk, uint256 armor, uint256 vrfRoll) public view {
        // Use realistic stat ranges (lowest base stat is 60, Apex legend scales ×1.76)
        atk = bound(atk, 60, 500);
        armor = bound(armor, 60, 500);
        vrfRoll = bound(vrfRoll, 850, 1150);

        uint256 dmg = resolver.calculateAttackDamage(atk, armor, 1000, false, vrfRoll);
        assertTrue(dmg > 0, "Attack damage should never be zero for realistic stats");
    }
}
