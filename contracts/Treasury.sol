// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev The one thing Treasury needs from $GOLD beyond ERC-20: burning. BattleArena imports this too.
interface IGoldBurnable is IERC20 {
    function burn(uint256 amount) external;
}

/// @title Treasury — Protocol fee splitter for Clawbada
/// @notice Receives $GOLD fees from game contracts and splits: 85% burn / 15% dev wallet.
/// @dev All game contracts that collect fees call processFee() after approving this contract.
///      Treasury does NOT accumulate tokens — each processFee call is atomic pull-split-burn. Anything that lands
///      here by mistake has a mechanical way out (IA-05, independent audit A1): stray $GOLD is swept by anyone through
///      the same 85/15 split, other tokens are returned by the owner.
/// @custom:security-contact security@clawbada.com
contract Treasury is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeERC20 for IGoldBurnable;

    // ──────────── Constants ────────────
    uint256 public constant BURN_BPS = 8500;
    uint256 public constant DEV_BPS = 1500;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ──────────── State ────────────
    IGoldBurnable public goldToken;
    address public devWallet;
    mapping(address => bool) public authorized;

    // ──────────── Events ────────────
    event FeeProcessed(address indexed from, uint256 amount, uint256 burned, uint256 toDev);
    event GoldSwept(address indexed caller, uint256 amount, uint256 burned, uint256 toDev);
    event TokensRecovered(address indexed token, address indexed to, uint256 amount);
    event DevWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event AuthorizationUpdated(address indexed account, bool isAuthorized);
    event GoldTokenSet(address indexed token);

    // ──────────── Errors ────────────
    error NotAuthorized();
    error ZeroAddress();
    error ZeroAmount();
    error TokenAlreadySet();
    error AmountBelowMinimum(uint256 amount, uint256 minimum);
    error InvalidDevWallet();
    /// @dev IA-05: $GOLD only ever leaves the Treasury through the 85/15 split — use sweepGold().
    error CannotRecoverGold();

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

    /// @notice Set the GOLD token address. Can only be called once.
    /// @dev Called after GoldToken is deployed. One-time setup.
    function setGoldToken(address token) external onlyOwner {
        if (address(goldToken) != address(0)) revert TokenAlreadySet();
        if (token == address(0)) revert ZeroAddress();
        goldToken = IGoldBurnable(token);
        emit GoldTokenSet(token);
    }

    /// @notice Update the dev wallet address.
    function setDevWallet(address newDevWallet) external onlyOwner {
        if (newDevWallet == address(0)) revert ZeroAddress();
        // T-04: reject self-routing. Under OZ ERC20, Treasury transferring to itself is a no-op in
        // balance terms, so the 15% leg would accumulate inside Treasury — and sweepGold() would then
        // re-split the same tokens forever instead of paying the dev share out.
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

    /// @notice Return a token that was sent here by mistake — any token except $GOLD.
    /// @dev IA-05 (independent audit A1): without this, mis-sent tokens were stuck forever. $GOLD is refused so the
    ///      owner can never route protocol money anywhere but through the split; stray $GOLD goes through sweepGold().
    /// @param token The token to return
    /// @param to The recipient
    /// @param amount How much to return
    function recoverERC20(IERC20 token, address to, uint256 amount) external onlyOwner {
        if (address(token) == address(0) || to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (address(token) == address(goldToken)) revert CannotRecoverGold();
        token.safeTransfer(to, amount);
        emit TokensRecovered(address(token), to, amount);
    }

    // ──────────── Core ────────────

    /// @notice Process a protocol fee: pull GOLD from caller, burn 85%, send 15% to dev.
    /// @dev Caller must have approved this contract for at least `amount` GOLD.
    /// @param amount The total fee amount in GOLD
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

        // I-04 (SafeERC20): pull, then split. GoldToken is well-behaved (returns true on every
        // path), but Safe* future-proofs against tokens that revert without a revert string or
        // that return false instead.
        goldToken.safeTransferFrom(msg.sender, address(this), amount);
        (uint256 burnAmount, uint256 devAmount) = _split(amount);

        emit FeeProcessed(msg.sender, amount, burnAmount, devAmount);
    }

    /// @notice Route any $GOLD sitting in the Treasury through the normal 85% burn / 15% dev split.
    /// @dev IA-05 (independent audit A1): $GOLD sent here by mistake used to be stuck. Anyone may call this; the
    ///      split is the very code path processFee uses, so nobody — the owner included — chooses where protocol
    ///      money goes. Nothing rests here between fee calls (each one is atomic), so the balance is only ever strays.
    function sweepGold() external nonReentrant {
        uint256 amount = goldToken.balanceOf(address(this));
        if (amount < BPS_DENOMINATOR) revert AmountBelowMinimum(amount, BPS_DENOMINATOR);
        (uint256 burnAmount, uint256 devAmount) = _split(amount);

        emit GoldSwept(msg.sender, amount, burnAmount, devAmount);
    }

    // ──────────── Internal ────────────

    /// @dev Burn 85% of `amount` held by this contract and send the remainder to the dev wallet. The remainder
    ///      (not a second rounded share) goes to dev, so burn + dev == amount exactly; with amount ≥ 10_000 the dev
    ///      share is at least 1_500 wei, so there is nothing to guard against a zero transfer (I-03).
    function _split(uint256 amount) internal returns (uint256 burnAmount, uint256 devAmount) {
        burnAmount = (amount * BURN_BPS) / BPS_DENOMINATOR;
        devAmount = amount - burnAmount;

        // Burn 85% (GoldToken-specific; not part of IERC20)
        goldToken.burn(burnAmount);

        // Send 15% to dev wallet
        goldToken.safeTransfer(devWallet, devAmount);
    }
}
