// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LobsterNFT} from "./LobsterNFT.sol";
import {Treasury} from "./Treasury.sol";
import {DNALib} from "./libraries/DNALib.sol";

/// @title BreedingLab — Lobster breeding for Clawbada
/// @notice Breeds 2 parent lobsters to produce 1 offspring with DNA inheritance, gene ordering, and legend rolls.
///         Fees routed through Treasury.sol (85% burn / 15% dev).
/// @dev Offspring is always Base tier, never soulbound. Parents are preserved (not consumed).
///      5 breeds max per lobster, 48h cooldown per parent. Cost scales by breed count × generation.
contract BreedingLab is ReentrancyGuard {
    // ──────────── Constants ────────────
    uint256 public constant BREED_COOLDOWN = 48 hours;
    uint256 public constant BASE_BREED_COST = 500e18;
    uint256 public constant MAX_BREEDS = 5;
    uint256 public constant LEGEND_THRESHOLD = 3; // 0.3% = 3/1000

    // Breed multipliers ×10 scaled: [1.0, 1.5, 2.5, 4.0, 8.0] → [10, 15, 25, 40, 80]
    uint256[5] public BREED_MULTIPLIERS = [uint256(10), 15, 25, 40, 80];

    // ──────────── State ────────────
    IERC20 public clawToken;
    LobsterNFT public lobsterNFT;
    Treasury public treasury;

    mapping(uint256 => uint256) private _lastBreedTime; // lobsterId → timestamp

    // ──────────── Events ────────────
    event LobsterBred(
        uint256 indexed parentA, uint256 indexed parentB, uint256 indexed offspringId, uint256 offspringDna, uint256 cost
    );

    // ──────────── Errors ────────────
    error ZeroAddress();
    error NotLobsterOwner(uint256 lobsterId);
    error SameParent();
    error LobsterIsLocked(uint256 lobsterId);
    error BreedLimitReached(uint256 lobsterId);
    error BreedOnCooldown(uint256 lobsterId, uint256 availableAt);

    // ──────────── Constructor ────────────

    /// @param clawToken_ The $CLAW ERC-20 token
    /// @param lobsterNFT_ The LobsterNFT contract
    /// @param treasury_ The Treasury fee splitter
    constructor(address clawToken_, address lobsterNFT_, address treasury_) {
        if (clawToken_ == address(0) || lobsterNFT_ == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        clawToken = IERC20(clawToken_);
        lobsterNFT = LobsterNFT(lobsterNFT_);
        treasury = Treasury(treasury_);
    }

    // ──────────── Core ────────────

    /// @notice Breed two parent lobsters to produce one offspring.
    /// @param parentA First parent lobster ID
    /// @param parentB Second parent lobster ID
    /// @return offspringId The newly minted offspring token ID
    function breed(uint256 parentA, uint256 parentB) external nonReentrant returns (uint256 offspringId) {
        if (parentA == parentB) revert SameParent();

        // Validate both parents
        _validateParent(parentA);
        _validateParent(parentB);

        // Calculate and collect fee, update parent state
        uint256 totalCost = _collectFeeAndUpdateParents(parentA, parentB);

        // Generate offspring
        offspringId = _createOffspring(parentA, parentB, totalCost);
    }

    function _collectFeeAndUpdateParents(uint256 parentA, uint256 parentB) internal returns (uint256 totalCost) {
        uint256 costA = _breedCostPerParent(lobsterNFT.getBreedCount(parentA), lobsterNFT.getGeneration(parentA));
        uint256 costB = _breedCostPerParent(lobsterNFT.getBreedCount(parentB), lobsterNFT.getGeneration(parentB));
        totalCost = costA + costB;

        // Pull $CLAW from user
        clawToken.transferFrom(msg.sender, address(this), totalCost);

        // Route fee through Treasury
        clawToken.approve(address(treasury), totalCost);
        treasury.processFee(totalCost);

        // Update parent state
        lobsterNFT.incrementBreedCount(parentA);
        lobsterNFT.incrementBreedCount(parentB);
        _lastBreedTime[parentA] = block.timestamp;
        _lastBreedTime[parentB] = block.timestamp;
    }

    function _createOffspring(uint256 parentA, uint256 parentB, uint256 totalCost) internal returns (uint256 offspringId) {
        uint8 genA = lobsterNFT.getGeneration(parentA);
        uint8 genB = lobsterNFT.getGeneration(parentB);
        uint8 offspringGen = genA > genB ? genA + 1 : genB + 1;

        uint256 seed = uint256(keccak256(abi.encodePacked(block.prevrandao, parentA, parentB, msg.sender, block.timestamp)));
        uint256 offspringDna = _generateOffspringDNA(lobsterNFT.getDNA(parentA), lobsterNFT.getDNA(parentB), seed);

        offspringId = lobsterNFT.mintWithGeneration(msg.sender, offspringDna, offspringGen);

        emit LobsterBred(parentA, parentB, offspringId, offspringDna, totalCost);
    }

    // ──────────── View ────────────

    /// @notice Get the cooldown expiry time for a lobster.
    function getCooldownEnd(uint256 lobsterId) external view returns (uint256) {
        uint256 lastBreed = _lastBreedTime[lobsterId];
        if (lastBreed == 0) return 0;
        return lastBreed + BREED_COOLDOWN;
    }

    /// @notice Calculate the breed cost for a single parent.
    function getBreedCostPerParent(uint8 breedCount, uint8 generation) external pure returns (uint256) {
        return _breedCostPerParent(breedCount, generation);
    }

    // ──────────── Internal ────────────

    function _validateParent(uint256 parentId) internal view {
        if (lobsterNFT.ownerOf(parentId) != msg.sender) revert NotLobsterOwner(parentId);
        if (lobsterNFT.isLocked(parentId)) revert LobsterIsLocked(parentId);
        if (lobsterNFT.getBreedCount(parentId) >= MAX_BREEDS) revert BreedLimitReached(parentId);

        uint256 cooldownEnd = _lastBreedTime[parentId] + BREED_COOLDOWN;
        if (_lastBreedTime[parentId] != 0 && block.timestamp < cooldownEnd) {
            revert BreedOnCooldown(parentId, cooldownEnd);
        }
    }

    function _breedCostPerParent(uint8 breedCount, uint8 generation) internal pure returns (uint256) {
        // BREED_MULTIPLIERS are ×10 scaled: [10, 15, 25, 40, 80]
        uint256[5] memory multipliers = [uint256(10), 15, 25, 40, 80];
        uint256 cost = BASE_BREED_COST * multipliers[breedCount] / 10;

        // ×1.5 per generation: cost * 3/2 for each gen
        for (uint8 i = 0; i < generation; i++) {
            cost = cost * 3 / 2;
        }
        return cost;
    }

    function _generateOffspringDNA(uint256 dnaA, uint256 dnaB, uint256 seed) internal pure returns (uint256) {
        // Determine offspring class (50/50 from either parent)
        uint8 classA = DNALib.decodeClass(dnaA);
        uint8 classB = DNALib.decodeClass(dnaB);
        uint8 offspringClass = (uint256(keccak256(abi.encodePacked(seed, "class"))) % 2 == 0) ? classA : classB;

        // Legend roll: 0.3% chance (3/1000)
        uint8 legend = (uint256(keccak256(abi.encodePacked(seed, "legend"))) % 1000 < LEGEND_THRESHOLD) ? 1 : 0;

        // Breed type: random 0-63
        uint8 breedType = uint8(uint256(keccak256(abi.encodePacked(seed, "breedtype"))) % 64);

        // Inherit body parts
        uint8[18] memory alleles;
        for (uint8 slot = 0; slot < 6; slot++) {
            uint256 partSeed = uint256(keccak256(abi.encodePacked(seed, "part", slot)));
            (uint8 d, uint8 r1, uint8 r2) = _inheritBodyPart(dnaA, dnaB, slot, offspringClass, partSeed);
            alleles[slot * 3] = d;
            alleles[slot * 3 + 1] = r1;
            alleles[slot * 3 + 2] = r2;
        }

        return DNALib.encode(offspringClass, legend, breedType, alleles);
    }

    /// @dev Inherit one body part from two parents: select alleles, then order by class-match priority.
    function _inheritBodyPart(uint256 dnaA, uint256 dnaB, uint8 slot, uint8 offspringClass, uint256 seed)
        internal
        pure
        returns (uint8, uint8, uint8)
    {
        // Select alleles from parents
        uint8[3] memory selected = _selectAlleles(dnaA, dnaB, slot, seed);

        // Order by priority — class-match first, variant tiebreak
        return _orderAlleles(selected[0], selected[1], selected[2], offspringClass);
    }

    /// @dev Select 3 alleles: one from each parent + one secondary draw from a VRF-chosen parent.
    function _selectAlleles(uint256 dnaA, uint256 dnaB, uint8 slot, uint256 seed)
        internal
        pure
        returns (uint8[3] memory selected)
    {
        (uint8 aD, uint8 aR1, uint8 aR2) = DNALib.decodeBodyPart(dnaA, slot);
        (uint8 bD, uint8 bR1, uint8 bR2) = DNALib.decodeBodyPart(dnaB, slot);

        // Step 1: Select 1 allele from each parent (50% D / 33% R1 / 17% R2)
        uint8 idxA = _selectIndex(uint256(keccak256(abi.encodePacked(seed, "selA"))));
        uint8 idxB = _selectIndex(uint256(keccak256(abi.encodePacked(seed, "selB"))));

        uint8[3] memory pA = [aD, aR1, aR2];
        uint8[3] memory pB = [bD, bR1, bR2];

        selected[0] = pA[idxA];
        selected[1] = pB[idxB];

        // Step 2: Third allele — VRF picks one parent, draw from their 2 remaining alleles
        uint256 pick = uint256(keccak256(abi.encodePacked(seed, "pick")));
        if (uint256(keccak256(abi.encodePacked(seed, "third"))) % 2 == 0) {
            selected[2] = _pickRemaining(pA, idxA, pick);
        } else {
            selected[2] = _pickRemaining(pB, idxB, pick);
        }
    }

    /// @dev Map a random value to index 0/1/2 with 50%/33%/17% distribution.
    function _selectIndex(uint256 rand) internal pure returns (uint8) {
        uint256 r = rand % 100;
        if (r < 50) return 0;
        if (r < 83) return 1;
        return 2;
    }

    /// @dev Pick one of the 2 remaining alleles (excluding the one at excludeIdx) with equal probability.
    function _pickRemaining(uint8[3] memory alleles, uint8 excludeIdx, uint256 rand) internal pure returns (uint8) {
        uint8 first;
        uint8 second;
        if (excludeIdx == 0) { first = alleles[1]; second = alleles[2]; }
        else if (excludeIdx == 1) { first = alleles[0]; second = alleles[2]; }
        else { first = alleles[0]; second = alleles[1]; }
        return (rand % 2 == 0) ? first : second;
    }

    /// @dev Sort 3 alleles descending by priority: (class match × 256 + variant).
    ///      Returns (dominant, r1, r2).
    function _orderAlleles(uint8 a, uint8 b, uint8 c, uint8 offspringClass)
        internal
        pure
        returns (uint8, uint8, uint8)
    {
        uint256 prioA = _allelePriority(a, offspringClass);
        uint256 prioB = _allelePriority(b, offspringClass);
        uint256 prioC = _allelePriority(c, offspringClass);

        // Simple 3-element sort descending
        uint8[3] memory sorted = [a, b, c];
        uint256[3] memory prios = [prioA, prioB, prioC];

        // Bubble sort (3 elements, at most 3 comparisons)
        if (prios[0] < prios[1]) {
            (sorted[0], sorted[1]) = (sorted[1], sorted[0]);
            (prios[0], prios[1]) = (prios[1], prios[0]);
        }
        if (prios[1] < prios[2]) {
            (sorted[1], sorted[2]) = (sorted[2], sorted[1]);
            (prios[1], prios[2]) = (prios[2], prios[1]);
        }
        if (prios[0] < prios[1]) {
            (sorted[0], sorted[1]) = (sorted[1], sorted[0]);
        }

        return (sorted[0], sorted[1], sorted[2]);
    }

    /// @dev Priority = (affinity matches class ? 1 : 0) × 256 + variant.
    function _allelePriority(uint8 allele, uint8 offspringClass) internal pure returns (uint256) {
        uint8 affinity = allele >> 4;
        uint8 variant = allele & 0x0F;
        uint256 matchBonus = (affinity == offspringClass) ? 256 : 0;
        return matchBonus + variant;
    }
}
