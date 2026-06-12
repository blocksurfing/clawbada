// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import "../helpers/BaseSetup.t.sol";

/// @dev Fuzz tests for BreedingLab: cost formula, cooldown, breed limit, offspring properties.
contract FuzzBreedingLab is BaseSetup {
    address internal alice = makeAddr("alice");

    // Helper: approve treasury + 2-step breed (requestBreed + roll + finalizeBreed).
    // finalizeBreed is permissionless so we don't re-prank for it.
    function _breed(address caller, uint256 parentA, uint256 parentB) internal returns (uint256) {
        vm.startPrank(caller);
        claw.approve(address(breedingLab), type(uint256).max);
        uint256 requestId = breedingLab.requestBreed(parentA, parentB);
        vm.stopPrank();
        vm.roll(block.number + breedingLab.FINALIZE_MIN_BLOCKS() + 1);
        return breedingLab.finalizeBreed(requestId);
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

    /// @dev F5-03: a maxed-out parent reports breedCount == MAX_BREEDS (a legit on-chain
    ///      value). Pricing its hypothetical next breed must give a clean domain error, not
    ///      an array-out-of-bounds Panic(0x32).
    function test_F5_03_breedCost_atOrAboveMaxBreeds_revertsCleanly() public {
        uint8 maxed = uint8(breedingLab.MAX_BREEDS()); // 5

        vm.expectRevert(abi.encodeWithSelector(BreedingLab.BreedCountOutOfRange.selector, maxed));
        breedingLab.getBreedCostPerParent(maxed, 0);

        // Anything above MAX_BREEDS up to type(uint8).max also reverts cleanly (not a panic).
        vm.expectRevert(abi.encodeWithSelector(BreedingLab.BreedCountOutOfRange.selector, uint8(255)));
        breedingLab.getBreedCostPerParent(255, 3);

        // Boundary: the highest valid count (MAX_BREEDS - 1 == 4) still prices fine (×8 tier).
        uint256 cost = breedingLab.getBreedCostPerParent(maxed - 1, 0);
        assertEq(cost, breedingLab.BASE_BREED_COST() * 80 / 10, "breedCount 4 prices at x8");
    }

    // ── Same parent reverts ───────────────────────────────────────

    function test_same_parent_reverts() public {
        uint256 parentA = _mintLobster(alice, 0);
        _giveClaw(alice, 10_000e18);

        vm.startPrank(alice);
        claw.approve(address(breedingLab), type(uint256).max);
        vm.expectRevert(BreedingLab.SameParent.selector);
        breedingLab.requestBreed(parentA, parentA);
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
        breedingLab.requestBreed(parentA, freshPartner);
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
        breedingLab.requestBreed(parentA, parentC);
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
        breedingLab.requestBreed(parentA, parentB);
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
        breedingLab.requestBreed(parentA, parentB);
        vm.stopPrank();
    }

    // ── cooldown end view ─────────────────────────────────────────

    function test_cooldown_end_is_zero_before_breed() public view {
        // For a fresh lobster never bred, cooldownEnd should be 0
        // (since _lastBreedTime[id] = 0)
        // We can't mint here (view), but check fresh mapping behavior via getBreedCostPerParent
        assertEq(breedingLab.getCooldownEnd(999_999), 0, "unbreed lobster cooldown = 0");
    }

    // ─────────────────────────────────────────────────────────────
    // Phase 2 BreedingLab pass — 2-step flow coverage
    // ─────────────────────────────────────────────────────────────

    // Helper: drive requestBreed + return (requestId, parentA, parentB).
    function _requestBreed(address caller, uint256 parentA, uint256 parentB) internal returns (uint256 reqId) {
        vm.startPrank(caller);
        claw.approve(address(breedingLab), type(uint256).max);
        reqId = breedingLab.requestBreed(parentA, parentB);
        vm.stopPrank();
    }

    // finalizeBreed is permissionless: anyone can call it, but offspring
    // is minted to the original requester.
    function test_finalize_permissionless_mintsToRequester() public {
        address randoCaller = makeAddr("rando");
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        _giveClaw(alice, 10_000e18);

        uint256 reqId = _requestBreed(alice, parentA, parentB);
        vm.roll(block.number + breedingLab.FINALIZE_MIN_BLOCKS() + 1);

        // Rando finalizes — offspring must mint to alice (the requester),
        // not rando.
        vm.prank(randoCaller);
        uint256 offspringId = breedingLab.finalizeBreed(reqId);

        assertEq(nft.ownerOf(offspringId), alice, "offspring minted to requester, not finalizer");
    }

    // finalize before the target block reverts TooEarlyToFinalize.
    function test_finalize_beforeTarget_reverts() public {
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        _giveClaw(alice, 10_000e18);

        uint256 reqId = _requestBreed(alice, parentA, parentB);
        BreedingLab.BreedRequest memory req = breedingLab.getBreedRequest(reqId);

        vm.expectRevert(abi.encodeWithSelector(BreedingLab.TooEarlyToFinalize.selector, reqId, req.targetBlock));
        breedingLab.finalizeBreed(reqId);
    }

    // finalize after the blockhash window (256 blocks) returns 0 reverts
    // RequestExpired, not a bogus hash.
    function test_finalize_afterExpiry_reverts() public {
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        _giveClaw(alice, 10_000e18);

        uint256 reqId = _requestBreed(alice, parentA, parentB);

        // Skip far past the 256-block window.
        vm.roll(block.number + 300);

        vm.expectRevert(abi.encodeWithSelector(BreedingLab.RequestExpired.selector, reqId));
        breedingLab.finalizeBreed(reqId);
    }

    // Double finalize reverts RequestAlreadyFinalized.
    function test_double_finalize_reverts() public {
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        _giveClaw(alice, 10_000e18);

        uint256 reqId = _requestBreed(alice, parentA, parentB);
        vm.roll(block.number + breedingLab.FINALIZE_MIN_BLOCKS() + 1);
        breedingLab.finalizeBreed(reqId);

        vm.expectRevert(abi.encodeWithSelector(BreedingLab.RequestAlreadyFinalized.selector, reqId));
        breedingLab.finalizeBreed(reqId);
    }

    // cancelExpiredRequest happy path: request expires (256+ blocks without
    // finalize), anyone cancels, breed counts on parents decrement.
    function test_cancel_expired_restoresBreedCounts() public {
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        _giveClaw(alice, 10_000e18);

        uint8 countA0 = nft.getBreedCount(parentA);
        uint8 countB0 = nft.getBreedCount(parentB);

        uint256 reqId = _requestBreed(alice, parentA, parentB);

        // Breed counts incremented at request time
        assertEq(nft.getBreedCount(parentA), countA0 + 1, "A incremented at request");
        assertEq(nft.getBreedCount(parentB), countB0 + 1, "B incremented at request");

        // Skip past the 256-block expiry window
        vm.roll(block.number + 300);

        // Anyone can cancel
        address rando = makeAddr("rando-cancel");
        vm.prank(rando);
        breedingLab.cancelExpiredRequest(reqId);

        // Breed counts restored
        assertEq(nft.getBreedCount(parentA), countA0, "A restored");
        assertEq(nft.getBreedCount(parentB), countB0, "B restored");

        // But cooldown NOT restored (documented tradeoff)
        uint256 cooldownEnd = breedingLab.getCooldownEnd(parentA);
        assertGt(cooldownEnd, 0, "cooldown persists after cancel");
    }

    // cancel before the target block reverts TooEarlyToFinalize (cancel
    // reuses the same gate as finalize to prevent griefing).
    function test_cancel_beforeTarget_reverts() public {
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        _giveClaw(alice, 10_000e18);

        uint256 reqId = _requestBreed(alice, parentA, parentB);
        BreedingLab.BreedRequest memory req = breedingLab.getBreedRequest(reqId);

        vm.expectRevert(abi.encodeWithSelector(BreedingLab.TooEarlyToFinalize.selector, reqId, req.targetBlock));
        breedingLab.cancelExpiredRequest(reqId);
    }

    // cancel inside the 256-block finalize window reverts RequestNotExpired.
    function test_cancel_notExpired_reverts() public {
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        _giveClaw(alice, 10_000e18);

        uint256 reqId = _requestBreed(alice, parentA, parentB);

        // At targetBlock + FINALIZE_MIN_BLOCKS + 1, blockhash is still
        // non-zero — request is NOT expired, cancel must revert.
        vm.roll(block.number + breedingLab.FINALIZE_MIN_BLOCKS() + 1);

        vm.expectRevert(abi.encodeWithSelector(BreedingLab.RequestNotExpired.selector, reqId));
        breedingLab.cancelExpiredRequest(reqId);
    }

    // cancel after finalize reverts RequestAlreadyFinalized.
    function test_cancel_afterFinalize_reverts() public {
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        _giveClaw(alice, 10_000e18);

        uint256 reqId = _requestBreed(alice, parentA, parentB);
        vm.roll(block.number + breedingLab.FINALIZE_MIN_BLOCKS() + 1);
        breedingLab.finalizeBreed(reqId);

        vm.roll(block.number + 300);

        vm.expectRevert(abi.encodeWithSelector(BreedingLab.RequestAlreadyFinalized.selector, reqId));
        breedingLab.cancelExpiredRequest(reqId);
    }

    // cancel when a parent has been burned (e.g., used as evolution fuel)
    // must not revert — it should silently skip the decrement for that parent.
    function test_cancel_parentBurned_tolerates() public {
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        _giveClaw(alice, 10_000e18);

        uint256 reqId = _requestBreed(alice, parentA, parentB);

        // Burn parentA via EvolutionLab-role-style burn (admin convenience).
        vm.prank(admin);
        nft.burn(parentA);
        assertFalse(nft.exists(parentA), "parentA burned");

        vm.roll(block.number + 300);
        breedingLab.cancelExpiredRequest(reqId);

        // parentB's breed count decremented; parentA's is gone — function
        // must not revert either way.
        assertEq(nft.getBreedCount(parentB), 0, "surviving parent B restored");
    }

    // Offspring's class must be one of the parent classes.
    function testFuzz_offspring_class_fromParents(uint8 classA, uint8 classB) public {
        classA = uint8(bound(classA, 0, 9));
        classB = uint8(bound(classB, 0, 9));
        vm.assume(classA != classB); // distinct to prove selection happens

        uint256 parentA = _mintLobster(alice, classA);
        uint256 parentB = _mintLobster(alice, classB);
        _giveClaw(alice, 10_000e18);

        uint256 reqId = _requestBreed(alice, parentA, parentB);
        vm.roll(block.number + breedingLab.FINALIZE_MIN_BLOCKS() + 1);
        uint256 offspringId = breedingLab.finalizeBreed(reqId);

        uint256 offspringDna = nft.getDNA(offspringId);
        uint8 offspringClass = DNALib.decodeClass(offspringDna);

        assertTrue(
            offspringClass == classA || offspringClass == classB,
            "offspring class must be one of the parents"
        );
    }

    // Offspring's legend bit is either 0 or 1. At ~0.3% roll rate, a
    // single finalize rarely yields a legend, but the bit must always be
    // valid.
    function test_offspring_legend_bitValid() public {
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        _giveClaw(alice, 10_000e18);

        uint256 reqId = _requestBreed(alice, parentA, parentB);
        vm.roll(block.number + breedingLab.FINALIZE_MIN_BLOCKS() + 1);
        uint256 offspringId = breedingLab.finalizeBreed(reqId);

        uint8 legend = DNALib.decodeLegend(nft.getDNA(offspringId));
        assertTrue(legend == 0 || legend == 1, "legend must be 0 or 1");
    }

    // Cost formula doesn't revert at high generations (up to the
    // MaxGenerationReached gate at 254 → 255).
    function testFuzz_cost_no_overflow_at_high_gen(uint8 generation, uint8 breedCount) public view {
        generation = uint8(bound(generation, 0, 254));
        breedCount = uint8(bound(breedCount, 0, 4));
        // Should not revert for any input within the valid range.
        uint256 cost = breedingLab.getBreedCostPerParent(breedCount, generation);
        assertGt(cost, 0, "cost must be positive");
    }

    // Attempting to breed with both parents at generation 255 reverts
    // MaxGenerationReached. Can't set gen=255 directly through public API,
    // so this is a sanity test on the internal guard.
    //
    // (Skip — we cannot construct a gen-255 parent without a test-helper
    // NFT mutator. Invariant-level coverage handles this via the cost
    // formula test above; the requestBreed guard is a defensive layer.)

    // B-01: at `block.number == targetBlock`, blockhash(T) is still zero.
    // Pre-fix the time-gate used `<`, so both finalize and cancel passed
    // their gates at that block. Cancel then saw blockhash=0 and burned
    // the request, griefing every breed. Post-fix the gate is `<=`, so
    // neither entrypoint opens until the next block.
    function test_B01_cancel_atExactTargetBlock_reverts() public {
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        _giveClaw(alice, 10_000e18);

        uint256 reqId = _requestBreed(alice, parentA, parentB);
        BreedingLab.BreedRequest memory req = breedingLab.getBreedRequest(reqId);

        // Roll to exactly targetBlock (where the grief used to land).
        vm.roll(req.targetBlock);
        address griefer = makeAddr("b01-griefer");

        vm.expectRevert(abi.encodeWithSelector(BreedingLab.TooEarlyToFinalize.selector, reqId, req.targetBlock));
        vm.prank(griefer);
        breedingLab.cancelExpiredRequest(reqId);
    }

    // B-01: finalize at exactly targetBlock also reverts TooEarlyToFinalize
    // (not RequestExpired). The window opens at targetBlock + 1.
    function test_B01_finalize_atExactTargetBlock_reverts() public {
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        _giveClaw(alice, 10_000e18);

        uint256 reqId = _requestBreed(alice, parentA, parentB);
        BreedingLab.BreedRequest memory req = breedingLab.getBreedRequest(reqId);

        vm.roll(req.targetBlock);

        vm.expectRevert(abi.encodeWithSelector(BreedingLab.TooEarlyToFinalize.selector, reqId, req.targetBlock));
        breedingLab.finalizeBreed(reqId);
    }

    // B-01: finalize at targetBlock + 1 succeeds (first valid window).
    function test_B01_finalize_atTargetPlusOne_succeeds() public {
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        _giveClaw(alice, 10_000e18);

        uint256 reqId = _requestBreed(alice, parentA, parentB);
        BreedingLab.BreedRequest memory req = breedingLab.getBreedRequest(reqId);

        vm.roll(req.targetBlock + 1);
        uint256 offspringId = breedingLab.finalizeBreed(reqId);
        assertGt(offspringId, 0, "finalize works at targetBlock + 1");
    }

    // B-03: if BreedingLab loses MINTER_ROLE mid-flow, finalize must
    // revert NotAuthorizedToMint BEFORE consuming the request. Without
    // this pre-flight, the bare try/catch would silently burn the user's
    // request + fee on a role misconfiguration (fail-open).
    function test_B03_missingMinterRole_revertsBeforeConsuming() public {
        uint256 parentA = _mintLobster(alice, 0);
        uint256 parentB = _mintLobster(alice, 1);
        _giveClaw(alice, 10_000e18);

        uint256 reqId = _requestBreed(alice, parentA, parentB);

        // Operator revokes MINTER_ROLE from BreedingLab (misconfiguration).
        vm.startPrank(admin);
        nft.revokeRole(nft.MINTER_ROLE(), address(breedingLab));
        vm.stopPrank();

        vm.roll(block.number + breedingLab.FINALIZE_MIN_BLOCKS() + 1);

        vm.expectRevert(BreedingLab.NotAuthorizedToMint.selector);
        breedingLab.finalizeBreed(reqId);

        // Request is NOT finalized — user can retry after role restored.
        BreedingLab.BreedRequest memory req = breedingLab.getBreedRequest(reqId);
        assertFalse(req.finalized, "request must NOT be consumed on protocol failure");

        // Restore role, finalize now succeeds.
        vm.startPrank(admin);
        nft.grantRole(nft.MINTER_ROLE(), address(breedingLab));
        vm.stopPrank();

        uint256 offspringId = breedingLab.finalizeBreed(reqId);
        assertGt(offspringId, 0, "finalize works after role restored");
    }

    // B-02: a malicious contract-requester that reverts on
    // onERC1155Received cannot roll back finalize. The mint is wrapped in
    // try/catch; the request is consumed (finalized + breed counts burned)
    // and the offspring DNA is emitted via LobsterBredRejected. Attacker
    // cannot use cancelExpiredRequest to refund — request is finalized.
    function test_B02_contractRequester_cannotVetoAndRefund() public {
        MaliciousRequester attacker = new MaliciousRequester(address(nft), address(breedingLab), address(claw));
        _giveClaw(address(attacker), 10_000e18);

        // Mint parents to the attacker contract
        vm.prank(admin);
        uint256 parentA = nft.mint(address(attacker), _pureDNA(0), false);
        vm.prank(admin);
        uint256 parentB = nft.mint(address(attacker), _pureDNA(1), false);

        // Attacker breeds — its own onERC1155Received reverts on all mints.
        uint256 reqId = attacker.requestBreed(parentA, parentB);

        uint8 countAAfterReq = nft.getBreedCount(parentA);
        uint8 countBAfterReq = nft.getBreedCount(parentB);
        assertEq(countAAfterReq, 1, "parent A breed count at request");
        assertEq(countBAfterReq, 1, "parent B breed count at request");

        // Finalize: mint reverts inside the try/catch; request is terminal.
        vm.roll(block.number + breedingLab.FINALIZE_MIN_BLOCKS() + 1);
        uint256 offspringId = breedingLab.finalizeBreed(reqId);
        assertEq(offspringId, 0, "no offspring minted (hook rejected)");

        BreedingLab.BreedRequest memory req = breedingLab.getBreedRequest(reqId);
        assertTrue(req.finalized, "request consumed despite rejection");

        // Attacker can NOT cancel to refund breed counts — request is already
        // finalized. Attack is -EV: fee + breed count both burned.
        vm.roll(block.number + 300);
        vm.expectRevert(abi.encodeWithSelector(BreedingLab.RequestAlreadyFinalized.selector, reqId));
        breedingLab.cancelExpiredRequest(reqId);

        assertEq(nft.getBreedCount(parentA), 1, "breed count NOT refunded");
        assertEq(nft.getBreedCount(parentB), 1, "breed count NOT refunded");
    }
}

/// @dev Contract requester that rejects every ERC-1155 transfer — used to
///      verify B-02. If the receiver hook could veto offspring mints in the
///      pre-fix contract, the attacker could cancel-and-refund the breed count.
contract MaliciousRequester {
    LobsterNFT internal nft;
    BreedingLab internal breedingLab;
    ClawToken internal claw;
    address internal immutable _breedingLab;

    constructor(address nft_, address breedingLab_, address claw_) {
        nft = LobsterNFT(nft_);
        breedingLab = BreedingLab(breedingLab_);
        claw = ClawToken(claw_);
        _breedingLab = breedingLab_;
    }

    function requestBreed(uint256 parentA, uint256 parentB) external returns (uint256) {
        claw.approve(address(breedingLab), type(uint256).max);
        return breedingLab.requestBreed(parentA, parentB);
    }

    // Reject mints whose operator is BreedingLab (the offspring mint from
    // finalizeBreed). Accept admin / other operators so test setup can seed
    // parents before the attack.
    function onERC1155Received(address operator, address, uint256, uint256, bytes calldata)
        external
        view
        returns (bytes4)
    {
        if (operator == _breedingLab) revert("MaliciousRequester: hook revert");
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address operator, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        view
        returns (bytes4)
    {
        if (operator == _breedingLab) revert("MaliciousRequester: batch hook revert");
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }
}
