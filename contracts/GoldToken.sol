// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title GoldToken — $GOLD ERC-20 token for Clawbada
/// @notice Fixed LIFETIME supply of 1B tokens: once a token has been minted its slice of the cap is spent for good,
///         so burned tokens are never re-minted. Fair launch: 70.5% mining emissions, 12.5% LP, 10% treasury, 7% faucet.
/// @dev Constructor mints: 125M to LP, 100M to Treasury. Faucet receives 70M via Configure.s.sol post-deploy. The remaining
///      705M is minted by MiningPool under its own MINING_ALLOCATION cap. IA-01 (independent audit A1, 2026-10): the cap is
///      enforced on `totalMinted`, not `totalSupply()`, so Treasury burns do not hand headroom back to a minter.
/// @custom:security-contact security@clawbada.com
contract GoldToken is ERC20, ERC20Burnable, AccessControl {
    // ──────────── Constants ────────────
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public constant MAX_SUPPLY = 1_000_000_000e18; // 1 billion tokens — a lifetime cap, not a circulating one
    uint256 public constant LP_ALLOCATION = 125_000_000e18;
    uint256 public constant TREASURY_ALLOCATION = 100_000_000e18;

    // ──────────── State ────────────
    /// @notice Every token ever minted, the constructor allocations included. Burns never reduce it.
    uint256 public totalMinted;

    // ──────────── Errors ────────────
    error ExceedsMaxSupply(uint256 requested, uint256 available);
    error ZeroAddress();

    // ──────────── Constructor ────────────

    /// @param admin The DEFAULT_ADMIN_ROLE holder (deployer)
    /// @param lpAddress Receives 125M $GOLD for DEX liquidity
    /// @param treasuryAddress Receives 100M $GOLD for protocol reserves
    constructor(address admin, address lpAddress, address treasuryAddress) ERC20("Grubby Old Lost Doubloons", "GOLD") {
        if (admin == address(0) || lpAddress == address(0) || treasuryAddress == address(0)) {
            revert ZeroAddress();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        totalMinted = LP_ALLOCATION + TREASURY_ALLOCATION;
        _mint(lpAddress, LP_ALLOCATION);
        _mint(treasuryAddress, TREASURY_ALLOCATION);
    }

    // ──────────── Minting ────────────

    /// @notice Mint new tokens. Only callable by addresses with MINTER_ROLE (e.g., MiningPool).
    /// @dev Enforces the LIFETIME cap: `totalMinted` can never pass MAX_SUPPLY, whatever has been burned since.
    ///      Reverts ExceedsMaxSupply(requested, available) otherwise.
    /// @param to Recipient address
    /// @param amount Amount to mint (18 decimals)
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        uint256 available = MAX_SUPPLY - totalMinted;
        if (amount > available) revert ExceedsMaxSupply(amount, available);
        totalMinted += amount;
        _mint(to, amount);
    }

    // ──────────── View ────────────

    /// @notice Tokens that can still ever be minted (MAX_SUPPLY − totalMinted). A burn does not change it.
    function remainingMintable() external view returns (uint256) {
        return MAX_SUPPLY - totalMinted;
    }

    // ──────────── Overrides ────────────

    function supportsInterface(bytes4 interfaceId) public view override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
