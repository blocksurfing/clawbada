// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DNALib} from "../../libraries/DNALib.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Harness — exposes internal DNALib functions as external so vm.expectRevert works
// ─────────────────────────────────────────────────────────────────────────────

contract DNALibHarness {
    function encode(uint8 class_, uint8 legend, uint8 breedType, uint8[18] calldata alleles_)
        external pure returns (uint256)
    {
        uint8[18] memory mem;
        for (uint256 i = 0; i < 18; i++) mem[i] = alleles_[i];
        return DNALib.encode(class_, legend, breedType, mem);
    }

    function decodeBodyPart(uint256 dna, uint8 slot)
        external pure returns (uint8 d, uint8 r1, uint8 r2)
    {
        return DNALib.decodeBodyPart(dna, slot);
    }
}

/// @dev Fuzz tests for DNALib encode/decode, purity, and validity.
contract FuzzDNALib is Test {
    DNALibHarness internal harness;

    function setUp() public {
        harness = new DNALibHarness();
    }

    // ── Helpers ────────────────────────────────────────────────────

    function _validAlleles(uint256 seed) internal pure returns (uint8[18] memory alleles) {
        for (uint256 i = 0; i < 18; i++) {
            uint8 affinity = uint8((seed >> (i * 8)) % 10);
            uint8 variant  = uint8((seed >> (i * 8 + 4)) % 16);
            alleles[i] = (affinity << 4) | variant;
        }
    }

    // ── Encode / Decode roundtrip ──────────────────────────────────

    function testFuzz_encode_decode_roundtrip(
        uint8 class_,
        uint8 legend,
        uint8 breedType,
        uint256 alleleSeed
    ) public pure {
        class_    = uint8(class_    % 10);
        legend    = uint8(legend    % 4);
        breedType = uint8(breedType % 64);

        uint8[18] memory alleles = _validAlleles(alleleSeed);
        uint256 dna = DNALib.encode(class_, legend, breedType, alleles);

        assertEq(DNALib.decodeClass(dna),     class_,    "class roundtrip");
        assertEq(DNALib.decodeLegend(dna),    legend,    "legend roundtrip");
        assertEq(DNALib.decodeBreedType(dna), breedType, "breedType roundtrip");

        for (uint8 slot = 0; slot < 6; slot++) {
            (uint8 d, uint8 r1, uint8 r2) = DNALib.decodeBodyPart(dna, slot);
            assertEq(d,  alleles[slot * 3],     "dominant roundtrip");
            assertEq(r1, alleles[slot * 3 + 1], "r1 roundtrip");
            assertEq(r2, alleles[slot * 3 + 2], "r2 roundtrip");
        }
    }

    // ── isValid consistency with encode ───────────────────────────

    function testFuzz_encode_always_valid(
        uint8 class_,
        uint8 legend,
        uint8 breedType,
        uint256 alleleSeed
    ) public pure {
        class_    = uint8(class_    % 10);
        legend    = uint8(legend    % 4);
        breedType = uint8(breedType % 64);

        uint8[18] memory alleles = _validAlleles(alleleSeed);
        uint256 dna = DNALib.encode(class_, legend, breedType, alleles);

        assertTrue(DNALib.isValid(dna), "encoded DNA must be valid");
    }

    // ── Purity bounds ──────────────────────────────────────────────

    function testFuzz_purity_in_range(uint8 class_, uint256 alleleSeed) public pure {
        class_ = uint8(class_ % 10);
        uint8[18] memory alleles = _validAlleles(alleleSeed);
        uint256 dna = DNALib.encode(class_, 0, 0, alleles);

        uint8 purity = DNALib.calculatePurity(dna);
        assertLe(purity, 6, "purity must be 0-6");
    }

    function test_purity_max_when_all_dominant_match() public pure {
        uint8 class_ = 3;
        uint8[18] memory alleles;
        for (uint256 slot = 0; slot < 6; slot++) {
            alleles[slot * 3]     = (class_ << 4) | 0;
            alleles[slot * 3 + 1] = (0 << 4)      | 1;
            alleles[slot * 3 + 2] = (0 << 4)      | 2;
        }
        uint256 dna = DNALib.encode(class_, 0, 0, alleles);
        assertEq(DNALib.calculatePurity(dna), 6, "purity should be 6");
    }

    function test_purity_zero_when_no_dominant_match() public pure {
        uint8 class_ = 5;
        uint8[18] memory alleles;
        uint8 otherClass = 3;
        for (uint256 slot = 0; slot < 6; slot++) {
            alleles[slot * 3]     = (otherClass << 4) | 0;
            alleles[slot * 3 + 1] = (class_ << 4)     | 1;
            alleles[slot * 3 + 2] = (class_ << 4)     | 2;
        }
        uint256 dna = DNALib.encode(class_, 0, 0, alleles);
        assertEq(DNALib.calculatePurity(dna), 0, "purity should be 0");
    }

    // ── Invalid input reverts (via harness) ───────────────────────

    function testFuzz_encode_invalid_class_reverts(uint8 class_, uint256 alleleSeed) public {
        class_ = uint8(bound(class_, 10, type(uint8).max));
        uint8[18] memory alleles = _validAlleles(alleleSeed);
        vm.expectRevert();
        harness.encode(class_, 0, 0, alleles);
    }

    function testFuzz_encode_invalid_legend_reverts(uint8 legend, uint256 alleleSeed) public {
        legend = uint8(bound(legend, 4, type(uint8).max));
        uint8[18] memory alleles = _validAlleles(alleleSeed);
        vm.expectRevert();
        harness.encode(0, legend, 0, alleles);
    }

    function testFuzz_encode_invalid_breedType_reverts(uint8 breedType, uint256 alleleSeed) public {
        breedType = uint8(bound(breedType, 64, type(uint8).max));
        uint8[18] memory alleles = _validAlleles(alleleSeed);
        vm.expectRevert();
        harness.encode(0, 0, breedType, alleles);
    }

    function testFuzz_encode_invalid_affinity_reverts(uint8 badSlot, uint8 badAffinity) public {
        badSlot = uint8(badSlot % 18);
        badAffinity = uint8(bound(badAffinity, 10, 15));

        uint8[18] memory alleles = _validAlleles(12345);
        alleles[badSlot] = (badAffinity << 4) | 0;
        vm.expectRevert();
        harness.encode(0, 0, 0, alleles);
    }

    function testFuzz_decodeBodyPart_invalid_slot_reverts(uint8 slot) public {
        slot = uint8(bound(slot, 6, type(uint8).max));
        uint8[18] memory alleles = _validAlleles(42);
        uint256 dna = DNALib.encode(0, 0, 0, alleles);
        vm.expectRevert();
        harness.decodeBodyPart(dna, slot);
    }

    // ── Allele bit split ───────────────────────────────────────────

    function testFuzz_decodeAllele_splits_correctly(uint8 affinity, uint8 variant) public pure {
        affinity = uint8(affinity % 10);
        variant  = uint8(variant  % 16);
        uint8 allele = (affinity << 4) | variant;
        (uint8 gotAffinity, uint8 gotVariant) = DNALib.decodeAllele(allele);
        assertEq(gotAffinity, affinity, "affinity");
        assertEq(gotVariant,  variant,  "variant");
    }

    // ── Invalid DNA (constructed manually) ────────────────────────

    function test_isValid_rejects_bad_class() public pure {
        uint256 dna = uint256(10) << 252;
        assertFalse(DNALib.isValid(dna));
    }

    function test_isValid_rejects_bad_allele_affinity() public pure {
        uint8[18] memory alleles = _validAlleles(0);
        uint256 dna = DNALib.encode(0, 0, 0, alleles);
        dna = (dna & ~(uint256(0xFF) << 232)) | (uint256(0xB0) << 232);
        assertFalse(DNALib.isValid(dna));
    }
}
