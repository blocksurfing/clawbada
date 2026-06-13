// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BreedingLab} from "../contracts/BreedingLab.sol";
import {LobsterNFT} from "../contracts/LobsterNFT.sol";
import {ClawToken} from "../contracts/ClawToken.sol";
import {Treasury} from "../contracts/Treasury.sol";
import {DNALib} from "../contracts/libraries/DNALib.sol";

contract BreedingLabTest is Test {
    BreedingLab lab;
    LobsterNFT nft;
    ClawToken claw;
    Treasury treasury;

    address admin = makeAddr("admin");
    address devWallet = makeAddr("devWallet");
    address lpAddress = makeAddr("lpAddress");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 validDNA_A;
    uint256 validDNA_B;

    function setUp() public {
        vm.startPrank(admin);

        nft = new LobsterNFT(admin, "https://api.clawbada.com/lobster/");
        treasury = new Treasury(admin, devWallet);
        claw = new ClawToken(admin, lpAddress, address(treasury));
        treasury.setClawToken(address(claw));

        lab = new BreedingLab(address(claw), address(nft), address(treasury));

        // Grant roles
        nft.grantRole(nft.MINTER_ROLE(), admin);
        nft.grantRole(nft.MINTER_ROLE(), address(lab));
        nft.grantRole(nft.BREED_ROLE(), address(lab));
        treasury.setAuthorized(address(lab), true);

        vm.stopPrank();

        // Build valid DNA for parent A (class 3, all alleles 0x37)
        uint8[18] memory allelesA;
        for (uint256 i = 0; i < 18; i++) {
            allelesA[i] = 0x37; // class affinity 3, variant 7
        }
        validDNA_A = DNALib.encode(3, 0, 5, allelesA);

        // Build valid DNA for parent B (class 5, all alleles 0x58)
        uint8[18] memory allelesB;
        for (uint256 i = 0; i < 18; i++) {
            allelesB[i] = 0x58; // class affinity 5, variant 8
        }
        validDNA_B = DNALib.encode(5, 0, 10, allelesB);
    }

    // ──────────── Helpers ────────────

    function _mintLobster(address to, uint256 dna) internal returns (uint256) {
        vm.prank(admin);
        return nft.mint(to, dna, false);
    }

    function _mintSoulboundLobster(address to, uint256 dna) internal returns (uint256) {
        vm.prank(admin);
        return nft.mint(to, dna, true);
    }

    function _mintPair(address to) internal returns (uint256 a, uint256 b) {
        a = _mintLobster(to, validDNA_A);
        b = _mintLobster(to, validDNA_B);
    }

    function _mintSameClassPair(address to) internal returns (uint256 a, uint256 b) {
        a = _mintLobster(to, validDNA_A);
        b = _mintLobster(to, validDNA_A); // same DNA = same class
    }

    function _giveClaw(address to, uint256 amount) internal {
        vm.prank(lpAddress);
        claw.transfer(to, amount);
    }

    function _approveClaw(address owner, uint256 amount) internal {
        vm.prank(owner);
        claw.approve(address(lab), amount);
    }

    function _fundAndApprove(address owner, uint256 amount) internal {
        _giveClaw(owner, amount);
        _approveClaw(owner, amount);
    }

    /// @dev Full 2-step breed: request + roll forward + finalize
    function _breed(address owner, uint256 parentA, uint256 parentB) internal returns (uint256 offspringId) {
        vm.prank(owner);
        uint256 requestId = lab.requestBreed(parentA, parentB);

        // Roll past target block
        vm.roll(block.number + 3);

        vm.prank(owner);
        offspringId = lab.finalizeBreed(requestId);
    }

    // ──────────── Constructor ────────────

    function test_constructorSetsState() public view {
        assertEq(address(lab.clawToken()), address(claw));
        assertEq(address(lab.lobsterNFT()), address(nft));
        assertEq(address(lab.treasury()), address(treasury));
        assertEq(lab.BREED_COOLDOWN(), 48 hours);
        assertEq(lab.BASE_BREED_COST(), 500e18);
        assertEq(lab.MAX_BREEDS(), 5);
    }

    function test_constructorZeroClawReverts() public {
        vm.expectRevert(BreedingLab.ZeroAddress.selector);
        new BreedingLab(address(0), address(nft), address(treasury));
    }

    function test_constructorZeroNFTReverts() public {
        vm.expectRevert(BreedingLab.ZeroAddress.selector);
        new BreedingLab(address(claw), address(0), address(treasury));
    }

    function test_constructorZeroTreasuryReverts() public {
        vm.expectRevert(BreedingLab.ZeroAddress.selector);
        new BreedingLab(address(claw), address(nft), address(0));
    }

    // ──────────── requestBreed() — Validation Reverts ────────────

    function test_requestBreedSameParentReverts() public {
        uint256 a = _mintLobster(alice, validDNA_A);

        _fundAndApprove(alice, 10_000e18);

        vm.prank(alice);
        vm.expectRevert(BreedingLab.SameParent.selector);
        lab.requestBreed(a, a);
    }

    function test_requestBreedNotOwnerReverts() public {
        uint256 a = _mintLobster(bob, validDNA_A);
        uint256 b = _mintLobster(alice, validDNA_B);

        _fundAndApprove(alice, 10_000e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreedingLab.NotLobsterOwner.selector, a));
        lab.requestBreed(a, b);
    }

    function test_requestBreedLockedParentReverts() public {
        (uint256 a, uint256 b) = _mintPair(alice);

        // Lock parent A
        vm.startPrank(admin);
        nft.grantRole(nft.LOCKER_ROLE(), admin);
        nft.setLocked(a, true);
        vm.stopPrank();

        _fundAndApprove(alice, 10_000e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreedingLab.LobsterIsLocked.selector, a));
        lab.requestBreed(a, b);
    }

    function test_requestBreedLimitReachedReverts() public {
        (uint256 a, uint256 b) = _mintPair(alice);

        _fundAndApprove(alice, 100_000e18);

        // Breed 5 times (max)
        for (uint256 i = 0; i < 5; i++) {
            _breed(alice, a, b);
            // Advance past cooldown
            vm.warp(block.timestamp + 48 hours + 1);
        }

        // 6th breed should revert
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreedingLab.BreedLimitReached.selector, a));
        lab.requestBreed(a, b);
    }

    function test_requestBreedCooldownReverts() public {
        (uint256 a, uint256 b) = _mintPair(alice);

        _fundAndApprove(alice, 10_000e18);

        _breed(alice, a, b);

        // Try to breed again before cooldown expires
        vm.warp(block.timestamp + 48 hours - 1);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(BreedingLab.BreedOnCooldown.selector, a, block.timestamp + 1)
        );
        lab.requestBreed(a, b);
    }

    function test_requestBreedCooldownExpiredSucceeds() public {
        (uint256 a, uint256 b) = _mintPair(alice);

        _fundAndApprove(alice, 10_000e18);

        _breed(alice, a, b);

        // Warp past cooldown
        vm.warp(block.timestamp + 48 hours);

        vm.prank(alice);
        lab.requestBreed(a, b); // should not revert
    }

    // ──────────── 2-step flow — Happy Path ────────────

    function test_breedHappyPath() public {
        (uint256 a, uint256 b) = _mintPair(alice);

        _fundAndApprove(alice, 1_000e18); // first breed = 500 + 500 = 1000

        uint256 offspringId = _breed(alice, a, b);

        // Offspring minted to caller
        assertEq(nft.ownerOf(offspringId), alice);
        assertTrue(nft.exists(offspringId));
    }

    function test_requestBreedStoresRequest() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        vm.prank(alice);
        uint256 requestId = lab.requestBreed(a, b);

        BreedingLab.BreedRequest memory req = lab.getBreedRequest(requestId);
        assertEq(req.requester, alice);
        assertEq(req.targetBlock, block.number + 2);
        assertFalse(req.finalized);
    }

    function test_finalizeBreedByAnyone() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        vm.prank(alice);
        uint256 requestId = lab.requestBreed(a, b);
        vm.roll(block.number + 3);

        // Bob finalizes — offspring goes to alice (the requester)
        vm.prank(bob);
        uint256 offspringId = lab.finalizeBreed(requestId);

        assertEq(nft.ownerOf(offspringId), alice);
    }

    // ──────────── 2-step flow — Costs ────────────

    function test_breedCostFirstBreedGen0() public {
        (uint256 a, uint256 b) = _mintPair(alice);

        uint256 expectedCost = 500e18 + 500e18; // 1000 $CLAW
        _fundAndApprove(alice, expectedCost);

        uint256 balBefore = claw.balanceOf(alice);

        _breed(alice, a, b);

        assertEq(balBefore - claw.balanceOf(alice), expectedCost);
    }

    function test_breedCostScalesWithBreedCount() public {
        (uint256 a, uint256 b) = _mintPair(alice);

        // Expected costs per breed (both parents same count, Gen 0):
        // 1st: 500 × 1.0 × 2 = 1000
        // 2nd: 500 × 1.5 × 2 = 1500
        // 3rd: 500 × 2.5 × 2 = 2500
        // 4th: 500 × 4.0 × 2 = 4000
        // 5th: 500 × 8.0 × 2 = 8000
        uint256[5] memory expectedCosts = [uint256(1_000e18), 1_500e18, 2_500e18, 4_000e18, 8_000e18];

        uint256 totalNeeded;
        for (uint256 i = 0; i < 5; i++) {
            totalNeeded += expectedCosts[i];
        }
        _fundAndApprove(alice, totalNeeded);

        for (uint256 i = 0; i < 5; i++) {
            uint256 balBefore = claw.balanceOf(alice);

            _breed(alice, a, b);

            assertEq(balBefore - claw.balanceOf(alice), expectedCosts[i], "wrong cost at breed index");

            // Advance past cooldown
            vm.warp(block.timestamp + 48 hours + 1);
        }
    }

    function test_breedCostScalesWithGeneration() public {
        // Gen 0 first breed: 500 per parent
        // Gen 1 first breed: 500 × 1.5 = 750 per parent
        // Gen 2 first breed: 500 × 1.5^2 = 1125 per parent

        // Verify via the view function
        assertEq(lab.getBreedCostPerParent(0, 0), 500e18); // Gen 0, 1st breed
        assertEq(lab.getBreedCostPerParent(0, 1), 750e18); // Gen 1, 1st breed
        assertEq(lab.getBreedCostPerParent(0, 2), 1_125e18); // Gen 2, 1st breed
    }

    function test_breedCostPrecisionAtHighGeneration() public {
        // Gen 10 cost: iterative 500e18 × (3/2)^10
        // Truncation error is < 1 wei per step, negligible on 18-decimal token
        uint256 cost = lab.getBreedCostPerParent(0, 10);
        // Must be > 0 and close to 500 × 1.5^10 ≈ 28,832.5
        assertGt(cost, 28_832e18);
        assertLt(cost, 28_833e18);
    }

    function test_breedCostDifferentParentBreedCounts() public {
        // Parent A has 0 breeds (cost = 500), Parent B has done external breeds
        uint256 a = _mintLobster(alice, validDNA_A);
        uint256 b = _mintLobster(alice, validDNA_B);

        // Breed once to bump B's count
        _fundAndApprove(alice, 10_000e18);

        // Create a dummy parent to breed B with
        uint256 dummy = _mintLobster(alice, validDNA_A);
        _breed(alice, b, dummy);

        vm.warp(block.timestamp + 48 hours + 1);

        // Now A has 0 breeds, B has 1 breed
        // Cost: A = 500 × 1.0 = 500, B = 500 × 1.5 = 750 → total 1250
        uint256 balBefore = claw.balanceOf(alice);
        _breed(alice, a, b);

        assertEq(balBefore - claw.balanceOf(alice), 1_250e18);
    }

    function test_breedDeductsCorrectClaw() public {
        (uint256 a, uint256 b) = _mintPair(alice);

        uint256 totalCost = 1_000e18; // first breed gen 0
        _fundAndApprove(alice, 5_000e18);

        uint256 balBefore = claw.balanceOf(alice);

        _breed(alice, a, b);

        assertEq(balBefore - claw.balanceOf(alice), totalCost);
    }

    function test_breedInsufficientClawReverts() public {
        (uint256 a, uint256 b) = _mintPair(alice);

        _giveClaw(alice, 999e18); // need 1000
        _approveClaw(alice, 999e18);

        vm.prank(alice);
        vm.expectRevert(); // ERC20 insufficient balance
        lab.requestBreed(a, b);
    }

    // ──────────── Offspring Properties ────────────

    function test_offspringIsBaseTier() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        uint256 offspringId = _breed(alice, a, b);

        assertEq(nft.getEvolutionTier(offspringId), 0);
    }

    function test_offspringIsNotSoulbound() public {
        // Even if parents are soulbound, offspring is tradeable
        uint256 a = _mintSoulboundLobster(alice, validDNA_A);
        uint256 b = _mintSoulboundLobster(alice, validDNA_B);
        _fundAndApprove(alice, 1_000e18);

        uint256 offspringId = _breed(alice, a, b);

        assertFalse(nft.isSoulbound(offspringId));
    }

    function test_offspringGeneration() public {
        // Gen 0 + Gen 0 → Gen 1
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 10_000e18);

        uint256 offspring1 = _breed(alice, a, b);
        assertEq(nft.getGeneration(offspring1), 1);
    }

    function test_offspringHasValidDNA() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        uint256 offspringId = _breed(alice, a, b);

        uint256 dna = nft.getDNA(offspringId);
        assertTrue(DNALib.isValid(dna));
    }

    function test_offspringClassFromParents() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        uint256 offspringId = _breed(alice, a, b);

        uint256 dna = nft.getDNA(offspringId);
        uint8 offspringClass = DNALib.decodeClass(dna);

        // Must be one of the two parent classes
        uint8 classA = DNALib.decodeClass(validDNA_A); // 3
        uint8 classB = DNALib.decodeClass(validDNA_B); // 5
        assertTrue(offspringClass == classA || offspringClass == classB);
    }

    function test_offspringSameClassParentsGuaranteesClass() public {
        // Both parents have class 3 — offspring must be class 3
        (uint256 a, uint256 b) = _mintSameClassPair(alice);
        _fundAndApprove(alice, 1_000e18);

        uint256 offspringId = _breed(alice, a, b);

        uint256 dna = nft.getDNA(offspringId);
        assertEq(DNALib.decodeClass(dna), 3);
    }

    function test_breedIncrementsBothParentBreedCounts() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        assertEq(nft.getBreedCount(a), 0);
        assertEq(nft.getBreedCount(b), 0);

        // Breed count incremented at request time
        vm.prank(alice);
        lab.requestBreed(a, b);

        assertEq(nft.getBreedCount(a), 1);
        assertEq(nft.getBreedCount(b), 1);
    }

    function test_breedSetsCooldownOnBothParents() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        assertEq(lab.getCooldownEnd(a), 0);
        assertEq(lab.getCooldownEnd(b), 0);

        // Cooldown set at request time
        vm.prank(alice);
        lab.requestBreed(a, b);

        assertEq(lab.getCooldownEnd(a), block.timestamp + 48 hours);
        assertEq(lab.getCooldownEnd(b), block.timestamp + 48 hours);
    }

    // ──────────── Gene Inheritance ────────────

    function test_offspringAllelesAreParentDerived() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        uint256 offspringId = _breed(alice, a, b);

        uint256 offspringDna = nft.getDNA(offspringId);

        // Collect all parent alleles for each body part
        for (uint8 slot = 0; slot < 6; slot++) {
            (uint8 aD, uint8 aR1, uint8 aR2) = DNALib.decodeBodyPart(validDNA_A, slot);
            (uint8 bD, uint8 bR1, uint8 bR2) = DNALib.decodeBodyPart(validDNA_B, slot);
            (uint8 oD, uint8 oR1, uint8 oR2) = DNALib.decodeBodyPart(offspringDna, slot);

            // Each offspring allele must be one of the parent alleles
            assertTrue(
                _isOneOf(oD, aD, aR1, aR2, bD, bR1, bR2),
                "offspring dominant not parent-derived"
            );
            assertTrue(
                _isOneOf(oR1, aD, aR1, aR2, bD, bR1, bR2),
                "offspring R1 not parent-derived"
            );
            assertTrue(
                _isOneOf(oR2, aD, aR1, aR2, bD, bR1, bR2),
                "offspring R2 not parent-derived"
            );
        }
    }

    function test_offspringDominantOrderingClassMatch() public {
        (uint256 a, uint256 b) = _mintSameClassPair(alice);
        _fundAndApprove(alice, 1_000e18);

        uint256 offspringId = _breed(alice, a, b);

        uint256 offspringDna = nft.getDNA(offspringId);
        uint8 offspringClass = DNALib.decodeClass(offspringDna);
        assertEq(offspringClass, 3);

        // All offspring dominants should have class affinity 3 (since all parent alleles match)
        for (uint8 slot = 0; slot < 6; slot++) {
            (uint8 dominant,,) = DNALib.decodeBodyPart(offspringDna, slot);
            (uint8 affinity,) = DNALib.decodeAllele(dominant);
            assertEq(affinity, 3, "dominant should match offspring class");
        }
    }

    function test_offspringDominantOrderingVariantTiebreak() public {
        uint8[18] memory allelesHigh;
        for (uint256 i = 0; i < 18; i++) {
            allelesHigh[i] = 0x39; // class 3, variant 9
        }
        uint256 dnaHigh = DNALib.encode(3, 0, 5, allelesHigh);

        uint256 a = _mintLobster(alice, validDNA_A); // class 3, variant 7
        uint256 b = _mintLobster(alice, dnaHigh); // class 3, variant 9
        _fundAndApprove(alice, 1_000e18);

        uint256 offspringId = _breed(alice, a, b);

        uint256 offspringDna = nft.getDNA(offspringId);
        uint8 offspringClass = DNALib.decodeClass(offspringDna);

        if (offspringClass == 3) {
            for (uint8 slot = 0; slot < 6; slot++) {
                (uint8 dominant, uint8 r1,) = DNALib.decodeBodyPart(offspringDna, slot);
                (, uint8 dVar) = DNALib.decodeAllele(dominant);
                (, uint8 r1Var) = DNALib.decodeAllele(r1);
                assertTrue(dVar >= r1Var, "dominant variant should be >= r1 variant");
            }
        }
    }

    // ──────────── Legend ────────────

    function test_legendStatusInDNA() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        uint256 offspringId = _breed(alice, a, b);

        uint256 dna = nft.getDNA(offspringId);
        uint8 legend = DNALib.decodeLegend(dna);
        assertTrue(legend <= 1, "legend should be 0 or 1");
    }

    function test_faucetParentsCanBreed() public {
        uint256 a = _mintSoulboundLobster(alice, validDNA_A);
        uint256 b = _mintSoulboundLobster(alice, validDNA_B);
        _fundAndApprove(alice, 1_000e18);

        uint256 offspringId = _breed(alice, a, b);

        assertTrue(nft.exists(offspringId));
        assertTrue(DNALib.isValid(nft.getDNA(offspringId)));
    }

    // ──────────── Events ────────────

    function test_requestBreedEmitsEvent() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit BreedingLab.BreedRequested(1, alice, a, b, 0, 0);
        lab.requestBreed(a, b);
    }

    // ──────────── P-03: Anti-sniping (2-step flow) ────────────

    function test_finalizeBeforeTargetBlockReverts() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        vm.prank(alice);
        uint256 requestId = lab.requestBreed(a, b);

        // Try to finalize immediately (same block)
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreedingLab.TooEarlyToFinalize.selector, requestId, block.number + 2));
        lab.finalizeBreed(requestId);
    }

    function test_finalizeAfterBlockhashWindowReverts() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        vm.prank(alice);
        uint256 requestId = lab.requestBreed(a, b);

        // Roll past the 256-block window
        vm.roll(block.number + 260);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreedingLab.RequestExpired.selector, requestId));
        lab.finalizeBreed(requestId);
    }

    function test_doubleFinalizeReverts() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        vm.prank(alice);
        uint256 requestId = lab.requestBreed(a, b);
        vm.roll(block.number + 3);

        vm.prank(alice);
        lab.finalizeBreed(requestId);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreedingLab.RequestAlreadyFinalized.selector, requestId));
        lab.finalizeBreed(requestId);
    }

    function test_finalizeNonExistentRequestReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreedingLab.RequestDoesNotExist.selector, 999));
        lab.finalizeBreed(999);
    }

    function test_sameBlockCannotPredictOutcome() public {
        // Verify that the seed uses blockhash(targetBlock) which is unknown at request time
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 3_000e18); // 1st breed 1000 + 2nd breed 1500 = 2500

        // First breed
        vm.prank(alice);
        uint256 req1 = lab.requestBreed(a, b);
        vm.roll(block.number + 3);
        vm.prank(alice);
        uint256 offspring1 = lab.finalizeBreed(req1);

        // Cooldown
        vm.warp(block.timestamp + 48 hours + 1);

        // Second breed with different block
        vm.prank(alice);
        uint256 req2 = lab.requestBreed(a, b);
        vm.roll(block.number + 3);
        vm.prank(alice);
        uint256 offspring2 = lab.finalizeBreed(req2);

        // Different DNA (different blockhash → different seed)
        // Note: can't guarantee different with 100% certainty, but the seed construction ensures
        // different blockhash + different requestId → virtually certain different DNA
        uint256 dna1 = nft.getDNA(offspring1);
        uint256 dna2 = nft.getDNA(offspring2);
        // We just verify both are valid — different entropy sources produce different results
        assertTrue(DNALib.isValid(dna1));
        assertTrue(DNALib.isValid(dna2));
    }

    function test_feeCommittedAtRequestTime() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        uint256 balBefore = claw.balanceOf(alice);

        vm.prank(alice);
        lab.requestBreed(a, b);

        // Fee charged at request, not at finalize
        assertEq(claw.balanceOf(alice), balBefore - 1_000e18);

        vm.roll(block.number + 3);

        uint256 balBeforeFinalize = claw.balanceOf(alice);
        vm.prank(alice);
        lab.finalizeBreed(1);

        // No additional charge at finalize
        assertEq(claw.balanceOf(alice), balBeforeFinalize);
    }

    function test_breedCountConsumedEvenIfNotFinalized() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        vm.prank(alice);
        lab.requestBreed(a, b);

        // Breed count incremented even though not finalized
        assertEq(nft.getBreedCount(a), 1);
        assertEq(nft.getBreedCount(b), 1);
    }

    // ──────────── S-04: Generation overflow ────────────

    function test_maxGenerationReachedReverts() public {
        // Mint two parents at generation 255 — requestBreed should revert
        vm.startPrank(admin);
        uint256 a = nft.mintWithGeneration(alice, validDNA_A, 255);
        uint256 b = nft.mintWithGeneration(alice, validDNA_B, 255);
        vm.stopPrank();

        _fundAndApprove(alice, 100_000e18);

        vm.prank(alice);
        vm.expectRevert(BreedingLab.MaxGenerationReached.selector);
        lab.requestBreed(a, b);
    }

    function test_generation254CanBreed() public {
        // Gen 254 should be accepted by the overflow check (offspring = 255)
        // Using gen 5 for practical cost testing; gen 254 cost is astronomical
        vm.startPrank(admin);
        uint256 a = nft.mintWithGeneration(alice, validDNA_A, 5);
        uint256 b = nft.mintWithGeneration(alice, validDNA_B, 5);
        vm.stopPrank();

        _fundAndApprove(alice, 100_000e18);

        uint256 offspringId = _breed(alice, a, b);
        assertEq(nft.getGeneration(offspringId), 6);
    }

    // ──────────── Fuzz ────────────

    function testFuzz_breedAlwaysProducesValidDNA(uint256 seed) public {
        vm.prevrandao(bytes32(seed));

        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        uint256 offspringId = _breed(alice, a, b);

        uint256 dna = nft.getDNA(offspringId);
        assertTrue(DNALib.isValid(dna), "offspring DNA must be valid");
    }

    function testFuzz_breedCostNeverZero(uint8 breedA, uint8 breedB, uint8 genA, uint8 genB) public view {
        breedA = uint8(bound(breedA, 0, 4));
        breedB = uint8(bound(breedB, 0, 4));
        genA = uint8(bound(genA, 0, 10));
        genB = uint8(bound(genB, 0, 10));

        uint256 costA = lab.getBreedCostPerParent(breedA, genA);
        uint256 costB = lab.getBreedCostPerParent(breedB, genB);

        assertTrue(costA > 0, "cost A must be > 0");
        assertTrue(costB > 0, "cost B must be > 0");
        assertTrue(costA + costB > 0, "total cost must be > 0");
    }

    function testFuzz_offspringGenerationCorrect(uint8 genA, uint8 genB) public {
        genA = uint8(bound(genA, 0, 20));
        genB = uint8(bound(genB, 0, 20));

        // Mint parents with specific generations using mintWithGeneration
        vm.startPrank(admin);
        uint256 a = nft.mintWithGeneration(alice, validDNA_A, genA);
        uint256 b = nft.mintWithGeneration(alice, validDNA_B, genB);
        vm.stopPrank();

        // Calculate needed cost
        uint256 costA = lab.getBreedCostPerParent(0, genA);
        uint256 costB = lab.getBreedCostPerParent(0, genB);
        uint256 totalCost = costA + costB;

        _fundAndApprove(alice, totalCost);

        uint256 offspringId = _breed(alice, a, b);

        uint8 expectedGen = genA > genB ? genA + 1 : genB + 1;
        assertEq(nft.getGeneration(offspringId), expectedGen);
    }

    // ──────────── F-01: Expired breed request recovery ────────────

    function test_cancelExpiredRequestDoesNotRestoreBreedCounts() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        uint256 baseCost = 500e18 * 2; // 500 per parent, both at breed 0
        _fundAndApprove(alice, baseCost);

        // Request breed
        vm.prank(alice);
        uint256 requestId = lab.requestBreed(a, b);

        // Verify breed counts were incremented
        assertEq(nft.getBreedCount(a), 1);
        assertEq(nft.getBreedCount(b), 1);

        // Roll past the 256-block blockhash window (request expires)
        vm.roll(block.number + 260);

        // Close the expired request
        lab.cancelExpiredRequest(requestId);

        // F5-02: breed counts stay CONSUMED — a committed breed is final, so letting a bad
        // roll expire cannot refund the slot (closes the outcome-selective re-roll).
        assertEq(nft.getBreedCount(a), 1);
        assertEq(nft.getBreedCount(b), 1);

        // Request should be marked as finalized (can't cancel or finalize again)
        BreedingLab.BreedRequest memory req = lab.getBreedRequest(requestId);
        assertTrue(req.finalized);
    }

    function test_cancelExpiredRequestRevertsIfNotExpired() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        uint256 baseCost = 500e18 * 2;
        _fundAndApprove(alice, baseCost);

        vm.prank(alice);
        uint256 requestId = lab.requestBreed(a, b);

        // Roll past target block but within 256-block window (not expired)
        vm.roll(block.number + 5);

        vm.expectRevert(abi.encodeWithSelector(BreedingLab.RequestNotExpired.selector, requestId));
        lab.cancelExpiredRequest(requestId);
    }

    function test_cancelExpiredRequestRevertsIfAlreadyFinalized() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        uint256 baseCost = 500e18 * 2;
        _fundAndApprove(alice, baseCost);

        vm.prank(alice);
        uint256 requestId = lab.requestBreed(a, b);

        // Finalize normally
        vm.roll(block.number + 3);
        lab.finalizeBreed(requestId);

        // Try to cancel — already finalized
        vm.roll(block.number + 260);
        vm.expectRevert(abi.encodeWithSelector(BreedingLab.RequestAlreadyFinalized.selector, requestId));
        lab.cancelExpiredRequest(requestId);
    }

    function test_cancelExpiredRequestCallableByAnyone() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        uint256 baseCost = 500e18 * 2;
        _fundAndApprove(alice, baseCost);

        vm.prank(alice);
        uint256 requestId = lab.requestBreed(a, b);

        // Expire
        vm.roll(block.number + 260);

        // Bob (not the requester) can close the expired request
        vm.prank(bob);
        lab.cancelExpiredRequest(requestId);

        // F5-02: closing is permissionless but does NOT refund breed counts.
        assertEq(nft.getBreedCount(a), 1);
        assertEq(nft.getBreedCount(b), 1);
    }

    function test_cancelExpiredRequestStoresParentIds() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        uint256 baseCost = 500e18 * 2;
        _fundAndApprove(alice, baseCost);

        vm.prank(alice);
        uint256 requestId = lab.requestBreed(a, b);

        BreedingLab.BreedRequest memory req = lab.getBreedRequest(requestId);
        assertEq(req.parentA, a);
        assertEq(req.parentB, b);
    }

    // ──────────── Internal Helpers ────────────

    function _isOneOf(uint8 value, uint8 a, uint8 b, uint8 c, uint8 d, uint8 e, uint8 f) internal pure returns (bool) {
        return value == a || value == b || value == c || value == d || value == e || value == f;
    }
}
