// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DNALib} from "../contracts/libraries/DNALib.sol";

/// @dev Wrapper to expose DNALib internal functions for testing.
contract DNALibHarness {
    function encode(uint8 class_, uint8 legend, uint8 breedType, uint8[18] memory alleles)
        external
        pure
        returns (uint256)
    {
        return DNALib.encode(class_, legend, breedType, alleles);
    }

    function decodeClass(uint256 dna) external pure returns (uint8) {
        return DNALib.decodeClass(dna);
    }

    function decodeLegend(uint256 dna) external pure returns (uint8) {
        return DNALib.decodeLegend(dna);
    }

    function decodeBreedType(uint256 dna) external pure returns (uint8) {
        return DNALib.decodeBreedType(dna);
    }

    function decodeBodyPart(uint256 dna, uint8 slot)
        external
        pure
        returns (uint8 dominant, uint8 r1, uint8 r2)
    {
        return DNALib.decodeBodyPart(dna, slot);
    }

    function decodeAllele(uint8 allele) external pure returns (uint8 classAffinity, uint8 variant) {
        return DNALib.decodeAllele(allele);
    }

    function calculatePurity(uint256 dna) external pure returns (uint8) {
        return DNALib.calculatePurity(dna);
    }

    function isValid(uint256 dna) external pure returns (bool) {
        return DNALib.isValid(dna);
    }
}

