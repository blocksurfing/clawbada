// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ClawToken — $CLAW ERC-20 token for Clawbada
/// @notice Fixed max supply of 1B tokens. Fair launch: 77.5% mining emissions, 12.5% LP, 10% treasury.
/// @dev Initial mints at deployment: 125M to LP, 100M to Treasury. Remaining 775M minted by MiningPool over time.
contract ClawToken is ERC20, ERC20Burnable, AccessControl {
    // ──────────── Constants ────────────
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public constant MAX_SUPPLY = 1_000_000_000e18; // 1 billion tokens
    uint256 public constant LP_ALLOCATION = 125_000_000e18;
    uint256 public constant TREASURY_ALLOCATION = 100_000_000e18;

    // ──────────── Errors ────────────
    error ExceedsMaxSupply(uint256 requested, uint256 available);
    error ZeroAddress();

    // ──────────── Constructor ────────────

    /// @param admin The DEFAULT_ADMIN_ROLE holder (deployer)
    /// @param lpAddress Receives 125M $CLAW for DEX liquidity
    /// @param treasuryAddress Receives 100M $CLAW for protocol reserves
    constructor(address admin, address lpAddress, address treasuryAddress) ERC20("Clawbada", "CLAW") {
        if (admin == address(0) || lpAddress == address(0) || treasuryAddress == address(0)) {
            revert ZeroAddress();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        _mint(lpAddress, LP_ALLOCATION);
        _mint(treasuryAddress, TREASURY_ALLOCATION);
    }

    // ──────────── Minting ────────────

    /// @notice Mint new tokens. Only callable by addresses with MINTER_ROLE (e.g., MiningPool).
    /// @dev Enforces MAX_SUPPLY cap. Reverts if minting would exceed 1B total.
    /// @param to Recipient address
    /// @param amount Amount to mint (18 decimals)
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        uint256 available = MAX_SUPPLY - totalSupply();
        if (amount > available) revert ExceedsMaxSupply(amount, available);
        _mint(to, amount);
    }

    // ──────────── View ────────────

    /// @notice Returns the remaining mintable supply (MAX_SUPPLY - totalSupply).
    function remainingMintable() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }

    // ──────────── Overrides ────────────

    function supportsInterface(bytes4 interfaceId) public view override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
