// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import "../helpers/BaseSetup.t.sol";

/// @dev Fuzz tests for EvolutionLab: tier progression, fuel validation, cost, and duplicate-id guards.
contract FuzzEvolutionLab is BaseSetup {
    address internal alice = makeAddr("alice");

    function _doEvolve(uint256 target, uint256 fuel1, uint256 fuel2) internal {
        vm.startPrank(alice);
        claw.approve(address(evolutionLab), type(uint256).max);
        evolutionLab.evolve(target, fuel1, fuel2);
        vm.stopPrank();
    }

    // ── Tier increases by 1 ───────────────────────────────────────

    function test_evolve_increases_tier_by_one() public {
        uint256 target = _mintLobster(alice, 0);
        uint256 fuel1  = _mintLobster(alice, 1);
        uint256 fuel2  = _mintLobster(alice, 2);
        _giveClaw(alice, 10_000e18);

        assertEq(nft.getEvolutionTier(target), 0);
        _doEvolve(target, fuel1, fuel2);
        assertEq(nft.getEvolutionTier(target), 1, "tier should be 1 after Base to Evolved");
    }

    function test_evolve_full_chain() public {
        // Base → Evolved → Elite → Apex requires 2+4+8 = 14 fuel lobsters
        _giveClaw(alice, 2_000_000e18);

        // Create target
        uint256 target = _mintLobster(alice, 0);

        // Base→Evolved: burn 2 Base fuel
        uint256 f1 = _mintLobster(alice, 1);
        uint256 f2 = _mintLobster(alice, 2);
        _doEvolve(target, f1, f2);
        assertEq(nft.getEvolutionTier(target), 1);

        // Evolved→Elite: burn 2 Evolved fuel
        uint256 f3 = _mintLobster(alice, 3);
        uint256 f4 = _mintLobster(alice, 4);
        vm.prank(admin); nft.setEvolutionTier(f3, 1);
        vm.prank(admin); nft.setEvolutionTier(f4, 1);
        _doEvolve(target, f3, f4);
        assertEq(nft.getEvolutionTier(target), 2);

        // Elite→Apex: burn 2 Elite fuel
        uint256 f5 = _mintLobster(alice, 5);
        uint256 f6 = _mintLobster(alice, 6);
        vm.prank(admin); nft.setEvolutionTier(f5, 2);
        vm.prank(admin); nft.setEvolutionTier(f6, 2);
        _doEvolve(target, f5, f6);
        assertEq(nft.getEvolutionTier(target), 3, "Apex tier");
    }

    // ── Apex cannot evolve further ────────────────────────────────

    function test_max_tier_reverts() public {
        uint256 target = _mintLobster(alice, 0);
        uint256 fuel1  = _mintLobster(alice, 1);
        uint256 fuel2  = _mintLobster(alice, 2);
        _giveClaw(alice, 2_000_000e18);

        // Set target to Apex directly for speed
        vm.prank(admin);
        nft.setEvolutionTier(target, 3);

        vm.startPrank(alice);
        claw.approve(address(evolutionLab), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(EvolutionLab.AlreadyMaxTier.selector, target));
        evolutionLab.evolve(target, fuel1, fuel2);
        vm.stopPrank();
    }

    // ── Fuel tier must match target tier ─────────────────────────

    function testFuzz_wrong_fuel_tier_reverts(uint8 targetTier, uint8 fuelTier) public {
        targetTier = uint8(bound(targetTier, 0, 2));
        // Fuel tier != targetTier
        fuelTier = uint8(bound(fuelTier, 0, 2));
        vm.assume(fuelTier != targetTier);

        uint256 target = _mintLobster(alice, 0);
        uint256 fuel1  = _mintLobster(alice, 1);
        uint256 fuel2  = _mintLobster(alice, 2);
        _giveClaw(alice, 2_000_000e18);

        vm.prank(admin); nft.setEvolutionTier(target, targetTier);
        vm.prank(admin); nft.setEvolutionTier(fuel1, fuelTier);
        vm.prank(admin); nft.setEvolutionTier(fuel2, fuelTier);

        vm.startPrank(alice);
        claw.approve(address(evolutionLab), type(uint256).max);
        vm.expectRevert(); // InvalidFuelTier
        evolutionLab.evolve(target, fuel1, fuel2);
        vm.stopPrank();
    }

    // ── Duplicate IDs reverts ─────────────────────────────────────

    function test_target_same_as_fuel1_reverts() public {
        uint256 target = _mintLobster(alice, 0);
        uint256 fuel2  = _mintLobster(alice, 2);
        _giveClaw(alice, 10_000e18);

        vm.startPrank(alice);
        claw.approve(address(evolutionLab), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(EvolutionLab.DuplicateId.selector, target));
        evolutionLab.evolve(target, target, fuel2);
        vm.stopPrank();
    }

    function test_target_same_as_fuel2_reverts() public {
        uint256 target = _mintLobster(alice, 0);
        uint256 fuel1  = _mintLobster(alice, 1);
        _giveClaw(alice, 10_000e18);

        vm.startPrank(alice);
        claw.approve(address(evolutionLab), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(EvolutionLab.DuplicateId.selector, target));
        evolutionLab.evolve(target, fuel1, target);
        vm.stopPrank();
    }

    function test_fuel1_same_as_fuel2_reverts() public {
        uint256 target = _mintLobster(alice, 0);
        uint256 fuel1  = _mintLobster(alice, 1);
        _giveClaw(alice, 10_000e18);

        vm.startPrank(alice);
        claw.approve(address(evolutionLab), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(EvolutionLab.DuplicateId.selector, fuel1));
        evolutionLab.evolve(target, fuel1, fuel1);
        vm.stopPrank();
    }

    // ── Fuel lobsters burned ──────────────────────────────────────

    function test_fuel_lobsters_burned() public {
        uint256 target = _mintLobster(alice, 0);
        uint256 fuel1  = _mintLobster(alice, 1);
        uint256 fuel2  = _mintLobster(alice, 2);
        _giveClaw(alice, 10_000e18);

        assertTrue(nft.exists(fuel1));
        assertTrue(nft.exists(fuel2));

        _doEvolve(target, fuel1, fuel2);

        assertFalse(nft.exists(fuel1), "fuel1 should be burned");
        assertFalse(nft.exists(fuel2), "fuel2 should be burned");
    }

    // ── Locked target reverts ─────────────────────────────────────

    function test_locked_target_reverts() public {
        uint256 target = _mintLobster(alice, 0);
        uint256 fuel1  = _mintLobster(alice, 1);
        uint256 fuel2  = _mintLobster(alice, 2);
        _giveClaw(alice, 10_000e18);

        // Lock target via team
        uint256 extra1 = _mintLobster(alice, 3);
        uint256 extra2 = _mintLobster(alice, 4);
        vm.prank(alice);
        teamMgr.createTeam([target, extra1, extra2]);

        vm.startPrank(alice);
        claw.approve(address(evolutionLab), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(EvolutionLab.LobsterIsLocked.selector, target));
        evolutionLab.evolve(target, fuel1, fuel2);
        vm.stopPrank();
    }

    // ── Evolution costs match spec ────────────────────────────────

    function testFuzz_evolution_cost_correct(uint8 tier) public view {
        tier = uint8(bound(tier, 0, 2));
        uint256[3] memory costs = [uint256(2_000e18), 10_000e18, 50_000e18];
        assertEq(evolutionLab.EVOLUTION_COSTS(tier), costs[tier]);
    }

    // ── Not-owner reverts ─────────────────────────────────────────

    function test_not_owner_target_reverts() public {
        address bob = makeAddr("bob");
        uint256 target = _mintLobster(alice, 0); // alice owns
        uint256 fuel1  = _mintLobster(bob, 1);
        uint256 fuel2  = _mintLobster(bob, 2);
        _giveClaw(bob, 10_000e18);

        vm.startPrank(bob);
        claw.approve(address(evolutionLab), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(EvolutionLab.NotLobsterOwner.selector, target));
        evolutionLab.evolve(target, fuel1, fuel2);
        vm.stopPrank();
    }
}
