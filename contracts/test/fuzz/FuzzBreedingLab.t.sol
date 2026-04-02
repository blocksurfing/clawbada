// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import "../helpers/BaseSetup.t.sol";

/// @dev Fuzz tests for BreedingLab: cost formula, cooldown, breed limit, offspring properties.
contract FuzzBreedingLab is BaseSetup {
    address internal alice = makeAddr("alice");

    // Helper: approve treasury + breed
    function _breed(address caller, uint256 parentA, uint256 parentB) internal returns (uint256) {
        vm.startPrank(caller);
        claw.approve(address(breedingLab), type(uint256).max);
        uint256 offspringId = breedingLab.breed(parentA, parentB);
        vm.stopPrank();
        return offspringId;
    }

    // ── Breed cost formula ────────────────────────────────────────

    /// @dev cost = BASE_BREED_COST × multiplier[breedCount] / 10 × (3/2)^generation
    function testFuzz_breed_cost_per_parent(uint8 breedCount, uint8 generation) public view {
        breedCount = uint8(bound(breedCount, 0, 4)); // 0-4 valid for next breed
        generation = uint8(bound(generation, 0, 10)); // cap to avoid intentional revert from overflow

        uint256[5] memory multipliers = [uint256(10), 15, 25, 40, 80];
        uint256 expected = breedingLab.BASE_BREED_COST() * multipliers[breedCount] / 10;
        for (uint256 i = 0; i < generation; i++) {
            expected = expected * 3 / 2;
        }

        uint256 actual = breedingLab.getBreedCostPerParent(breedCount, generation);
        assertEq(actual, expected, "breed cost formula mismatch");
    }

    // ── Same parent reverts ───────────────────────────────────────

    function test_same_parent_reverts() public {
        uint256 parentA = _mintLobster(alice, 0);
        _giveClaw(alice, 10_000e18);

        vm.startPrank(alice);
        claw.approve(address(breedingLab), type(uint256).max);
        vm.expectRevert(BreedingLab.SameParent.selector);
        breedingLab.breed(parentA, parentA);
        vm.stopPrank();
    }

    // ── Offspring properties ──────────────────────────────────────

    function test_offspring_is_base_tier_not_soulbound() public {
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        _giveClaw(alice, 10_000e18);

        uint256 offspringId = _breed(alice, parentA, parentB);

        // Offspring must be Base tier (0) and not soulbound
        assertEq(nft.getEvolutionTier(offspringId), 0, "offspring must be Base tier");
        assertFalse(nft.isSoulbound(offspringId), "offspring must not be soulbound");
        assertEq(nft.getDamage(offspringId), 0, "offspring starts with 0 damage");
        assertEq(nft.getBreedCount(offspringId), 0, "offspring starts with 0 breed count");
    }

    function test_offspring_generation() public {
        uint256 parentA = _mintLobster(alice, 0); // gen 0
        uint256 parentB = _mintLobster(alice, 1); // gen 0
        _giveClaw(alice, 10_000e18);

        uint256 offspringId = _breed(alice, parentA, parentB);

        // max(0, 0) + 1 = 1
        assertEq(nft.getGeneration(offspringId), 1, "gen = max(parentA, parentB) + 1");
    }

    function test_parent_breed_count_increments() public {
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        _giveClaw(alice, 50_000e18);

        uint8 countA0 = nft.getBreedCount(parentA);
        uint8 countB0 = nft.getBreedCount(parentB);

        _breed(alice, parentA, parentB);

        assertEq(nft.getBreedCount(parentA), countA0 + 1, "parentA breed count");
        assertEq(nft.getBreedCount(parentB), countB0 + 1, "parentB breed count");
    }

    // ── Breed limit ───────────────────────────────────────────────

    function test_breed_limit_enforced() public {
        uint256 parentA = _mintLobster(alice, 0);
        _giveClaw(alice, 1_000_000e18);

        // Breed parentA 5 times with different partners (need fresh partners each time due to cooldown)
        // We skip cooldown by warping and use fresh partners
        for (uint256 i = 0; i < 5; i++) {
            uint256 partner = _mintLobster(alice, 1);
            vm.warp(block.timestamp + 48 hours + 1);
            _breed(alice, parentA, partner);
        }

        assertEq(nft.getBreedCount(parentA), 5);

        // 6th breed should fail — need a fresh partner too
        uint256 freshPartner = _mintLobster(alice, 2);
        vm.warp(block.timestamp + 48 hours + 1);

        vm.startPrank(alice);
        claw.approve(address(breedingLab), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(BreedingLab.BreedLimitReached.selector, parentA));
        breedingLab.breed(parentA, freshPartner);
        vm.stopPrank();
    }

    // ── Cooldown enforcement ──────────────────────────────────────

    function test_cooldown_enforced() public {
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        uint256 parentC = _mintLobster(alice, 2);
        _giveClaw(alice, 100_000e18);

        _breed(alice, parentA, parentB);

        // Trying to breed parentA again within cooldown should revert
        vm.startPrank(alice);
        claw.approve(address(breedingLab), type(uint256).max);
        vm.expectRevert(); // BreedOnCooldown
        breedingLab.breed(parentA, parentC);
        vm.stopPrank();
    }

    function test_breed_allowed_after_cooldown() public {
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        uint256 parentC = _mintLobster(alice, 2);
        _giveClaw(alice, 100_000e18);

        _breed(alice, parentA, parentB);

        vm.warp(block.timestamp + breedingLab.BREED_COOLDOWN() + 1);

        // Should succeed after cooldown
        _breed(alice, parentA, parentC);
    }

    // ── Locked lobster cannot breed ───────────────────────────────

    function test_locked_parent_reverts() public {
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        _giveClaw(alice, 10_000e18);

        // Lock parentA via TeamManager (creating a team)
        uint256 extra1 = _mintLobster(alice, 2);
        uint256 extra2 = _mintLobster(alice, 3);
        vm.prank(alice);
        teamMgr.createTeam([parentA, extra1, extra2]);

        assertTrue(nft.isLocked(parentA));

        vm.startPrank(alice);
        claw.approve(address(breedingLab), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(BreedingLab.LobsterIsLocked.selector, parentA));
        breedingLab.breed(parentA, parentB);
        vm.stopPrank();
    }

    // ── Not owner reverts ─────────────────────────────────────────

    function test_not_owner_reverts() public {
        address bob = makeAddr("bob");
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        _giveClaw(bob, 10_000e18);

        vm.startPrank(bob);
        claw.approve(address(breedingLab), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(BreedingLab.NotLobsterOwner.selector, parentA));
        breedingLab.breed(parentA, parentB);
        vm.stopPrank();
    }

    // ── cooldown end view ─────────────────────────────────────────

    function test_cooldown_end_is_zero_before_breed() public view {
        // For a fresh lobster never bred, cooldownEnd should be 0
        // (since _lastBreedTime[id] = 0)
        // We can't mint here (view), but check fresh mapping behavior via getBreedCostPerParent
        assertEq(breedingLab.getCooldownEnd(999_999), 0, "unbreed lobster cooldown = 0");
    }
}
