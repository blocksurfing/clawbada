// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LobsterNFT} from "./LobsterNFT.sol";
import {Treasury} from "./Treasury.sol";

/// @title EvolutionLab — Lobster evolution for Clawbada
/// @notice Evolves a single lobster by burning 2 fuel lobsters of the same tier + $CLAW fee.
///         Fees routed through Treasury.sol (85% burn / 15% dev).
/// @dev Base→Evolved (2K $CLAW), Evolved→Elite (10K), Elite→Apex (50K).
///      Fuel lobsters are permanently burned. Soulbound lobsters can be evolved and used as fuel.
contract EvolutionLab is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────── Constants ────────────
    uint256[3] public EVOLUTION_COSTS = [2_000e18, 10_000e18, 50_000e18];

    // ──────────── State ────────────
    IERC20 public clawToken;
    LobsterNFT public lobsterNFT;
    Treasury public treasury;

    // ──────────── Events ────────────
    event LobsterEvolved(
        uint256 indexed lobsterId, uint256 fuelId1, uint256 fuelId2, uint8 newTier, uint256 cost
    );

    // ──────────── Errors ────────────
    error ZeroAddress();
    error AlreadyMaxTier(uint256 lobsterId);
    error NotLobsterOwner(uint256 lobsterId);
    error LobsterIsLocked(uint256 lobsterId);
    error InvalidFuelTier(uint256 fuelId, uint8 required, uint8 actual);
    error DuplicateId(uint256 id);

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

    /// @notice Evolve a lobster to the next tier by burning 2 fuel lobsters + $CLAW fee.
    /// @param lobsterId The lobster to evolve
    /// @param fuelId1 First fuel lobster (burned)
    /// @param fuelId2 Second fuel lobster (burned)
    function evolve(uint256 lobsterId, uint256 fuelId1, uint256 fuelId2) external nonReentrant {
        // Validate no duplicate IDs
        if (lobsterId == fuelId1 || lobsterId == fuelId2) revert DuplicateId(lobsterId);
        if (fuelId1 == fuelId2) revert DuplicateId(fuelId1);

        // Validate target lobster
        if (lobsterNFT.ownerOf(lobsterId) != msg.sender) revert NotLobsterOwner(lobsterId);
        if (lobsterNFT.isLocked(lobsterId)) revert LobsterIsLocked(lobsterId);

        uint8 currentTier = lobsterNFT.getEvolutionTier(lobsterId);
        if (currentTier >= lobsterNFT.MAX_EVOLUTION_TIER()) revert AlreadyMaxTier(lobsterId);

        // Validate fuel lobsters
        _validateFuel(fuelId1, currentTier);
        _validateFuel(fuelId2, currentTier);

        // Pull $CLAW from user (I-04 SafeERC20)
        uint256 cost = EVOLUTION_COSTS[currentTier];
        clawToken.safeTransferFrom(msg.sender, address(this), cost);

        // Route fee through Treasury (I-03 forceApprove)
        clawToken.forceApprove(address(treasury), cost);
        treasury.processFee(cost);

        // Burn fuel lobsters
        lobsterNFT.burn(fuelId1);
        lobsterNFT.burn(fuelId2);

        // Evolve target
        uint8 newTier = currentTier + 1;
        lobsterNFT.setEvolutionTier(lobsterId, newTier);

        emit LobsterEvolved(lobsterId, fuelId1, fuelId2, newTier, cost);
    }

    // ──────────── Internal ────────────

    function _validateFuel(uint256 fuelId, uint8 requiredTier) internal view {
        if (lobsterNFT.ownerOf(fuelId) != msg.sender) revert NotLobsterOwner(fuelId);
        if (lobsterNFT.isLocked(fuelId)) revert LobsterIsLocked(fuelId);
        uint8 fuelTier = lobsterNFT.getEvolutionTier(fuelId);
        if (fuelTier != requiredTier) revert InvalidFuelTier(fuelId, requiredTier, fuelTier);
    }
}
