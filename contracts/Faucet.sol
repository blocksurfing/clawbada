// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LobsterNFT} from "./LobsterNFT.sol";
import {ClawToken} from "./ClawToken.sol";
import {DNALib} from "./libraries/DNALib.sol";

/// @title Faucet — Temporary onboarding for Clawbada
/// @notice Gives eligible wallets 5 soulbound lobsters + 7,000 $CLAW. Closes ~7 days after launch.
/// @dev Eligibility is set by admin (off-chain verification of wallet age/txs). ETH balance checked on-chain.
/// @custom:security-contact security@clawbada.com
contract Faucet is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────── Roles ────────────
    bytes32 public constant ELIGIBILITY_ROLE = keccak256("ELIGIBILITY_ROLE");

    // ──────────── Constants ────────────
    uint256 public constant LOBSTERS_PER_CLAIM = 5;
    uint256 public constant CLAW_DRIP_AMOUNT = 7_000e18;
    uint256 public constant MIN_ETH_BALANCE = 0.001 ether;
    uint256 public constant MAX_BATCH_SIZE = 500;

    // ──────────── State ────────────
    LobsterNFT public lobsterNFT;
    ClawToken public clawToken;
    uint256 public closeTime;

    mapping(address => bool) public hasClaimedLobsters;
    mapping(address => bool) public hasClaimedClaw;
    mapping(address => bool) public isEligible;
    uint256 public totalLobstersClaimed;
    uint256 public totalClawClaimed;

    // ──────────── Events ────────────
    event LobstersClaimed(address indexed claimer, uint256[5] tokenIds);
    event ClawClaimed(address indexed claimer, uint256 amount);
    event EligibilitySet(address indexed account, bool eligible);
    event UnclaimedSwept(address indexed to, uint256 amount);

    // ──────────── Errors ────────────
    error FaucetIsClosed();
    error NotEligible();
    error InsufficientETHBalance();
    error LobstersAlreadyClaimed();
    error ClawAlreadyClaimed();
    error LobstersNotClaimed();
    error ZeroAddress();
    error InsufficientFaucetBalance();
    error BatchTooLarge(uint256 length, uint256 max);
    error FaucetStillOpen();

    // ──────────── Constructor ────────────

    /// @param admin The DEFAULT_ADMIN_ROLE holder
    /// @param lobsterNFT_ The LobsterNFT contract
    /// @param clawToken_ The ClawToken contract
    /// @param closeTime_ Timestamp when faucet closes (~7 days after launch)
    constructor(address admin, address lobsterNFT_, address clawToken_, uint256 closeTime_) {
        if (admin == address(0) || lobsterNFT_ == address(0) || clawToken_ == address(0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        lobsterNFT = LobsterNFT(lobsterNFT_);
        clawToken = ClawToken(clawToken_);
        closeTime = closeTime_;
    }

    // ──────────── Eligibility ────────────

    /// @notice Update the faucet close time. Admin can extend or shorten the faucet window.
    function setCloseTime(uint256 newCloseTime) external onlyRole(DEFAULT_ADMIN_ROLE) {
        closeTime = newCloseTime;
    }

    /// @notice Set eligibility for a single wallet.
    function setEligible(address account, bool eligible) external onlyRole(ELIGIBILITY_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        isEligible[account] = eligible;
        emit EligibilitySet(account, eligible);
    }

    /// @notice Batch set eligibility for multiple wallets.
    function setEligibleBatch(address[] calldata accounts, bool eligible) external onlyRole(ELIGIBILITY_ROLE) {
        if (accounts.length > MAX_BATCH_SIZE) revert BatchTooLarge(accounts.length, MAX_BATCH_SIZE);
        for (uint256 i = 0; i < accounts.length; i++) {
            if (accounts[i] == address(0)) revert ZeroAddress();
            isEligible[accounts[i]] = eligible;
            emit EligibilitySet(accounts[i], eligible);
        }
    }

    // ──────────── Claim ────────────

    /// @notice Claim 5 random soulbound lobsters.
    /// @return tokenIds The 5 minted token IDs
    /// @dev L-05: `nonReentrant` — the ERC-1155 mints inside this function call
    ///      `onERC1155Received` on the claimer if it's a contract. Without the
    ///      guard, a contract claimer could re-enter (e.g. into `claimClaw`)
    ///      mid-flow. The current code already sets `hasClaimedLobsters = true`
    ///      before the mint loop so claimLobsters re-entry is blocked by the
    ///      flag, but adding `nonReentrant` is defence in depth and matches
    ///      the pattern in every other external state-mutating entrypoint.
    function claimLobsters() external nonReentrant returns (uint256[5] memory tokenIds) {
        if (block.timestamp >= closeTime) revert FaucetIsClosed();
        if (!isEligible[msg.sender]) revert NotEligible();
        if (msg.sender.balance < MIN_ETH_BALANCE) revert InsufficientETHBalance();
        if (hasClaimedLobsters[msg.sender]) revert LobstersAlreadyClaimed();

        hasClaimedLobsters[msg.sender] = true;

        for (uint256 i = 0; i < LOBSTERS_PER_CLAIM; i++) {
            uint256 dna = _generateRandomDNA(i);
            tokenIds[i] = lobsterNFT.mint(msg.sender, dna, true);
        }

        totalLobstersClaimed += LOBSTERS_PER_CLAIM;
        emit LobstersClaimed(msg.sender, tokenIds);
    }

    /// @notice Claim 7,000 $CLAW. Must have claimed lobsters first.
    /// @dev L-05: `nonReentrant`. ClawToken has no callbacks today, so no
    ///      active re-entry vector, but the guard matches the defence-in-
    ///      depth posture of the rest of the protocol and future-proofs
    ///      against any token-side hooks.
    function claimClaw() external nonReentrant {
        if (block.timestamp >= closeTime) revert FaucetIsClosed();
        if (!isEligible[msg.sender]) revert NotEligible();
        if (msg.sender.balance < MIN_ETH_BALANCE) revert InsufficientETHBalance();
        if (!hasClaimedLobsters[msg.sender]) revert LobstersNotClaimed();
        if (hasClaimedClaw[msg.sender]) revert ClawAlreadyClaimed();

        hasClaimedClaw[msg.sender] = true;
        totalClawClaimed += CLAW_DRIP_AMOUNT;

        if (clawToken.balanceOf(address(this)) < CLAW_DRIP_AMOUNT) revert InsufficientFaucetBalance();
        // I-04 SafeERC20: clawToken is typed as ClawToken for the constructor
        // contract reference; cast at the boundary for safeTransfer.
        IERC20(address(clawToken)).safeTransfer(msg.sender, CLAW_DRIP_AMOUNT);
        emit ClawClaimed(msg.sender, CLAW_DRIP_AMOUNT);
    }

    // ──────────── Admin recovery ────────────

    /// @notice FAU-M1: recover the unclaimed $CLAW pre-mint after the faucet closes.
    /// @dev The 70M pre-mint is realistically under-claimed; without this the residual
    ///      (potentially tens of millions of $CLAW) would be permanently locked in the
    ///      faucet — the same lock class as the Treasury reserve (TOK-H1). Gated to
    ///      `block.timestamp >= closeTime` so it can NEVER drain mid-window or front-run
    ///      a legitimate claim (claims revert FaucetIsClosed at the same boundary).
    ///      DEFAULT_ADMIN_ROLE is the governance Safe after the role handoff; route the
    ///      residual to Treasury / MiningPool / a burn address per governance decision.
    /// @param to Recipient of the residual balance (e.g. Treasury or MiningPool).
    function sweepUnclaimed(address to) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (block.timestamp < closeTime) revert FaucetStillOpen();
        uint256 balance = clawToken.balanceOf(address(this));
        IERC20(address(clawToken)).safeTransfer(to, balance);
        emit UnclaimedSwept(to, balance);
    }

    // ──────────── View ────────────

    /// @notice Check if the faucet is still open.
    function isFaucetOpen() external view returns (bool) {
        return block.timestamp < closeTime;
    }

    // ──────────── Internal ────────────

    /// @dev Generate random DNA for a faucet lobster. Not manipulable for soulbound NFTs.
    function _generateRandomDNA(uint256 index) internal view returns (uint256) {
        uint256 seed = uint256(keccak256(abi.encodePacked(block.prevrandao, msg.sender, index, block.timestamp)));

        uint8 class_ = uint8(seed % 10);
        uint8 breedType = uint8((seed >> 8) % 64);

        // slither-disable-next-line uninitialized-local — fixed-size memory array is zero-initialized by Solidity and fully written below (false positive).
        uint8[18] memory alleles;
        uint256 currentSeed = seed;

        for (uint256 i = 0; i < 18; i++) {
            // Re-hash every 4 alleles to get fresh randomness
            if (i > 0 && i % 4 == 0) {
                currentSeed = uint256(keccak256(abi.encodePacked(currentSeed, i)));
            }

            uint256 shift = 16 + (i % 4) * 16;
            uint8 affinity = uint8((currentSeed >> shift) % 10);
            uint8 variant = uint8((currentSeed >> (shift + 4)) % 16);
            alleles[i] = (affinity << 4) | variant;
        }

        return DNALib.encode(class_, 0, breedType, alleles); // legend=0 for faucet
    }

    // ──────────── Overrides ────────────

    function supportsInterface(bytes4 interfaceId) public view override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
