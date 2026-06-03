// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LobsterNFT} from "./LobsterNFT.sol";
import {Treasury} from "./Treasury.sol";
import {DNALib} from "./libraries/DNALib.sol";

/// @title BreedingLab — Lobster breeding for Clawbada
/// @notice Breeds 2 parent lobsters to produce 1 offspring with DNA inheritance, gene ordering, and legend rolls.
///         Fees routed through Treasury.sol (85% burn / 15% dev).
/// @dev Uses a 2-step commit-reveal flow (requestBreed → finalizeBreed) to prevent same-block
///      randomness sniping. Offspring is always Base tier, never soulbound. Parents are preserved
///      (not consumed). 5 breeds max per lobster, 48h cooldown per parent. Cost scales by breed
///      count × generation.
/// @custom:security-contact security@clawbada.com
contract BreedingLab is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────── Constants ────────────
    uint256 public constant BREED_COOLDOWN = 48 hours;
    uint256 public constant BASE_BREED_COST = 500e18;
    uint256 public constant MAX_BREEDS = 5;
    uint256 public constant LEGEND_THRESHOLD = 3; // 0.3% = 3/1000
    uint256 public constant FINALIZE_MIN_BLOCKS = 2;
    uint256 public constant FINALIZE_WINDOW = 256; // EVM blockhash lookback limit

    // Breed multipliers ×10 scaled: [1.0, 1.5, 2.5, 4.0, 8.0] → [10, 15, 25, 40, 80]
    uint256[5] public BREED_MULTIPLIERS = [uint256(10), 15, 25, 40, 80];

    // ──────────── Types ────────────
    struct BreedRequest {
        address requester;
        uint8 genA;
        uint8 genB;
        bool finalized;
        uint256 dnaA;
        uint256 dnaB;
        uint256 targetBlock;
        uint256 cost;
        uint256 parentA; // F-01: stored for expired request recovery
        uint256 parentB; // F-01: stored for expired request recovery
    }

    // ──────────── State ────────────
    IERC20 public clawToken;
    LobsterNFT public lobsterNFT;
    Treasury public treasury;

    uint256 public nextRequestId = 1;
    mapping(uint256 => BreedRequest) private _breedRequests;
    mapping(uint256 => uint256) private _lastBreedTime; // lobsterId → timestamp

    // ──────────── Events ────────────
    event BreedRequested(
        uint256 indexed requestId,
        address indexed requester,
        uint256 parentA,
        uint256 parentB,
        uint256 cost,
        uint256 targetBlock
    );
    event LobsterBred(
        uint256 indexed requestId, uint256 indexed offspringId, uint256 offspringDna, uint256 cost
    );
    event BreedRequestExpired(uint256 indexed requestId, uint256 parentA, uint256 parentB);
    /// @notice Emitted when the offspring mint is rejected by a contract requester's
    ///         onERC1155Received hook. The request is still consumed (finalized +
    ///         breed counts burned). See B-02.
    event LobsterBredRejected(uint256 indexed requestId, uint256 offspringDna, uint256 cost);

    // ──────────── Errors ────────────
    error ZeroAddress();
    error NotLobsterOwner(uint256 lobsterId);
    error SameParent();
    error LobsterIsLocked(uint256 lobsterId);
    error BreedLimitReached(uint256 lobsterId);
    error BreedOnCooldown(uint256 lobsterId, uint256 availableAt);
    error RequestDoesNotExist(uint256 requestId);
    error RequestAlreadyFinalized(uint256 requestId);
    error TooEarlyToFinalize(uint256 requestId, uint256 targetBlock);
    error RequestExpired(uint256 requestId);
    error MaxGenerationReached();
    error RequestNotExpired(uint256 requestId);
    /// @notice BreedingLab lacks LobsterNFT.MINTER_ROLE — operator must re-grant
    ///         before finalize can proceed. B-03: surfaces role misconfiguration
    ///         loudly rather than silently burning the request via try/catch.
    error NotAuthorizedToMint();

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

    /// @notice Step 1: Request a breed. Validates parents, charges fee, sets cooldowns.
    /// @dev Fee is committed immediately and cannot be refunded. Breed count is incremented.
    ///      The offspring will be generated in finalizeBreed using future-block entropy.
    /// @param parentA First parent lobster ID
    /// @param parentB Second parent lobster ID
    /// @return requestId The breed request ID
    function requestBreed(uint256 parentA, uint256 parentB) external nonReentrant returns (uint256 requestId) {
        if (parentA == parentB) revert SameParent();

        // Validate both parents
        _validateParent(parentA);
        _validateParent(parentB);

        // Cache parent data before state changes
        uint256 dnaA = lobsterNFT.getDNA(parentA);
        uint256 dnaB = lobsterNFT.getDNA(parentB);
        uint8 genA = lobsterNFT.getGeneration(parentA);
        uint8 genB = lobsterNFT.getGeneration(parentB);

        // Check offspring generation won't overflow
        uint8 maxGen = genA > genB ? genA : genB;
        if (maxGen >= 255) revert MaxGenerationReached();

        // Calculate and collect fee, update parent state
        uint256 totalCost = _collectFeeAndUpdateParents(parentA, parentB);

        // Store request
        requestId = nextRequestId++;
        uint256 targetBlock = block.number + FINALIZE_MIN_BLOCKS;

        _breedRequests[requestId] = BreedRequest({
            requester: msg.sender,
            genA: genA,
            genB: genB,
            finalized: false,
            dnaA: dnaA,
            dnaB: dnaB,
            targetBlock: targetBlock,
            cost: totalCost,
            parentA: parentA,
            parentB: parentB
        });

        emit BreedRequested(requestId, msg.sender, parentA, parentB, totalCost, targetBlock);
    }

    /// @notice Step 2: Finalize a breed request. Generates offspring using future-block entropy.
    /// @dev Callable by anyone after the target block. Offspring is minted to the original requester.
    ///      This prevents sniping: a smart contract cannot simulate the outcome and revert
    ///      selectively because anyone else can finalize the request.
    /// @param requestId The breed request ID from requestBreed
    /// @return offspringId The newly minted offspring token ID
    function finalizeBreed(uint256 requestId) external nonReentrant returns (uint256 offspringId) {
        BreedRequest storage req = _breedRequests[requestId];
        if (req.requester == address(0)) revert RequestDoesNotExist(requestId);
        if (req.finalized) revert RequestAlreadyFinalized(requestId);
        // B-01: `<=` (not `<`) — at `block.number == targetBlock`, blockhash(targetBlock)
        // is still 0 (current block has no completed hash yet). Pre-fix, that row
        // let `cancelExpiredRequest` treat the request as expired and let any outsider
        // race to cancel-and-burn the fee before the user could finalize.
        if (block.number <= req.targetBlock) revert TooEarlyToFinalize(requestId, req.targetBlock);

        bytes32 blockHash = blockhash(req.targetBlock);
        if (blockHash == bytes32(0)) revert RequestExpired(requestId);

        // B-03: pre-flight MINTER_ROLE check. If BreedingLab has lost
        // MINTER_ROLE (operational error — role revocation, new NFT
        // contract wiring bug), revert before consuming the request so
        // the user can retry after the role is restored. The bare
        // try/catch below only legitimately absorbs recipient-hook
        // reverts; protocol-side failures should surface loudly.
        if (!lobsterNFT.hasRole(lobsterNFT.MINTER_ROLE(), address(this))) {
            revert NotAuthorizedToMint();
        }

        req.finalized = true;

        // Generate offspring using future-block entropy (unknown at request time)
        uint256 seed = uint256(keccak256(abi.encodePacked(blockHash, requestId)));
        uint256 offspringDna = _generateOffspringDNA(req.dnaA, req.dnaB, seed);

        // Generation overflow already checked in requestBreed; safe to add without overflow
        uint8 offspringGen = (req.genA > req.genB ? req.genA : req.genB) + 1;

        // B-02: try/catch the mint so a contract requester with a reverting
        // onERC1155Received hook can't roll finalize back and farm rare
        // rolls via the cancel-refund path. A rejected mint still consumes
        // the request (finalized = true above) and the breed counts stay
        // burned — attack becomes strictly -EV.
        try lobsterNFT.mintWithGeneration(req.requester, offspringDna, offspringGen) returns (uint256 _offspringId) {
            offspringId = _offspringId;
            emit LobsterBred(requestId, offspringId, offspringDna, req.cost);
        } catch {
            emit LobsterBredRejected(requestId, offspringDna, req.cost);
        }
    }

    /// @notice Cancel an expired breed request and restore parent breed counts.
    /// @dev Callable by anyone after the blockhash window expires (~256 blocks / ~8.5 min on Base).
    ///      The $CLAW fee is irrecoverable (already burned via Treasury), but breed counts are
    ///      restored so parents don't permanently lose a lifetime breed slot.
    /// @param requestId The breed request ID
    function cancelExpiredRequest(uint256 requestId) external nonReentrant {
        BreedRequest storage req = _breedRequests[requestId];
        if (req.requester == address(0)) revert RequestDoesNotExist(requestId);
        if (req.finalized) revert RequestAlreadyFinalized(requestId);

        // Must be past the target block (can't cancel before finalization window opens).
        // B-01: `<=` (not `<`) — at `block.number == targetBlock`, blockhash(targetBlock)
        // is 0, which the next check below would otherwise interpret as "expired" and
        // let an outsider burn the fee at the exact block the user tries to finalize.
        if (block.number <= req.targetBlock) revert TooEarlyToFinalize(requestId, req.targetBlock);

        // Must actually be expired (blockhash returns 0 after 256 blocks)
        if (blockhash(req.targetBlock) != bytes32(0)) revert RequestNotExpired(requestId);

        req.finalized = true;

        // Restore breed counts on both parents (fee is irrecoverable — already burned)
        uint256 pA = req.parentA;
        uint256 pB = req.parentB;

        // Only decrement if the parent still exists (may have been burned as evolution fuel)
        if (lobsterNFT.exists(pA)) {
            lobsterNFT.decrementBreedCount(pA);
        }
        if (lobsterNFT.exists(pB)) {
            lobsterNFT.decrementBreedCount(pB);
        }

        emit BreedRequestExpired(requestId, pA, pB);
    }

    function _collectFeeAndUpdateParents(uint256 parentA, uint256 parentB) internal returns (uint256 totalCost) {
        uint256 costA = _breedCostPerParent(lobsterNFT.getBreedCount(parentA), lobsterNFT.getGeneration(parentA));
        uint256 costB = _breedCostPerParent(lobsterNFT.getBreedCount(parentB), lobsterNFT.getGeneration(parentB));
        totalCost = costA + costB;

        // Pull $CLAW from user (I-04 SafeERC20)
        clawToken.safeTransferFrom(msg.sender, address(this), totalCost);

        // Route fee through Treasury (I-03 forceApprove)
        clawToken.forceApprove(address(treasury), totalCost);
        treasury.processFee(totalCost);

        // Update parent state
        lobsterNFT.incrementBreedCount(parentA);
        lobsterNFT.incrementBreedCount(parentB);
        _lastBreedTime[parentA] = block.timestamp;
        _lastBreedTime[parentB] = block.timestamp;
    }

    // ──────────── View ────────────

    /// @notice Get a breed request.
    function getBreedRequest(uint256 requestId) external view returns (BreedRequest memory) {
        if (_breedRequests[requestId].requester == address(0)) revert RequestDoesNotExist(requestId);
        return _breedRequests[requestId];
    }

    /// @notice Get the cooldown expiry time for a lobster.
    function getCooldownEnd(uint256 lobsterId) external view returns (uint256) {
        uint256 lastBreed = _lastBreedTime[lobsterId];
        // slither-disable-next-line incorrect-equality — exact equality against the zero "never bred" sentinel is correct.
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
        // slither-disable-next-line divide-before-multiply — intentional ×10-scaled multiplier then the per-generation ×3/2 loop; truncation is sub-wei on an 18-decimal token (verified safe to gen ~36 before the cost exceeds MAX_SUPPLY).
        uint256 cost = BASE_BREED_COST * multipliers[breedCount] / 10;

        // ×1.5 per generation: cost * 3 / 2 each step.
        // Truncation error is at most 0.5 wei per step — negligible on 18-decimal token.
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
        // slither-disable-next-line uninitialized-local — fixed-size memory array is zero-initialized by Solidity and fully written in the loop below (false positive).
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
