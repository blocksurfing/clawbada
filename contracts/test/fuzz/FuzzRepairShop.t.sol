// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import "../helpers/BaseSetup.t.sol";

/// @dev Fuzz tests for RepairShop: cost formula, partial repairs, tier rates, and access control.
contract FuzzRepairShop is BaseSetup {
    address internal alice = makeAddr("alice");

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

        uint256 rate = repairShop.REPAIR_RATES(tier);
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
        assertEq(repairShop.REPAIR_RATES(0), 0,      "Base rate = 0");
        assertEq(repairShop.REPAIR_RATES(1), 5e18,   "Evolved rate = 5");
        assertEq(repairShop.REPAIR_RATES(2), 15e18,  "Elite rate = 15");
        assertEq(repairShop.REPAIR_RATES(3), 40e18,  "Apex rate = 40");
    }
}
