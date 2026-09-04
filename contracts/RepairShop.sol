// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LobsterNFT} from "./LobsterNFT.sol";
import {Treasury} from "./Treasury.sol";

/// @dev Minimal read interface onto MiningPool's glide-pegged base reward (TOK-G1).
interface IMiningPoolPeg {
    function currentBaseReward() external view returns (uint256);
}

/// @title RepairShop — Post-battle damage repair for Clawbada
/// @notice Burns $CLAW to reduce battle damage on a lobster. Repair is instant.
///         Fees routed through Treasury.sol (85% burn / 15% dev).
/// @dev TOK-G1: repair rates peg to MiningPool's glide-pegged baseReward — bps per damage
///      point by evolution tier (Evolved 40 / Elite 120 / Apex 320 bps, reproducing the
///      spec's 5/15/40 $CLAW at the S1 launch reward of 1,250). As mining yields glide with
///      crowding, repair costs track them, keeping battle economics rational season-round.
///      Base tier lobsters cannot accumulate battle damage and have a rate of 0.
/// @custom:security-contact security@clawbada.com
contract RepairShop is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────── Constants ────────────
    // TOK-G1: bps of MiningPool.currentBaseReward() per damage point: Base/Evolved/Elite/Apex.
    uint256[4] public REPAIR_RATE_BPS = [0, 40, 120, 320];

    // ──────────── State ────────────
    IERC20 public clawToken;
    LobsterNFT public lobsterNFT;
    Treasury public treasury;
    IMiningPoolPeg public miningPool;

    // ──────────── Events ────────────
    event LobsterRepaired(uint256 indexed lobsterId, uint8 pointsRepaired, uint8 newDamage, uint256 cost);

    // ──────────── Errors ────────────
    error ZeroAddress();
    error NotLobsterOwner(uint256 lobsterId);
    error NothingToRepair(uint256 lobsterId);
    error ExceedsCurrentDamage(uint256 lobsterId, uint8 requested, uint8 actual);
    error CannotRepairBaseTier(uint256 lobsterId);
    error ZeroRepairPoints();
    error RewardPegUnset();

    // ──────────── Constructor ────────────

    /// @param clawToken_ The $CLAW ERC-20 token
    /// @param lobsterNFT_ The LobsterNFT contract
    /// @param treasury_ The Treasury fee splitter
    /// @param miningPool_ The MiningPool whose glide-pegged baseReward anchors repair rates
    constructor(address clawToken_, address lobsterNFT_, address treasury_, address miningPool_) {
        if (
            clawToken_ == address(0) || lobsterNFT_ == address(0) || treasury_ == address(0)
                || miningPool_ == address(0)
        ) {
            revert ZeroAddress();
        }
        clawToken = IERC20(clawToken_);
        lobsterNFT = LobsterNFT(lobsterNFT_);
        treasury = Treasury(treasury_);
        miningPool = IMiningPoolPeg(miningPool_);
    }

    // ──────────── Views ────────────

    /// @notice Current $CLAW-per-damage-point repair rate for an evolution tier (TOK-G1 peg).
    function repairRate(uint8 tier) public view returns (uint256) {
        return (miningPool.currentBaseReward() * REPAIR_RATE_BPS[tier]) / 10_000;
    }

    // ──────────── Core ────────────

    /// @notice Repair battle damage on a lobster. Partial repairs allowed.
    /// @param lobsterId The lobster to repair
    /// @param pointsToRepair Number of damage points to remove
    function repair(uint256 lobsterId, uint8 pointsToRepair) external nonReentrant {
        if (pointsToRepair == 0) revert ZeroRepairPoints();

        // Validate ownership
        if (lobsterNFT.ownerOf(lobsterId) != msg.sender) revert NotLobsterOwner(lobsterId);

        // Check damage
        uint8 currentDamage = lobsterNFT.getDamage(lobsterId);
        if (currentDamage == 0) revert NothingToRepair(lobsterId);
        if (pointsToRepair > currentDamage) revert ExceedsCurrentDamage(lobsterId, pointsToRepair, currentDamage);

        // Get tier rate (TOK-G1: pegged to the glide)
        uint8 tier = lobsterNFT.getEvolutionTier(lobsterId);
        if (REPAIR_RATE_BPS[tier] == 0) revert CannotRepairBaseTier(lobsterId);
        uint256 rate = repairRate(tier);
        if (rate == 0) revert RewardPegUnset();

        // Calculate cost
        uint256 cost = uint256(pointsToRepair) * rate;

        // Pull $CLAW from user (I-04 SafeERC20)
        clawToken.safeTransferFrom(msg.sender, address(this), cost);

        // Route fee through Treasury (I-03 forceApprove)
        clawToken.forceApprove(address(treasury), cost);
        treasury.processFee(cost);

        // Set new damage
        uint8 newDamage = currentDamage - pointsToRepair;
        lobsterNFT.setDamage(lobsterId, newDamage);

        emit LobsterRepaired(lobsterId, pointsToRepair, newDamage, cost);
    }
}
