// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LobsterNFT} from "./LobsterNFT.sol";
import {Treasury} from "./Treasury.sol";

/// @title RepairShop — Post-battle damage repair for Clawbada
/// @notice Burns $CLAW to reduce battle damage on a lobster. Repair is instant.
///         Fees routed through Treasury.sol (85% burn / 15% dev).
/// @dev Repair rates scale by evolution tier: Evolved 5, Elite 15, Apex 40 $CLAW per damage point.
///      Base tier lobsters cannot accumulate battle damage and have a rate of 0.
contract RepairShop is ReentrancyGuard {
    // ──────────── Constants ────────────
    uint256[4] public REPAIR_RATES = [0, 5e18, 15e18, 40e18]; // per damage point: Base/Evolved/Elite/Apex

    // ──────────── State ────────────
    IERC20 public clawToken;
    LobsterNFT public lobsterNFT;
    Treasury public treasury;

    // ──────────── Events ────────────
    event LobsterRepaired(uint256 indexed lobsterId, uint8 pointsRepaired, uint8 newDamage, uint256 cost);

    // ──────────── Errors ────────────
    error ZeroAddress();
    error NotLobsterOwner(uint256 lobsterId);
    error NothingToRepair(uint256 lobsterId);
    error ExceedsCurrentDamage(uint256 lobsterId, uint8 requested, uint8 actual);
    error CannotRepairBaseTier(uint256 lobsterId);
    error ZeroRepairPoints();

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

        // Get tier rate
        uint8 tier = lobsterNFT.getEvolutionTier(lobsterId);
        uint256 rate = REPAIR_RATES[tier];
        if (rate == 0) revert CannotRepairBaseTier(lobsterId);

        // Calculate cost
        uint256 cost = uint256(pointsToRepair) * rate;

        // Pull $CLAW from user
        clawToken.transferFrom(msg.sender, address(this), cost);

        // Route fee through Treasury
        clawToken.approve(address(treasury), cost);
        treasury.processFee(cost);

        // Set new damage
        uint8 newDamage = currentDamage - pointsToRepair;
        lobsterNFT.setDamage(lobsterId, newDamage);

        emit LobsterRepaired(lobsterId, pointsToRepair, newDamage, cost);
    }
}
