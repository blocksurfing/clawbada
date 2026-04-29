// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Treasury — Protocol fee splitter for Clawbada
/// @notice Receives $CLAW fees from game contracts and splits: 85% burn / 15% dev wallet.
/// @dev All game contracts that collect fees call processFee() after approving this contract.
///      Treasury does NOT accumulate tokens — each processFee call is atomic pull-split-burn.
interface IClawBurnable is IERC20 {
    function burn(uint256 amount) external;
}

/// @custom:security-contact security@clawbada.com
contract Treasury is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────── Constants ────────────
    uint256 public constant BURN_BPS = 8500;
    uint256 public constant DEV_BPS = 1500;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ──────────── State ────────────
    IClawBurnable public clawToken;
    address public devWallet;
    mapping(address => bool) public authorized;

    // ──────────── Events ────────────
    event FeeProcessed(address indexed from, uint256 amount, uint256 burned, uint256 toDev);
    event DevWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event AuthorizationUpdated(address indexed account, bool isAuthorized);
    event ClawTokenSet(address indexed token);

    // ──────────── Errors ────────────
    error NotAuthorized();
    error ZeroAddress();
    error ZeroAmount();
    error TokenAlreadySet();
    error AmountBelowMinimum(uint256 amount, uint256 minimum);
    error InvalidDevWallet();

    // ──────────── Modifiers ────────────
    modifier onlyAuthorized() {
        if (!authorized[msg.sender]) revert NotAuthorized();
        _;
    }

    // ──────────── Constructor ────────────

    /// @param initialOwner The contract owner (deployer)
    /// @param devWallet_ The dev wallet receiving 15% of fees
    constructor(address initialOwner, address devWallet_) Ownable(initialOwner) {
        if (devWallet_ == address(0)) revert ZeroAddress();
        // T-04: devWallet must not be this contract — self-routing traps the
        // 15% leg inside Treasury and breaks the "no accumulation" invariant.
        if (devWallet_ == address(this)) revert InvalidDevWallet();
        devWallet = devWallet_;
    }

    // ──────────── Admin ────────────

    /// @notice Set the CLAW token address. Can only be called once.
    /// @dev Called after ClawToken is deployed. One-time setup.
    function setClawToken(address token) external onlyOwner {
        if (address(clawToken) != address(0)) revert TokenAlreadySet();
        if (token == address(0)) revert ZeroAddress();
        clawToken = IClawBurnable(token);
        emit ClawTokenSet(token);
    }

    /// @notice Update the dev wallet address.
    function setDevWallet(address newDevWallet) external onlyOwner {
        if (newDevWallet == address(0)) revert ZeroAddress();
        // T-04: reject self-routing. Under OZ ERC20, Treasury transferring to
        // itself is a no-op in balance terms, so the 15% leg would silently
        // accumulate inside Treasury with no sweep path.
        if (newDevWallet == address(this)) revert InvalidDevWallet();
        address oldWallet = devWallet;
        devWallet = newDevWallet;
        emit DevWalletUpdated(oldWallet, newDevWallet);
    }

    /// @notice Grant or revoke a contract's authorization to call processFee.
    function setAuthorized(address account, bool isAuthorized) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        authorized[account] = isAuthorized;
        emit AuthorizationUpdated(account, isAuthorized);
    }

    // ──────────── Core ────────────

    /// @notice Process a protocol fee: pull CLAW from caller, burn 85%, send 15% to dev.
    /// @dev Caller must have approved this contract for at least `amount` CLAW.
    /// @param amount The total fee amount in CLAW
    function processFee(uint256 amount) external onlyAuthorized nonReentrant {
        if (amount == 0) revert ZeroAmount();
        // T-03: reject amounts below the BPS denominator. The burn leg rounds
        // down and the remainder goes to dev, so at amounts < 10_000 wei the
        // split skews dramatically toward dev (at amount=1, dev gets 100%).
        // An authorized contract splitting a fee into many tiny calls could
        // bleed the burn share toward dev past the advertised 85/15 contract.
        // In-protocol fees are always orders of magnitude above this floor
        // (smallest realistic fee ≈ 5 × 10^18 wei); the guard is defensive.
        if (amount < BPS_DENOMINATOR) revert AmountBelowMinimum(amount, BPS_DENOMINATOR);

        uint256 burnAmount = (amount * BURN_BPS) / BPS_DENOMINATOR;
        uint256 devAmount = amount - burnAmount; // remainder to dev, avoids rounding dust

        // I-04 (SafeERC20): pull, burn, distribute. ClawToken is well-behaved
        // (returns true on every path), but Safe* future-proofs against tokens
        // that revert without a revert string or that return false instead.
        IERC20(address(clawToken)).safeTransferFrom(msg.sender, address(this), amount);

        // Burn 85% (ClawToken-specific; not part of IERC20)
        clawToken.burn(burnAmount);

        // Send 15% to dev wallet
        if (devAmount > 0) {
            IERC20(address(clawToken)).safeTransfer(devWallet, devAmount);
        }

        emit FeeProcessed(msg.sender, amount, burnAmount, devAmount);
    }
}