contract DNALibTest is Test {
    DNALibHarness harness;

    function setUp() public {
        harness = new DNALibHarness();
    }

    // ──────────── Helpers ────────────

    /// @dev Create alleles where all 18 alleles have the same class affinity and variant.
    function _uniformAlleles(uint8 affinity, uint8 variant) internal pure returns (uint8[18] memory alleles) {
        uint8 allele = (affinity << 4) | variant;
        for (uint256 i = 0; i < 18; i++) {
            alleles[i] = allele;
        }
    }

    /// @dev Create alleles where dominant alleles (indices 0, 3, 6, 9, 12, 15) have the given affinity.
    function _dominantsMatching(uint8 affinity, uint8 numMatching) internal pure returns (uint8[18] memory alleles) {
        // Fill all with non-matching affinity (e.g., affinity + 1, wrapping)
        uint8 otherAffinity = (affinity + 1) % 10;
        for (uint256 i = 0; i < 18; i++) {
            alleles[i] = (otherAffinity << 4) | 0x05;
        }
        // Set the first numMatching dominant alleles to matching affinity
        for (uint256 i = 0; i < numMatching; i++) {
            alleles[i * 3] = (affinity << 4) | 0x0A;
        }
    }

    // ──────────── Encode/Decode Roundtrip ────────────

    function test_encodeDecodeRoundtrip() public view {
        uint8[18] memory alleles = _uniformAlleles(3, 7); // class affinity 3, variant 7
        uint256 dna = harness.encode(5, 1, 42, alleles);

        assertEq(harness.decodeClass(dna), 5);
        assertEq(harness.decodeLegend(dna), 1);
        assertEq(harness.decodeBreedType(dna), 42);

        for (uint8 slot = 0; slot < 6; slot++) {
            (uint8 d, uint8 r1, uint8 r2) = harness.decodeBodyPart(dna, slot);
            assertEq(d, 0x37); // affinity=3, variant=7
            assertEq(r1, 0x37);
            assertEq(r2, 0x37);
        }
    }

    // ──────────── Class Encoding ────────────

    function test_allValidClasses() public view {
        uint8[18] memory alleles = _uniformAlleles(0, 0);
        for (uint8 c = 0; c < 10; c++) {
            uint256 dna = harness.encode(c, 0, 0, alleles);
            assertEq(harness.decodeClass(dna), c);
        }
    }

    function test_invalidClassReverts() public {
        uint8[18] memory alleles = _uniformAlleles(0, 0);
        vm.expectRevert(abi.encodeWithSelector(DNALib.InvalidClass.selector, 10));
        harness.encode(10, 0, 0, alleles);
    }

    // ──────────── Legend Encoding ────────────

    function test_allValidLegends() public view {
        uint8[18] memory alleles = _uniformAlleles(0, 0);
        for (uint8 l = 0; l <= 3; l++) {
            uint256 dna = harness.encode(0, l, 0, alleles);
            assertEq(harness.decodeLegend(dna), l);
        }
    }

    function test_invalidLegendReverts() public {
        uint8[18] memory alleles = _uniformAlleles(0, 0);
        vm.expectRevert(abi.encodeWithSelector(DNALib.InvalidLegend.selector, 4));
        harness.encode(0, 4, 0, alleles);
    }

    // ──────────── Breed Type Encoding ────────────

    function test_breedTypeBoundary() public view {
        uint8[18] memory alleles = _uniformAlleles(0, 0);
        uint256 dna = harness.encode(0, 0, 63, alleles);
        assertEq(harness.decodeBreedType(dna), 63);
    }

    function test_invalidBreedTypeReverts() public {
        uint8[18] memory alleles = _uniformAlleles(0, 0);
        vm.expectRevert(abi.encodeWithSelector(DNALib.InvalidBreedType.selector, 64));
        harness.encode(0, 0, 64, alleles);
    }

    // ──────────── Body Part Decoding ────────────

    function test_distinctAllelesPerPart() public view {
        uint8[18] memory alleles;
        // Slot 0: D=0x01, R1=0x02, R2=0x03
        alleles[0] = 0x01;
        alleles[1] = 0x02;
        alleles[2] = 0x03;
        // Slot 5: D=0x91, R1=0x92, R2=0x93
        alleles[15] = 0x91;
        alleles[16] = 0x92;
        alleles[17] = 0x93;
        // Fill remaining with valid alleles
        for (uint256 i = 3; i < 15; i++) {
            alleles[i] = 0x00;
        }

        uint256 dna = harness.encode(0, 0, 0, alleles);

        (uint8 d0, uint8 r1_0, uint8 r2_0) = harness.decodeBodyPart(dna, 0);
        assertEq(d0, 0x01);
        assertEq(r1_0, 0x02);
        assertEq(r2_0, 0x03);

        (uint8 d5, uint8 r1_5, uint8 r2_5) = harness.decodeBodyPart(dna, 5);
        assertEq(d5, 0x91);
        assertEq(r1_5, 0x92);
        assertEq(r2_5, 0x93);
    }

    function test_invalidBodyPartSlotReverts() public {
        vm.expectRevert(abi.encodeWithSelector(DNALib.InvalidBodyPartSlot.selector, 6));
        harness.decodeBodyPart(0, 6);
    }

    // ──────────── Allele Decoding ────────────

    function test_decodeAllele() public view {
        (uint8 affinity, uint8 variant) = harness.decodeAllele(0x5A);
        assertEq(affinity, 5);
        assertEq(variant, 10);
    }

    function test_decodeAlleleBoundary() public view {
        (uint8 affinity, uint8 variant) = harness.decodeAllele(0x9F);
        assertEq(affinity, 9);
        assertEq(variant, 15);
    }

    function test_decodeAlleleZero() public view {
        (uint8 affinity, uint8 variant) = harness.decodeAllele(0x00);
        assertEq(affinity, 0);
        assertEq(variant, 0);
    }

    // ──────────── Purity ────────────

    function test_purityAllMatching() public view {
        // Class 2, all dominant alleles have affinity 2
        uint8[18] memory alleles = _dominantsMatching(2, 6);
        uint256 dna = harness.encode(2, 0, 0, alleles);
        assertEq(harness.calculatePurity(dna), 6);
    }

    function test_purityNoneMatching() public view {
        // Class 0, all dominant alleles have affinity 1
        uint8[18] memory alleles = _dominantsMatching(0, 0);
        uint256 dna = harness.encode(0, 0, 0, alleles);
        assertEq(harness.calculatePurity(dna), 0);
    }

    function test_purityPartialMatching() public view {
        // Class 4, 3 dominant alleles matching
        uint8[18] memory alleles = _dominantsMatching(4, 3);
        uint256 dna = harness.encode(4, 0, 0, alleles);
        assertEq(harness.calculatePurity(dna), 3);
    }

    function test_purityRecessiveDontCount() public view {
        // Class 0, dominant has affinity 1, but R1 has affinity 0
        uint8[18] memory alleles;
        for (uint256 i = 0; i < 18; i++) {
            alleles[i] = 0x10; // affinity 1, variant 0
        }
        // Set R1 of slot 0 to affinity 0 — should NOT count
        alleles[1] = 0x00;
        uint256 dna = harness.encode(0, 0, 0, alleles);
        assertEq(harness.calculatePurity(dna), 0); // dominants are all affinity 1, class is 0
    }

    // ──────────── Validation ────────────

    function test_isValidWithValidDNA() public view {
        uint8[18] memory alleles = _uniformAlleles(5, 8);
        uint256 dna = harness.encode(9, 0, 10, alleles);
        assertTrue(harness.isValid(dna));
    }

    function test_isValidInvalidClass() public view {
        // Manually construct DNA with class=15 (invalid)
        uint256 dna = uint256(15) << 252;
        assertFalse(harness.isValid(dna));
    }

    function test_isValidInvalidAlleleAffinity() public view {
        // Manually construct DNA with class=0 but one allele with affinity=10
        uint8[18] memory alleles = _uniformAlleles(0, 0);
        uint256 dna = harness.encode(0, 0, 0, alleles);
        // Now manually poke an allele with affinity=10 (0xA0) at the first allele position (bit 232)
        dna |= uint256(0xA0) << 232;
        // Clear the original allele at that position first
        dna &= ~(uint256(0xFF) << 232);
        dna |= uint256(0xA0) << 232;
        assertFalse(harness.isValid(dna));
    }

    // ──────────── Fuzz Tests ────────────

    function testFuzz_encodeDecodeClassRoundtrip(uint8 class_) public view {
        class_ = uint8(bound(class_, 0, 9));
        uint8[18] memory alleles = _uniformAlleles(0, 0);
        uint256 dna = harness.encode(class_, 0, 0, alleles);
        assertEq(harness.decodeClass(dna), class_);
    }

    function testFuzz_purityBounds(uint256 dna) public view {
        // Ensure DNA has valid class for the test to make sense
        // If class >= 10, purity calc still works but isValid would fail
        if (!harness.isValid(dna)) return;
        uint8 purity = harness.calculatePurity(dna);
        assertLe(purity, 6);
    }

    function testFuzz_encodeDecodeRoundtrip(
        uint8 class_,
        uint8 legend,
        uint8 breedType
    ) public view {
        class_ = uint8(bound(class_, 0, 9));
        legend = uint8(bound(legend, 0, 3));
        breedType = uint8(bound(breedType, 0, 63));
        uint8[18] memory alleles = _uniformAlleles(class_, 5);
        uint256 dna = harness.encode(class_, legend, breedType, alleles);
        assertEq(harness.decodeClass(dna), class_);
        assertEq(harness.decodeLegend(dna), legend);
        assertEq(harness.decodeBreedType(dna), breedType);
        assertTrue(harness.isValid(dna));
    }
}
