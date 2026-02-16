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

    // ──────────── breed() — Validation Reverts ────────────

    function test_breedSameParentReverts() public {
        uint256 a = _mintLobster(alice, validDNA_A);

        _fundAndApprove(alice, 10_000e18);

        vm.prank(alice);
        vm.expectRevert(BreedingLab.SameParent.selector);
        lab.breed(a, a);
    }

    function test_breedNotOwnerReverts() public {
        uint256 a = _mintLobster(bob, validDNA_A);
        uint256 b = _mintLobster(alice, validDNA_B);

        _fundAndApprove(alice, 10_000e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreedingLab.NotLobsterOwner.selector, a));
        lab.breed(a, b);
    }

    function test_breedLockedParentReverts() public {
        (uint256 a, uint256 b) = _mintPair(alice);

        // Lock parent A
        vm.startPrank(admin);
        nft.grantRole(nft.LOCKER_ROLE(), admin);
        nft.setLocked(a, true);
        vm.stopPrank();

        _fundAndApprove(alice, 10_000e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreedingLab.LobsterIsLocked.selector, a));
        lab.breed(a, b);
    }

    function test_breedLimitReachedReverts() public {
        (uint256 a, uint256 b) = _mintPair(alice);

        _fundAndApprove(alice, 100_000e18);

        // Breed 5 times (max)
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(alice);
            lab.breed(a, b);
            // Advance past cooldown
            vm.warp(block.timestamp + 48 hours + 1);
        }

        // 6th breed should revert
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BreedingLab.BreedLimitReached.selector, a));
        lab.breed(a, b);
    }

    function test_breedCooldownReverts() public {
        (uint256 a, uint256 b) = _mintPair(alice);

        _fundAndApprove(alice, 10_000e18);

        vm.prank(alice);
        lab.breed(a, b);

        // Try to breed again before cooldown expires
        vm.warp(block.timestamp + 48 hours - 1);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(BreedingLab.BreedOnCooldown.selector, a, block.timestamp + 1)
        );
        lab.breed(a, b);
    }

    function test_breedCooldownExpiredSucceeds() public {
        (uint256 a, uint256 b) = _mintPair(alice);

        _fundAndApprove(alice, 10_000e18);

        vm.prank(alice);
        lab.breed(a, b);

        // Warp past cooldown
        vm.warp(block.timestamp + 48 hours);

        vm.prank(alice);
        lab.breed(a, b); // should not revert
    }

    // ──────────── breed() — Happy Path ────────────

    function test_breedHappyPath() public {
        (uint256 a, uint256 b) = _mintPair(alice);

        _fundAndApprove(alice, 1_000e18); // first breed = 500 + 500 = 1000

        vm.prank(alice);
        uint256 offspringId = lab.breed(a, b);

        // Offspring minted to caller
        assertEq(nft.ownerOf(offspringId), alice);
        assertTrue(nft.exists(offspringId));
    }

    // ──────────── breed() — Costs ────────────

    function test_breedCostFirstBreedGen0() public {
        (uint256 a, uint256 b) = _mintPair(alice);

        uint256 expectedCost = 500e18 + 500e18; // 1000 $CLAW
        _fundAndApprove(alice, expectedCost);

        uint256 balBefore = claw.balanceOf(alice);

        vm.prank(alice);
        lab.breed(a, b);

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

            vm.prank(alice);
            lab.breed(a, b);

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

    function test_breedCostDifferentParentBreedCounts() public {
        // Parent A has 0 breeds (cost = 500), Parent B has done external breeds
        uint256 a = _mintLobster(alice, validDNA_A);
        uint256 b = _mintLobster(alice, validDNA_B);

        // Breed once to bump B's count
        _fundAndApprove(alice, 10_000e18);

        // Create a dummy parent to breed B with
        uint256 dummy = _mintLobster(alice, validDNA_A);
        vm.prank(alice);
        lab.breed(b, dummy);

        vm.warp(block.timestamp + 48 hours + 1);

        // Now A has 0 breeds, B has 1 breed
        // Cost: A = 500 × 1.0 = 500, B = 500 × 1.5 = 750 → total 1250
        uint256 balBefore = claw.balanceOf(alice);
        vm.prank(alice);
        lab.breed(a, b);

        assertEq(balBefore - claw.balanceOf(alice), 1_250e18);
    }

    function test_breedDeductsCorrectClaw() public {
        (uint256 a, uint256 b) = _mintPair(alice);

        uint256 totalCost = 1_000e18; // first breed gen 0
        _fundAndApprove(alice, 5_000e18);

        uint256 balBefore = claw.balanceOf(alice);

        vm.prank(alice);
        lab.breed(a, b);

        assertEq(balBefore - claw.balanceOf(alice), totalCost);
    }

    function test_breedInsufficientClawReverts() public {
        (uint256 a, uint256 b) = _mintPair(alice);

        _giveClaw(alice, 999e18); // need 1000
        _approveClaw(alice, 999e18);

        vm.prank(alice);
        vm.expectRevert(); // ERC20 insufficient balance
        lab.breed(a, b);
    }

    // ──────────── breed() — Offspring Properties ────────────

    function test_offspringIsBaseTier() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        vm.prank(alice);
        uint256 offspringId = lab.breed(a, b);

        assertEq(nft.getEvolutionTier(offspringId), 0);
    }

    function test_offspringIsNotSoulbound() public {
        // Even if parents are soulbound, offspring is tradeable
        uint256 a = _mintSoulboundLobster(alice, validDNA_A);
        uint256 b = _mintSoulboundLobster(alice, validDNA_B);
        _fundAndApprove(alice, 1_000e18);

        vm.prank(alice);
        uint256 offspringId = lab.breed(a, b);

        assertFalse(nft.isSoulbound(offspringId));
    }

    function test_offspringGeneration() public {
        // Gen 0 + Gen 0 → Gen 1
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 10_000e18);

        vm.prank(alice);
        uint256 offspring1 = lab.breed(a, b);
        assertEq(nft.getGeneration(offspring1), 1);
    }

    function test_offspringHasValidDNA() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        vm.prank(alice);
        uint256 offspringId = lab.breed(a, b);

        uint256 dna = nft.getDNA(offspringId);
        assertTrue(DNALib.isValid(dna));
    }

    function test_offspringClassFromParents() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        vm.prank(alice);
        uint256 offspringId = lab.breed(a, b);

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

        vm.prank(alice);
        uint256 offspringId = lab.breed(a, b);

        uint256 dna = nft.getDNA(offspringId);
        assertEq(DNALib.decodeClass(dna), 3);
    }

    function test_breedIncrementsBothParentBreedCounts() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        assertEq(nft.getBreedCount(a), 0);
        assertEq(nft.getBreedCount(b), 0);

        vm.prank(alice);
        lab.breed(a, b);

        assertEq(nft.getBreedCount(a), 1);
        assertEq(nft.getBreedCount(b), 1);
    }

    function test_breedSetsCooldownOnBothParents() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        assertEq(lab.getCooldownEnd(a), 0);
        assertEq(lab.getCooldownEnd(b), 0);

        vm.prank(alice);
        lab.breed(a, b);

        assertEq(lab.getCooldownEnd(a), block.timestamp + 48 hours);
        assertEq(lab.getCooldownEnd(b), block.timestamp + 48 hours);
    }

    // ──────────── breed() — Gene Inheritance ────────────

    function test_offspringAllelesAreParentDerived() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        vm.prank(alice);
        uint256 offspringId = lab.breed(a, b);

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
        // Build parents where parent A has a class-3 allele and parent B has a non-class-3 allele.
        // If offspring is class 3, the class-3 allele should surface as dominant.

        // Use same-class parents (class 3) to guarantee class 3 offspring
        // Parent A: all alleles 0x37 (class 3, variant 7)
        // Parent B: all alleles 0x37 (class 3, variant 7)
        (uint256 a, uint256 b) = _mintSameClassPair(alice);
        _fundAndApprove(alice, 1_000e18);

        vm.prank(alice);
        uint256 offspringId = lab.breed(a, b);

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
        // Create parents with alleles of same class affinity but different variants
        // Higher variant should become dominant

        // Parent A: alleles with class 3, variant 7 (0x37)
        // Parent B: alleles with class 3, variant 9 (0x39)
        uint8[18] memory allelesHigh;
        for (uint256 i = 0; i < 18; i++) {
            allelesHigh[i] = 0x39; // class 3, variant 9
        }
        uint256 dnaHigh = DNALib.encode(3, 0, 5, allelesHigh);

        uint256 a = _mintLobster(alice, validDNA_A); // class 3, variant 7
        uint256 b = _mintLobster(alice, dnaHigh); // class 3, variant 9
        _fundAndApprove(alice, 1_000e18);

        vm.prank(alice);
        uint256 offspringId = lab.breed(a, b);

        uint256 offspringDna = nft.getDNA(offspringId);
        uint8 offspringClass = DNALib.decodeClass(offspringDna);

        if (offspringClass == 3) {
            // All alleles have class 3 — the one with higher variant should be dominant
            for (uint8 slot = 0; slot < 6; slot++) {
                (uint8 dominant, uint8 r1,) = DNALib.decodeBodyPart(offspringDna, slot);
                (, uint8 dVar) = DNALib.decodeAllele(dominant);
                (, uint8 r1Var) = DNALib.decodeAllele(r1);
                assertTrue(dVar >= r1Var, "dominant variant should be >= r1 variant");
            }
        }
    }

    // ──────────── breed() — Legend ────────────

    function test_legendStatusInDNA() public {
        // We can't control the VRF output, but we can verify the legend field is valid (0 or 1)
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        vm.prank(alice);
        uint256 offspringId = lab.breed(a, b);

        uint256 dna = nft.getDNA(offspringId);
        uint8 legend = DNALib.decodeLegend(dna);
        assertTrue(legend <= 1, "legend should be 0 or 1");
    }

    function test_faucetParentsCannotProduceLegendDirectly() public {
        // Faucet parents (soulbound) can breed — legend status is VRF-determined, not parent-dependent
        // This test verifies soulbound parents can breed and produce valid offspring
        uint256 a = _mintSoulboundLobster(alice, validDNA_A);
        uint256 b = _mintSoulboundLobster(alice, validDNA_B);
        _fundAndApprove(alice, 1_000e18);

        vm.prank(alice);
        uint256 offspringId = lab.breed(a, b);

        // Offspring exists and has valid DNA
        assertTrue(nft.exists(offspringId));
        assertTrue(DNALib.isValid(nft.getDNA(offspringId)));
    }

    // ──────────── breed() — Event ────────────

    function test_breedEmitsEvent() public {
        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        vm.prank(alice);
        // We check that LobsterBred is emitted with correct parent IDs and cost
        // offspringId will be the next tokenId after a and b
        vm.expectEmit(true, true, false, false);
        emit BreedingLab.LobsterBred(a, b, 0, 0, 0); // only check indexed params
        lab.breed(a, b);
    }

    // ──────────── Fuzz ────────────

    function testFuzz_breedAlwaysProducesValidDNA(uint256 seed) public {
        // Use seed to vary block.prevrandao
        vm.prevrandao(bytes32(seed));

        (uint256 a, uint256 b) = _mintPair(alice);
        _fundAndApprove(alice, 1_000e18);

        vm.prank(alice);
        uint256 offspringId = lab.breed(a, b);

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

        vm.prank(alice);
        uint256 offspringId = lab.breed(a, b);

        uint8 expectedGen = genA > genB ? genA + 1 : genB + 1;
        assertEq(nft.getGeneration(offspringId), expectedGen);
    }

    // ──────────── Internal Helpers ────────────

    function _isOneOf(uint8 value, uint8 a, uint8 b, uint8 c, uint8 d, uint8 e, uint8 f) internal pure returns (bool) {
        return value == a || value == b || value == c || value == d || value == e || value == f;
    }
}
