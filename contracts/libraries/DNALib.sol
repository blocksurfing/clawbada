// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DNALib — Lobster DNA encoding/decoding library
/// @notice Pure library for packing and unpacking lobster genetics into a uint256.
/// @dev Bit layout (256 bits, high to low):
///   [255:252] Class         (4 bits, 0-9)
///   [251:250] Legend        (2 bits, 0-3)
///   [249:244] Breed type    (6 bits, 0-63)
///   [243:240] Reserved      (4 bits)
///   [239:96]  6 body parts  (144 bits = 6 parts × 3 alleles × 8 bits)
///   [95:0]    Reserved      (96 bits)
///
///   Each allele (8 bits): [7:4] class affinity (0-9), [3:0] variant (0-15)
///   Body parts ordered slot 0-5: Carapace, Claws, Tail, Antennae, Eyes, Legs
///   Alleles ordered per part: Dominant, R1, R2
library DNALib {
    uint8 internal constant NUM_CLASSES = 10;
    uint8 internal constant NUM_BODY_PARTS = 6;
    uint8 internal constant ALLELES_PER_PART = 3;
    uint8 internal constant TOTAL_ALLELES = 18; // 6 × 3

    // Bit positions and masks
    uint256 internal constant CLASS_SHIFT = 252;
    uint256 internal constant CLASS_MASK = 0xF;
    uint256 internal constant LEGEND_SHIFT = 250;
    uint256 internal constant LEGEND_MASK = 0x3;
    uint256 internal constant BREED_TYPE_SHIFT = 244;
    uint256 internal constant BREED_TYPE_MASK = 0x3F;
    uint256 internal constant ALLELE_BITS = 8;
    uint256 internal constant PART_BITS = 24; // 3 alleles × 8 bits
    uint256 internal constant ALLELE_MASK = 0xFF;
    uint256 internal constant AFFINITY_MASK = 0xF0;
    uint256 internal constant VARIANT_MASK = 0x0F;

    // Body parts region starts at bit 239, ends at bit 96 (144 bits)
    // Slot 0 (Carapace) occupies bits [239:216], slot 5 (Legs) occupies bits [119:96]
    uint256 internal constant BODY_PARTS_HIGH_BIT = 239;

    error InvalidClass(uint8 class_);
    error InvalidLegend(uint8 legend);
    error InvalidBreedType(uint8 breedType);
    error InvalidBodyPartSlot(uint8 slot);
    error InvalidClassAffinity(uint8 affinity);

    /// @notice Encode all components into a packed uint256 DNA value.
    /// @param class_ Lobster class (0-9)
    /// @param legend Legend status (0-3)
    /// @param breedType Visual subtype (0-63)
    /// @param alleles 18 allele bytes: [slot0_D, slot0_R1, slot0_R2, ..., slot5_D, slot5_R1, slot5_R2]
    /// @return dna The packed uint256
    function encode(uint8 class_, uint8 legend, uint8 breedType, uint8[18] memory alleles)
        internal
        pure
        returns (uint256 dna)
    {
        if (class_ >= NUM_CLASSES) revert InvalidClass(class_);
        if (legend > 3) revert InvalidLegend(legend);
        if (breedType > 63) revert InvalidBreedType(breedType);

        dna = uint256(class_) << CLASS_SHIFT;
        dna |= uint256(legend) << LEGEND_SHIFT;
        dna |= uint256(breedType) << BREED_TYPE_SHIFT;

        // Pack 18 alleles into body parts region [239:96]
        for (uint256 i = 0; i < TOTAL_ALLELES; i++) {
            uint8 allele = alleles[i];
            uint8 affinity = allele >> 4;
            if (affinity >= NUM_CLASSES) revert InvalidClassAffinity(affinity);

            // Allele i occupies bits starting at (BODY_PARTS_HIGH_BIT - i * ALLELE_BITS) down to (... - 7)
            uint256 shift = BODY_PARTS_HIGH_BIT - (i * ALLELE_BITS) - 7;
            // Equivalent: shift = 232 - i * 8
            dna |= uint256(allele) << shift;
        }
    }

    /// @notice Extract the class field (bits 255:252).
    function decodeClass(uint256 dna) internal pure returns (uint8) {
        return uint8((dna >> CLASS_SHIFT) & CLASS_MASK);
    }

    /// @notice Extract the legend field (bits 251:250).
    function decodeLegend(uint256 dna) internal pure returns (uint8) {
        return uint8((dna >> LEGEND_SHIFT) & LEGEND_MASK);
    }

    /// @notice Extract the breed type field (bits 249:244).
    function decodeBreedType(uint256 dna) internal pure returns (uint8) {
        return uint8((dna >> BREED_TYPE_SHIFT) & BREED_TYPE_MASK);
    }

    /// @notice Extract the 3 allele bytes for a body part slot (0-5).
    /// @return dominant The dominant allele byte
    /// @return r1 The first recessive allele byte
    /// @return r2 The second recessive allele byte
    function decodeBodyPart(uint256 dna, uint8 slot)
        internal
        pure
        returns (uint8 dominant, uint8 r1, uint8 r2)
    {
        if (slot >= NUM_BODY_PARTS) revert InvalidBodyPartSlot(slot);

        // Each slot has 3 alleles × 8 bits = 24 bits
        // Slot 0 starts at allele index 0, slot 1 at index 3, etc.
        uint256 baseIndex = uint256(slot) * ALLELES_PER_PART;

        dominant = _extractAllele(dna, baseIndex);
        r1 = _extractAllele(dna, baseIndex + 1);
        r2 = _extractAllele(dna, baseIndex + 2);
    }

    /// @notice Split an allele byte into class affinity (high nibble) and variant (low nibble).
    function decodeAllele(uint8 allele) internal pure returns (uint8 classAffinity, uint8 variant) {
        classAffinity = allele >> 4;
        variant = allele & 0x0F;
    }

    /// @notice Calculate purity: count of body parts where dominant allele's class affinity matches the lobster's class.
    /// @return purity 0-6
    function calculatePurity(uint256 dna) internal pure returns (uint8 purity) {
        uint8 class_ = decodeClass(dna);

        for (uint8 slot = 0; slot < NUM_BODY_PARTS; slot++) {
            (uint8 dominant,,) = decodeBodyPart(dna, slot);
            (uint8 affinity,) = decodeAllele(dominant);
            if (affinity == class_) {
                purity++;
            }
        }
    }

    /// @notice Validate that DNA has a valid class, legend, and all allele class affinities in range.
    function isValid(uint256 dna) internal pure returns (bool) {
        uint8 class_ = decodeClass(dna);
        if (class_ >= NUM_CLASSES) return false;

        uint8 legend = decodeLegend(dna);
        if (legend > 3) return false;

        // Check all 18 alleles have valid class affinity
        for (uint256 i = 0; i < TOTAL_ALLELES; i++) {
            uint8 allele = _extractAllele(dna, i);
            uint8 affinity = allele >> 4;
            if (affinity >= NUM_CLASSES) return false;
        }

        return true;
    }

    /// @dev Extract allele byte at a given index (0-17) from the body parts region.
    function _extractAllele(uint256 dna, uint256 index) private pure returns (uint8) {
        uint256 shift = 232 - index * ALLELE_BITS;
        return uint8((dna >> shift) & ALLELE_MASK);
    }
}
