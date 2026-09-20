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
    /// @dev D-02: lifetime cap on faucet lobsters — 10,000 wallets x 5, the same population the
    ///      70M CLAW pre-mint is sized for (10,000 x 7,000). The CLAW drip is bounded by the
    ///      faucet's balance; lobsters were bounded by nothing, and a faucet lobster mines the
    ///      705M pool with no stake. Without this, the ELIGIBILITY key (a hot, always-online
    ///      service key) could mint an unlimited sybil mining fleet that outlives its rotation.
    uint256 public constant MAX_FAUCET_LOBSTERS = 50_000;
    /// @dev D-10: the lobsters of a claim are rolled from the hash of a block that does not
    ///      exist yet when the claim is made (request block + 2), exactly as BreedingLab does.
    uint256 public constant FINALIZE_MIN_BLOCKS = 2;
    /// @dev EIP-2935 history contract (8,191 blocks, ~4.5 h on Base). Consulted when the
    ///      256-block `blockhash` window has passed; absent on chains without it, which is fine.
    address internal constant HISTORY_STORAGE = 0x0000F90827F1C53a10cb7A02335B175320002935;

    // ──────────── State ────────────
    LobsterNFT public lobsterNFT;
    ClawToken public clawToken;
    uint256 public closeTime;

    mapping(address => bool) public hasClaimedLobsters;
    mapping(address => bool) public hasClaimedClaw;
    mapping(address => bool) public isEligible;
    uint256 public totalLobstersClaimed;
    uint256 public totalClawClaimed;

    /// @dev D-10: one lobster claim. Sequential ids so a keeper can walk them with a cursor.
    struct LobsterClaim {
        address claimer;
        uint64 targetBlock; // the lobsters are rolled from this block's hash
        bool finalized;
    }

    uint256 public nextClaimId = 1;
    mapping(uint256 => LobsterClaim) internal _claims;
    /// @notice The claim id of a wallet, or 0 if it never claimed lobsters.
    mapping(address => uint256) public claimIdOf;

    // ──────────── Events ────────────
    /// @dev D-10: step 1. The claim is committed; the lobsters do not exist yet.
    event LobsterClaimRequested(uint256 indexed claimId, address indexed claimer, uint256 targetBlock);
    /// @dev Step 2 (finalizeClaim): the five lobsters were minted.
    event LobstersClaimed(address indexed claimer, uint256[5] tokenIds);
    /// @dev The target block's hash was no longer available; a new target was set.
    event LobsterClaimRearmed(uint256 indexed claimId, uint256 newTargetBlock);
    event ClawClaimed(address indexed claimer, uint256 amount);
    event EligibilitySet(address indexed account, bool eligible);
    event UnclaimedBurned(uint256 amount);

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
    /// @dev D-02: the lifetime faucet lobster cap has been reached.
    error FaucetLobsterCapReached();
    // D-10: two-step claim
    error ClaimDoesNotExist(uint256 claimId);
    error ClaimAlreadyFinalized(uint256 claimId);
    error TooEarlyToFinalize(uint256 claimId, uint256 targetBlock);
    error ClaimExpired(uint256 claimId);
    error ClaimNotExpired(uint256 claimId);
    error LobsterClaimPending();

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

    /// @notice Step 1 of 2: commit to claiming 5 random soulbound lobsters. They are minted by
    ///         `finalizeClaim` a few seconds later (anyone may call it; a keeper does).
    /// @return claimId The id to finalize.
    /// @dev D-10 (audit 2026-09). This used to mint at once from
    ///      keccak(prevrandao, msg.sender, index, timestamp) — every input known to the claimer
    ///      before they sign. On Base prevrandao is the L1-origin RANDAO, fixed about a minute
    ///      ahead and shared by ~6 L2 blocks, so a wallet could compute the class, alleles and
    ///      purity of all five lobsters for every upcoming block and only claim in a good one;
    ///      an account with code (a smart wallet, or an EOA delegated under EIP-7702) could do it
    ///      risk-free by reverting on a bad roll, since the claim flag and the mints were one
    ///      transaction. "Only whitelist EOAs" never worked: smart wallets are legitimate users.
    ///
    ///      Now the claim is COMMITTED here — flag set, cap counted, no way back — and the roll
    ///      comes from blockhash(targetBlock), a value that does not exist yet. There is
    ///      nothing to predict and nothing left to revert.
    /// @dev L-05: `nonReentrant` kept as defence in depth (no external call happens here now).
    function claimLobsters() external nonReentrant returns (uint256 claimId) {
        if (block.timestamp >= closeTime) revert FaucetIsClosed();
        if (!isEligible[msg.sender]) revert NotEligible();
        if (msg.sender.balance < MIN_ETH_BALANCE) revert InsufficientETHBalance();
        if (hasClaimedLobsters[msg.sender]) revert LobstersAlreadyClaimed();
        if (totalLobstersClaimed + LOBSTERS_PER_CLAIM > MAX_FAUCET_LOBSTERS) revert FaucetLobsterCapReached(); // D-02

        hasClaimedLobsters[msg.sender] = true;
        totalLobstersClaimed += LOBSTERS_PER_CLAIM;

        claimId = nextClaimId++;
        uint256 targetBlock = block.number + FINALIZE_MIN_BLOCKS;
        _claims[claimId] = LobsterClaim({claimer: msg.sender, targetBlock: uint64(targetBlock), finalized: false});
        claimIdOf[msg.sender] = claimId;

        emit LobsterClaimRequested(claimId, msg.sender, targetBlock);
    }

    /// @notice Step 2 of 2: mint the five lobsters of a committed claim to its claimer.
    ///         Permissionless — the lobsters always go to the original claimer — and allowed
    ///         after the faucet closes, so a claim made in the last minute is never stranded.
    /// @dev The mints call `onERC1155Received` on a contract claimer, which can see the roll and
    ///      revert. That does not give it a second roll: the claim simply stays pending on the
    ///      same block hash until that hash ages out of reach (256 blocks, or ~4.5 h where
    ///      EIP-2935 is live), and `rearmClaim` then points it at a NEW future block. A veto
    ///      costs hours per attempt instead of nothing per block; an honest wallet is finalized
    ///      by the keeper within seconds.
    function finalizeClaim(uint256 claimId) external nonReentrant returns (uint256[5] memory tokenIds) {
        LobsterClaim storage c = _claims[claimId];
        if (c.claimer == address(0)) revert ClaimDoesNotExist(claimId);
        if (c.finalized) revert ClaimAlreadyFinalized(claimId);
        // blockhash(targetBlock) only exists once a LATER block is being built.
        if (block.number <= c.targetBlock) revert TooEarlyToFinalize(claimId, c.targetBlock);
        bytes32 entropy = _blockHashOf(c.targetBlock);
        if (entropy == bytes32(0)) revert ClaimExpired(claimId);

        c.finalized = true;
        address claimer = c.claimer;
        for (uint256 i = 0; i < LOBSTERS_PER_CLAIM; i++) {
            tokenIds[i] = lobsterNFT.mint(claimer, _generateRandomDNA(entropy, claimer, claimId, i), true);
        }

        emit LobstersClaimed(claimer, tokenIds);
    }

    /// @notice A claim whose target block hash is no longer retrievable gets a new target.
    ///         Permissionless. Nothing is lost: the claim stays committed and is finalized
    ///         against the new block. Only callable once the old hash is really gone, so it
    ///         cannot be used to swap a known roll for a fresh one.
    function rearmClaim(uint256 claimId) external {
        LobsterClaim storage c = _claims[claimId];
        if (c.claimer == address(0)) revert ClaimDoesNotExist(claimId);
        if (c.finalized) revert ClaimAlreadyFinalized(claimId);
        if (block.number <= c.targetBlock || _blockHashOf(c.targetBlock) != bytes32(0)) revert ClaimNotExpired(claimId);

        uint256 targetBlock = block.number + FINALIZE_MIN_BLOCKS;
        c.targetBlock = uint64(targetBlock);
        emit LobsterClaimRearmed(claimId, targetBlock);
    }

    /// @notice A claim by id.
    function getClaim(uint256 claimId) external view returns (LobsterClaim memory) {
        return _claims[claimId];
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
        // D-10: the drip is for wallets that HOLD their faucet lobsters, so the claim must be
        // finalized, not merely requested.
        if (!_claims[claimIdOf[msg.sender]].finalized) revert LobsterClaimPending();
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

    /// @notice FAU-M1: burn the unclaimed $CLAW pre-mint after the faucet closes.
    /// @dev The 70M pre-mint is realistically under-claimed; without this the residual
    ///      (potentially tens of millions of $CLAW) would be permanently locked in the
    ///      faucet — the same lock class as the Treasury reserve (TOK-H1). Gated to
    ///      `block.timestamp >= closeTime` so it can NEVER fire mid-window or front-run
    ///      a legitimate claim (claims revert FaucetIsClosed at the same boundary).
    ///      Governance decision 2026-09-02: the destination is BURN, hardcoded — no
    ///      recipient parameter exists, so the pre-commitment is enforced by the
    ///      contract itself rather than by policy. Rational agents can price the
    ///      faucet window knowing nobody (dev included) benefits from unclaimed funds.
    function burnUnclaimed() external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (block.timestamp < closeTime) revert FaucetStillOpen();
        uint256 balance = clawToken.balanceOf(address(this));
        clawToken.burn(balance);
        emit UnclaimedBurned(balance);
    }

    // ──────────── View ────────────

    /// @notice Check if the faucet is still open.
    function isFaucetOpen() external view returns (bool) {
        return block.timestamp < closeTime;
    }

    // ──────────── Internal ────────────

    /// @dev Hash of block `n`: the native 256-block window first, then the EIP-2935 history
    ///      contract where the chain has one. bytes32(0) means it is out of reach.
    function _blockHashOf(uint256 n) internal view returns (bytes32 h) {
        h = blockhash(n);
        if (h == bytes32(0) && HISTORY_STORAGE.code.length > 0) {
            (bool ok, bytes memory ret) = HISTORY_STORAGE.staticcall(abi.encode(n));
            if (ok && ret.length == 32) h = abi.decode(ret, (bytes32));
        }
    }

    /// @dev DNA of lobster `index` of a claim. `entropy` is the hash of a block that did not
    ///      exist when the claim was committed (D-10); the claimer and claim id keep two claims
    ///      finalized against the same block from rolling the same lobsters.
    function _generateRandomDNA(bytes32 entropy, address claimer, uint256 claimId, uint256 index)
        internal
        pure
        returns (uint256)
    {
        uint256 seed = uint256(keccak256(abi.encodePacked(entropy, claimer, claimId, index)));

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
