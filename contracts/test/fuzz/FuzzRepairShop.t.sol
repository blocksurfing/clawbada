// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import "../helpers/BaseSetup.t.sol";

/// @dev Fuzz tests for RepairShop: cost formula, partial repairs, tier rates, and access control.
contract FuzzRepairShop is BaseSetup {
    address internal alice = makeAddr("alice");

    /// @dev TOK-G1: repair rates peg to MiningPool.currentBaseReward(), so a season must be
    ///      live at the spec launch reward (1,250) for the 5/15/40 $CLAW rates to apply.
    function setUp() public virtual override {
        super.setUp();
        vm.prank(admin);
        miningPool.startSeason(352_500_000e18, 1_250e18);
    }

    function _setTierAndDamage(uint256 tokenId, uint8 tier, uint8 damage) internal {
        vm.prank(admin);
        nft.setEvolutionTier(tokenId, tier);
        vm.prank(admin);
        nft.setDamage(tokenId, damage);
    }

    // ── Cost formula: cost = points × rate[tier] ──────────────────

    function testFuzz_repair_cost(uint8 tier, uint8 damage, uint8 pointsToRepair) public {
        tier = uint8(bound(tier, 1, 3)); // Evolved/Elite/Apex (Base rate=0)
        damage = uint8(bound(damage, 1, 100));
        pointsToRepair = uint8(bound(pointsToRepair, 1, damage));

        uint256 tokenId = _mintLobster(alice, 0);
        _setTierAndDamage(tokenId, tier, damage);

        uint256 rate = repairShop.repairRate(tier);
        uint256 expectedCost = uint256(pointsToRepair) * rate;

        _giveClaw(alice, expectedCost + 1e18);

        uint256 devBefore = claw.balanceOf(devWallet);
        uint256 supplyBefore = claw.totalSupply();

        vm.startPrank(alice);
        claw.approve(address(repairShop), type(uint256).max);
        repairShop.repair(tokenId, pointsToRepair);
        vm.stopPrank();

        // Check damage reduced
        assertEq(nft.getDamage(tokenId), damage - pointsToRepair);

        // Check cost was burned (85%) and dev received (15%)
        uint256 burned = supplyBefore - claw.totalSupply();
        uint256 devGot = claw.balanceOf(devWallet) - devBefore;
        assertEq(burned + devGot, expectedCost, "total fee should equal expected cost");
    }

    // ── Base tier cannot be repaired ──────────────────────────────

    function test_base_tier_repair_reverts() public {
        uint256 tokenId = _mintLobster(alice, 0);
        vm.prank(admin);
        nft.setDamage(tokenId, 50);

        // tier is 0 (Base) by default
        _giveClaw(alice, 10_000e18);

        vm.startPrank(alice);
        claw.approve(address(repairShop), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(RepairShop.CannotRepairBaseTier.selector, tokenId));
        repairShop.repair(tokenId, 10);
        vm.stopPrank();
    }

    // ── Nothing to repair reverts ─────────────────────────────────

    function test_zero_damage_reverts() public {
        uint256 tokenId = _mintLobster(alice, 0);
        vm.prank(admin);
        nft.setEvolutionTier(tokenId, 1);
        // damage is already 0

        _giveClaw(alice, 1000e18);

        vm.startPrank(alice);
        claw.approve(address(repairShop), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(RepairShop.NothingToRepair.selector, tokenId));
        repairShop.repair(tokenId, 1);
        vm.stopPrank();
    }

    // ── Zero repair points reverts ────────────────────────────────

    function test_zero_points_reverts() public {
        uint256 tokenId = _mintLobster(alice, 0);
        _setTierAndDamage(tokenId, 1, 50);
        _giveClaw(alice, 10_000e18);

        vm.startPrank(alice);
        claw.approve(address(repairShop), type(uint256).max);
        vm.expectRevert(RepairShop.ZeroRepairPoints.selector);
        repairShop.repair(tokenId, 0);
        vm.stopPrank();
    }

    // ── Exceeds current damage reverts ────────────────────────────

    function testFuzz_exceeds_damage_reverts(uint8 damage, uint8 excess) public {
        damage = uint8(bound(damage, 1, 99));
        excess = uint8(bound(excess, 1, 100 - damage));

        uint256 tokenId = _mintLobster(alice, 0);
        _setTierAndDamage(tokenId, 1, damage);
        _giveClaw(alice, 100_000e18);

        uint8 tooMany = damage + excess;
        vm.startPrank(alice);
        claw.approve(address(repairShop), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(RepairShop.ExceedsCurrentDamage.selector, tokenId, tooMany, damage)
        );
        repairShop.repair(tokenId, tooMany);
        vm.stopPrank();
    }

    // ── Partial repair works ──────────────────────────────────────

    function test_partial_repair() public {
        uint256 tokenId = _mintLobster(alice, 0);
        _setTierAndDamage(tokenId, 1, 80);
        _giveClaw(alice, 10_000e18);

        vm.startPrank(alice);
        claw.approve(address(repairShop), type(uint256).max);
        repairShop.repair(tokenId, 10); // repair only 10 of 80
        vm.stopPrank();

        assertEq(nft.getDamage(tokenId), 70, "partial repair leaves 70 damage");
    }

    // ── Not owner reverts ─────────────────────────────────────────

    function test_not_owner_reverts() public {
        address bob = makeAddr("bob");
        uint256 tokenId = _mintLobster(alice, 0);
        _setTierAndDamage(tokenId, 1, 50);
        _giveClaw(bob, 10_000e18);

        vm.startPrank(bob);
        claw.approve(address(repairShop), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(RepairShop.NotLobsterOwner.selector, tokenId));
        repairShop.repair(tokenId, 10);
        vm.stopPrank();
    }

    // ── Repair rates match spec ───────────────────────────────────

    function test_repair_rates() public view {
        assertEq(repairShop.repairRate(0), 0,      "Base rate = 0");
        assertEq(repairShop.repairRate(1), 5e18,   "Evolved rate = 5");
        assertEq(repairShop.repairRate(2), 15e18,  "Elite rate = 15");
        assertEq(repairShop.repairRate(3), 40e18,  "Apex rate = 40");
    }

    // ─────────────────────────────────────────────────────────────
    // Phase 2 RepairShop pass — gap coverage
    // ─────────────────────────────────────────────────────────────

    // Repair is allowed on locked lobsters (e.g., mid-mining-expedition).
    // Per tokenomics: damage gates battle entry, not mining — users may want
    // to keep damage low during mining too.
    function test_repair_lockedLobster_allowed() public {
        uint256 tokenId = _mintLobster(alice, 0);
        _setTierAndDamage(tokenId, 1, 40);

        vm.prank(admin);
        nft.setLocked(tokenId, true);
        assertTrue(nft.isLocked(tokenId));

        uint256 cost = 40 * 5e18;
        _giveClaw(alice, cost);

        vm.startPrank(alice);
        claw.approve(address(repairShop), cost);
        repairShop.repair(tokenId, 40);
        vm.stopPrank();

        assertEq(nft.getDamage(tokenId), 0, "damage cleared while locked");
    }

    // Repair is allowed on soulbound lobsters (they can still battle at
    // Evolved+ and accumulate damage).
    function test_repair_soulboundLobster_allowed() public {
        vm.prank(admin);
        uint256 tokenId = nft.mint(alice, _pureDNA(0), true);
        _setTierAndDamage(tokenId, 1, 25);

        uint256 cost = 25 * 5e18;
        _giveClaw(alice, cost);

        vm.startPrank(alice);
        claw.approve(address(repairShop), cost);
        repairShop.repair(tokenId, 25);
        vm.stopPrank();

        assertEq(nft.getDamage(tokenId), 0);
        assertTrue(nft.isSoulbound(tokenId), "soulbound flag preserved");
    }

    // Fee routes through Treasury with 85/15 split.
    function test_repair_feeRoutedToTreasury() public {
        uint256 tokenId = _mintLobster(alice, 0);
        _setTierAndDamage(tokenId, 2, 20); // Elite, 20 damage
        uint256 cost = 20 * 15e18;
        _giveClaw(alice, cost);

        uint256 supplyBefore = claw.totalSupply();
        uint256 devBefore = claw.balanceOf(devWallet);

        vm.startPrank(alice);
        claw.approve(address(repairShop), cost);
        repairShop.repair(tokenId, 20);
        vm.stopPrank();

        uint256 burned = supplyBefore - claw.totalSupply();
        uint256 devGot = claw.balanceOf(devWallet) - devBefore;

        assertEq(burned, cost * treasury.BURN_BPS() / treasury.BPS_DENOMINATOR(), "85% burned");
        assertEq(devGot, cost - burned, "15% to dev");
        assertEq(burned + devGot, cost, "full cost accounted");
    }

    // Insufficient CLAW balance reverts (ERC-20 bubble).
    function test_repair_insufficientClaw_reverts() public {
        uint256 tokenId = _mintLobster(alice, 0);
        _setTierAndDamage(tokenId, 3, 10); // Apex, 10 damage → 400 CLAW
        _giveClaw(alice, 50e18); // only 50 CLAW

        vm.startPrank(alice);
        claw.approve(address(repairShop), type(uint256).max);
        vm.expectRevert();
        repairShop.repair(tokenId, 10);
        vm.stopPrank();
    }

    // Max repair (100 damage points at Apex tier) doesn't overflow and
    // routes correctly. Also the largest realistic single repair cost.
    function test_repair_maxDamageApex() public {
        uint256 tokenId = _mintLobster(alice, 0);
        _setTierAndDamage(tokenId, 3, 100);
        uint256 cost = 100 * 40e18; // 4,000 CLAW
        _giveClaw(alice, cost);

        vm.startPrank(alice);
        claw.approve(address(repairShop), cost);
        repairShop.repair(tokenId, 100);
        vm.stopPrank();

        assertEq(nft.getDamage(tokenId), 0);
    }

    // Exact-damage repair reduces damage to 0 (boundary at `pointsToRepair == currentDamage`).
    function test_repair_exactDamage_setsToZero() public {
        uint256 tokenId = _mintLobster(alice, 0);
        _setTierAndDamage(tokenId, 1, 37);
        uint256 cost = 37 * 5e18;
        _giveClaw(alice, cost);

        vm.startPrank(alice);
        claw.approve(address(repairShop), cost);
        repairShop.repair(tokenId, 37);
        vm.stopPrank();

        assertEq(nft.getDamage(tokenId), 0);
    }
}
