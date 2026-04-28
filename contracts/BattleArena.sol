// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LobsterNFT} from "./LobsterNFT.sol";
import {TeamManager} from "./TeamManager.sol";
import {Treasury} from "./Treasury.sol";
import {BattleVRF} from "./BattleVRF.sol";

/// @title BattleArena — Battle lifecycle state machine for Clawbada
/// @notice Manages the full battle lifecycle: stake escrow, team commit-reveal, per-round
///         move commit-reveal, settlement, timeouts, and forfeit. Zero-sum PvP with protocol fee.
/// @dev Uses MATCHMAKER_ROLE (off-chain matchmaker) and RESOLVER_ROLE (off-chain combat engine).
///
/// TRUST MODEL: Resolver proposes, 5-minute player veto, admin final tiebreak.
/// Settlement is a two-step flow to bound resolver authority:
///
/// 1. `settle()` (RESOLVER_ROLE) records the proposed winner + damage arrays and
///    transitions the battle to `AwaitingFinalize` with a `DISPUTE_WINDOW` deadline.
///    NO transfers happen yet; no damage is applied; teams stay locked.
/// 2a. If neither player calls `disputeBattle()` within the window, anyone can call
///    `finalizeBattle()` after the deadline to execute the proposed payout.
/// 2b. If either player disputes within the window, the battle freezes pending
///    `adminResolveDispute()` (DEFAULT_ADMIN_ROLE), which lets the admin set the
///    final winner + damage values. There is no on-chain verification of the
///    dispute evidence — admin reviews off-chain.
///
/// Settlement is additionally gated to require at least one fully verified round
/// (both commits + both reveals posted on-chain), so the resolver cannot settle
/// a battle whose Active phase never saw any on-chain move data.
///
/// OPEN RISK: if admin is AWOL while a battle is disputed, its stakes stay escrowed
/// indefinitely. A future "long-dispute auto-cancel" could mitigate; for now admin
/// liveness is assumed within a reasonable SLA.
///
/// If the battle system is intended to become trustless, outcome verification must
/// move on-chain: bind settlement to the committed/revealed move transcript, bind
/// randomness to BattleVRF, enforce round sequencing and terminal conditions before
/// payout, and compute damage from verified state instead of accepting calldata.
///
/// See: docs/audits/2026-03-06-manual-contract-audit.md (H-01),
///      docs/audits/2026-04-15-adversarial-campaign.md (H-01 challenge window).
contract BattleArena is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────── Roles ────────────
    bytes32 public constant MATCHMAKER_ROLE = keccak256("MATCHMAKER_ROLE");
    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");

    // ──────────── Constants ────────────
    uint256 public constant ANTI_GRIEF_BPS = 500; // 5%
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant PROTOCOL_FEE_BPS = 1000; // 10% of combined pot
    uint256 public constant DEPOSIT_WINDOW = 2 minutes;
    uint256 public constant TEAM_COMMIT_WINDOW = 30 seconds;
    uint256 public constant TEAM_REVEAL_WINDOW = 20 seconds;
    uint256 public constant COMMIT_WINDOW = 60 seconds; // per phase (positioning + combat)
    uint256 public constant REVEAL_WINDOW = 15 seconds;
    uint8 public constant AUTO_FORFEIT_THRESHOLD = 3;
    uint8 public constant MIN_EVOLUTION_TIER = 1; // Evolved+
    uint8 public constant MAX_DAMAGE_FOR_BATTLE = 79; // <80 to enter
    uint8 public constant MAX_ROUNDS = 7;
    uint256 public constant NUM_STAKE_BRACKETS = 3;
    uint256 public constant EMERGENCY_WITHDRAW_DELAY = 24 hours;
    uint256 public constant DISPUTE_WINDOW = 5 minutes; // H-01: player veto window after settle()

    // ──────────── Types ────────────
    enum BattlePhase {
        None,
        Deposit,
        TeamCommit,
        TeamReveal,
        Active,
        AwaitingFinalize, // H-01: settle() has proposed an outcome; awaiting dispute window + finalize
        Settled,
        Cancelled
    }
    enum CancelReason { DepositTimeout, ForfeitA, ForfeitB, MutualTimeout, StaleBattle }

    struct Battle {
        address playerA;
        address playerB;
        uint256 teamIdA;
        uint256 teamIdB;
        uint256 stakeAmount;
        BattlePhase phase;
        uint8 currentRound; // 0=pre-combat, 1-7 during combat
        uint8 lastVerifiedRound; // highest round where both move reveals were posted on-chain
        uint8 consecutiveTimeoutsA;
        uint8 consecutiveTimeoutsB;
        uint256 phaseDeadline;
        uint256 lastProgressAt; // last meaningful state advance (for emergency withdraw)
        address winner; // address(0) until settled
        // Deposit tracking
        bool depositA;
        bool depositB;
        // Team commit-reveal
        bytes32 teamCommitA;
        bytes32 teamCommitB;
        bool teamRevealedA;
        bool teamRevealedB;
        // Round commit-reveal (current round only)
        bytes32 roundCommitA;
        bytes32 roundCommitB;
        bool roundRevealedA;
        bool roundRevealedB;
        // H-01 challenge window: proposed outcome recorded by settle() and awaiting finalize
        address proposedWinner;
        uint256 payoutDeadline;
        bool disputed;
        uint8[3] proposedWinnerDamage;
        uint8[3] proposedLoserDamage;
    }

    // ──────────── State ────────────
    IERC20 public clawToken;
    LobsterNFT public lobsterNFT;
    TeamManager public teamManager;
    Treasury public treasury;
    BattleVRF public battleVRF;

    uint256 public nextBattleId = 1;
    mapping(uint256 => Battle) private _battles;
    mapping(uint256 => bool) public teamInBattle; // teamId → active battle

    uint256[3] public STAKE_BRACKETS;

    // ──────────── Events ────────────
    event BattleCreated(uint256 indexed battleId, address indexed playerA, address indexed playerB, uint256 stakeAmount);
    event StakeDeposited(uint256 indexed battleId, address indexed player);
    event TeamCommitted(uint256 indexed battleId, address indexed player);
    event TeamRevealed(uint256 indexed battleId, address indexed player, uint256 teamId);
    event RoundStarted(uint256 indexed battleId, uint8 round);
    event MoveCommitted(uint256 indexed battleId, uint8 round, address indexed player);
    event MoveRevealed(uint256 indexed battleId, uint8 round, address indexed player, bytes moveData);
    event BattleSettled(uint256 indexed battleId, address indexed winner, uint256 winnerPayout, uint256 protocolFee);
    event BattleCancelled(uint256 indexed battleId, CancelReason reason);
    event DamageApplied(uint256 indexed battleId, uint256 indexed lobsterId, uint8 damage);
    event AntiGriefSlashed(uint256 indexed battleId, address indexed player, uint256 amount);
    // H-01 challenge window lifecycle
    event BattleProposed(uint256 indexed battleId, address indexed proposedWinner, uint256 payoutDeadline);
    event BattleDisputed(uint256 indexed battleId, address indexed disputer, bytes evidence);
    event BattleAdminResolved(uint256 indexed battleId, address indexed winner);

    // ──────────── Errors ────────────
    error ZeroAddress();
    error InvalidStakeAmount(uint256 amount);
    error BattleDoesNotExist(uint256 battleId);
    error InvalidBattlePhase(uint256 battleId, BattlePhase expected, BattlePhase actual);
    error NotBattleParticipant(uint256 battleId);
    error AlreadyDeposited(uint256 battleId);
    error AlreadyCommitted(uint256 battleId);
    error AlreadyRevealed(uint256 battleId);
    error InvalidCommitHash(uint256 battleId);
    error TeamNotOwned(uint256 teamId);
    error TeamAlreadyInBattle(uint256 teamId);
    error LobsterTierTooLow(uint256 lobsterId, uint8 required, uint8 actual);
    error LobsterDamageTooHigh(uint256 lobsterId, uint8 damage);
    error PhaseNotTimedOut(uint256 battleId);
    error BothRevealsRequired(uint256 battleId);
    error PlayerCannotBeSelf();
    error InvalidWinner(uint256 battleId);
    error SettlementRequiresVerifiedRound(uint256 battleId);
    error EmergencyWithdrawTooEarly(uint256 battleId, uint256 availableAt);
    error BothCommitsRequired(uint256 battleId);
    error MaxRoundsReached(uint256 battleId);
    // H-01 challenge window
    error DisputeWindowOpen(uint256 battleId, uint256 deadline);
    error DisputeWindowClosed(uint256 battleId, uint256 deadline);
    error AlreadyDisputed(uint256 battleId);
    error NotDisputed(uint256 battleId);
    error BattleIsDisputed(uint256 battleId);
    error DisputedBattleRequiresAdmin(uint256 battleId);

    // ──────────── Constructor ────────────

    /// @param admin The DEFAULT_ADMIN_ROLE holder
    /// @param clawToken_ The $CLAW ERC-20 token
    /// @param lobsterNFT_ The LobsterNFT contract
    /// @param teamManager_ The TeamManager contract
    /// @param treasury_ The Treasury fee splitter
    /// @param battleVRF_ The BattleVRF randomness provider
    constructor(
        address admin,
        address clawToken_,
        address lobsterNFT_,
        address teamManager_,
        address treasury_,
        address battleVRF_
    ) {
        if (
            admin == address(0) || clawToken_ == address(0) || lobsterNFT_ == address(0)
                || teamManager_ == address(0) || treasury_ == address(0) || battleVRF_ == address(0)
        ) {
            revert ZeroAddress();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        clawToken = IERC20(clawToken_);
        lobsterNFT = LobsterNFT(lobsterNFT_);
        teamManager = TeamManager(teamManager_);
        treasury = Treasury(treasury_);
        battleVRF = BattleVRF(battleVRF_);

        STAKE_BRACKETS[0] = 2_500e18;
        STAKE_BRACKETS[1] = 10_000e18;
        STAKE_BRACKETS[2] = 50_000e18;
    }

    // ──────────── Matchmaker ────────────

    /// @notice Create a new battle between two players. Called by off-chain matchmaker.
    /// @param playerA First player address
    /// @param playerB Second player address
    /// @param stakeAmount Must be one of STAKE_BRACKETS
    /// @return battleId The ID of the created battle
    function createBattle(address playerA, address playerB, uint256 stakeAmount)
        external
        onlyRole(MATCHMAKER_ROLE)
        returns (uint256 battleId)
    {
        if (playerA == playerB) revert PlayerCannotBeSelf();
        if (playerA == address(0) || playerB == address(0)) revert ZeroAddress();
        if (!_isValidStake(stakeAmount)) revert InvalidStakeAmount(stakeAmount);

        battleId = nextBattleId++;

        Battle storage b = _battles[battleId];
        b.playerA = playerA;
        b.playerB = playerB;
        b.stakeAmount = stakeAmount;
        b.phase = BattlePhase.Deposit;
        b.phaseDeadline = block.timestamp + DEPOSIT_WINDOW;

        emit BattleCreated(battleId, playerA, playerB, stakeAmount);
    }

    // ──────────── Player Actions ────────────

    /// @notice Deposit stake + anti-grief for a battle.
    function deposit(uint256 battleId) external nonReentrant {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.Deposit);
        _requireParticipant(battleId, msg.sender);

        bool isA = msg.sender == b.playerA;
        if (isA) {
            if (b.depositA) revert AlreadyDeposited(battleId);
            b.depositA = true;
        } else {
            if (b.depositB) revert AlreadyDeposited(battleId);
            b.depositB = true;
        }

        uint256 antiGrief = b.stakeAmount * ANTI_GRIEF_BPS / BPS_DENOMINATOR;
        uint256 total = b.stakeAmount + antiGrief;
        clawToken.safeTransferFrom(msg.sender, address(this), total);

        emit StakeDeposited(battleId, msg.sender);

        if (b.depositA && b.depositB) {
            b.phase = BattlePhase.TeamCommit;
            b.phaseDeadline = block.timestamp + TEAM_COMMIT_WINDOW;
        }
    }

    /// @notice Submit a team composition commit hash.
    function commitTeam(uint256 battleId, bytes32 commitHash) external {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.TeamCommit);
        _requireParticipant(battleId, msg.sender);

        bool isA = msg.sender == b.playerA;
        if (isA) {
            if (b.teamCommitA != bytes32(0)) revert AlreadyCommitted(battleId);
            b.teamCommitA = commitHash;
        } else {
            if (b.teamCommitB != bytes32(0)) revert AlreadyCommitted(battleId);
            b.teamCommitB = commitHash;
        }

        emit TeamCommitted(battleId, msg.sender);

        if (b.teamCommitA != bytes32(0) && b.teamCommitB != bytes32(0)) {
            b.phase = BattlePhase.TeamReveal;
            b.phaseDeadline = block.timestamp + TEAM_REVEAL_WINDOW;
        }
    }

    /// @notice Reveal team composition. Validates commit hash, team ownership, tier, and damage.
    function revealTeam(uint256 battleId, uint256 teamId, bytes32 salt) external {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.TeamReveal);
        _requireParticipant(battleId, msg.sender);

        bool isA = msg.sender == b.playerA;

        // Verify commit hash
        bytes32 expected = keccak256(abi.encodePacked(battleId, msg.sender, teamId, salt));
        if (isA) {
            if (b.teamRevealedA) revert AlreadyRevealed(battleId);
            if (expected != b.teamCommitA) revert InvalidCommitHash(battleId);
            b.teamRevealedA = true;
            b.teamIdA = teamId;
        } else {
            if (b.teamRevealedB) revert AlreadyRevealed(battleId);
            if (expected != b.teamCommitB) revert InvalidCommitHash(battleId);
            b.teamRevealedB = true;
            b.teamIdB = teamId;
        }

        // Validate team
        _validateTeamForBattle(teamId, msg.sender);

        // Lock team
        teamInBattle[teamId] = true;
        teamManager.setTeamActive(teamId, true);

        emit TeamRevealed(battleId, msg.sender, teamId);

        if (b.teamRevealedA && b.teamRevealedB) {
            b.phase = BattlePhase.Active;
            b.currentRound = 1;
            b.lastProgressAt = block.timestamp;
            b.phaseDeadline = block.timestamp + COMMIT_WINDOW;
            emit RoundStarted(battleId, 1);
        }
    }

    /// @notice Submit move commit for the current round.
    function commitMoves(uint256 battleId, bytes32 commitHash) external {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.Active);
        _requireParticipant(battleId, msg.sender);

        bool isA = msg.sender == b.playerA;
        if (isA) {
            if (b.roundCommitA != bytes32(0)) revert AlreadyCommitted(battleId);
            b.roundCommitA = commitHash;
        } else {
            if (b.roundCommitB != bytes32(0)) revert AlreadyCommitted(battleId);
            b.roundCommitB = commitHash;
        }

        emit MoveCommitted(battleId, b.currentRound, msg.sender);

        // If both committed, set reveal deadline
        if (b.roundCommitA != bytes32(0) && b.roundCommitB != bytes32(0)) {
            b.phaseDeadline = block.timestamp + REVEAL_WINDOW;
        }
    }

    /// @notice Reveal moves for the current round. Both commits must be present before any reveal.
    function revealMoves(uint256 battleId, bytes calldata moveData, bytes32 salt) external {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.Active);
        _requireParticipant(battleId, msg.sender);

        // F-02: Prevent early reveals that leak move data before both commits are locked
        if (b.roundCommitA == bytes32(0) || b.roundCommitB == bytes32(0)) {
            revert BothCommitsRequired(battleId);
        }

        bool isA = msg.sender == b.playerA;
        bytes32 expected = keccak256(abi.encodePacked(battleId, b.currentRound, msg.sender, moveData, salt));

        if (isA) {
            if (b.roundRevealedA) revert AlreadyRevealed(battleId);
            if (expected != b.roundCommitA) revert InvalidCommitHash(battleId);
            b.roundRevealedA = true;
        } else {
            if (b.roundRevealedB) revert AlreadyRevealed(battleId);
            if (expected != b.roundCommitB) revert InvalidCommitHash(battleId);
            b.roundRevealedB = true;
        }

        emit MoveRevealed(battleId, b.currentRound, msg.sender, moveData);

        // A round becomes settlement-eligible only once both moves have been revealed on-chain.
        if (b.roundRevealedA && b.roundRevealedB) {
            b.lastVerifiedRound = b.currentRound;
        }
    }

    // ──────────── Resolver (Server) ────────────

    /// @notice Advance to the next round after both reveals are done.
    function advanceRound(uint256 battleId) external onlyRole(RESOLVER_ROLE) {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.Active);
        if (!b.roundRevealedA || !b.roundRevealedB) revert BothRevealsRequired(battleId);

        // F-03: Enforce max round cap on-chain (design spec: 7 rounds max)
        if (b.currentRound >= MAX_ROUNDS) revert MaxRoundsReached(battleId);

        b.currentRound++;
        b.lastProgressAt = block.timestamp;
        // NOTE: consecutiveTimeouts counters are NOT reset — they are cumulative
        // across all rounds so agents cannot alternate cooperate/timeout to avoid forfeit.

        // Reset round commit-reveal state
        b.roundCommitA = bytes32(0);
        b.roundCommitB = bytes32(0);
        b.roundRevealedA = false;
        b.roundRevealedB = false;

        b.phaseDeadline = block.timestamp + COMMIT_WINDOW;
        emit RoundStarted(battleId, b.currentRound);
    }

    /// @notice Step 1 of H-01: record the resolver's proposed outcome and open the dispute window.
    /// @dev No transfers, no damage application, no team release until `finalizeBattle()` or
    ///      `adminResolveDispute()`. The phase transitions Active → AwaitingFinalize here.
    function settle(
        uint256 battleId,
        address winner,
        uint8[3] calldata winnerDamage,
        uint8[3] calldata loserDamage
    ) external onlyRole(RESOLVER_ROLE) {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.Active);
        if (b.lastVerifiedRound == 0) revert SettlementRequiresVerifiedRound(battleId);
        if (winner != b.playerA && winner != b.playerB) revert InvalidWinner(battleId);

        b.phase = BattlePhase.AwaitingFinalize;
        b.proposedWinner = winner;
        b.proposedWinnerDamage = winnerDamage;
        b.proposedLoserDamage = loserDamage;
        b.payoutDeadline = block.timestamp + DISPUTE_WINDOW;

        emit BattleProposed(battleId, winner, b.payoutDeadline);
    }

    /// @notice Step 2a of H-01 (player veto): either participant can dispute the proposed
    ///         outcome within DISPUTE_WINDOW. Sets `disputed=true` and freezes payout pending
    ///         `adminResolveDispute()`. Evidence is passed through in the event for off-chain
    ///         review; it is not verified on-chain.
    /// @param battleId The battle to dispute
    /// @param evidence Optional off-chain evidence blob (arbitrary bytes; emitted for admin review)
    function disputeBattle(uint256 battleId, bytes calldata evidence) external {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.AwaitingFinalize);
        _requireParticipant(battleId, msg.sender);
        if (block.timestamp > b.payoutDeadline) revert DisputeWindowClosed(battleId, b.payoutDeadline);
        if (b.disputed) revert AlreadyDisputed(battleId);

        b.disputed = true;
        emit BattleDisputed(battleId, msg.sender, evidence);
    }

    /// @notice Step 2b of H-01 (undisputed finalize): after `payoutDeadline` elapses without a
    ///         dispute, anyone can trigger the payout. The finalization uses exactly the outcome
    ///         proposed by `settle()`. Permissionless so stalled resolvers can't lock funds.
    function finalizeBattle(uint256 battleId) external nonReentrant {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.AwaitingFinalize);
        if (b.disputed) revert BattleIsDisputed(battleId);
        if (block.timestamp <= b.payoutDeadline) revert DisputeWindowOpen(battleId, b.payoutDeadline);

        _executePayout(battleId, b.proposedWinner, b.proposedWinnerDamage, b.proposedLoserDamage);
    }

    /// @notice Step 2c of H-01 (admin override): for disputed battles, DEFAULT_ADMIN_ROLE sets
    ///         the final winner and damage arrays. This fully replaces the resolver's proposal —
    ///         admin is the tiebreaker of last resort.
    /// @dev Admin is expected to review the dispute evidence (emitted by `disputeBattle()`)
    ///      off-chain before calling this. There is no on-chain enforcement that admin has
    ///      done so; admin role holders are accountable via governance/multisig.
    function adminResolveDispute(
        uint256 battleId,
        address winner,
        uint8[3] calldata winnerDamage,
        uint8[3] calldata loserDamage
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.AwaitingFinalize);
        if (!b.disputed) revert NotDisputed(battleId);
        if (winner != b.playerA && winner != b.playerB) revert InvalidWinner(battleId);

        emit BattleAdminResolved(battleId, winner);
        _executePayout(battleId, winner, winnerDamage, loserDamage);
    }

    // ──────────── Timeout ────────────

    /// @notice Handle a phase timeout. Anyone can call this after the deadline passes.
    /// @dev For AwaitingFinalize: if undisputed, this acts as a permissionless finalize
    ///      (equivalent to `finalizeBattle()`); if disputed, reverts with
    ///      `DisputedBattleRequiresAdmin` so the admin path is used.
    function handleTimeout(uint256 battleId) external nonReentrant {
        Battle storage b = _battles[battleId];
        if (b.phase == BattlePhase.None || b.phase == BattlePhase.Settled || b.phase == BattlePhase.Cancelled) {
            revert BattleDoesNotExist(battleId);
        }

        // AwaitingFinalize uses `payoutDeadline`, not `phaseDeadline`, for its clock.
        uint256 deadline = b.phase == BattlePhase.AwaitingFinalize ? b.payoutDeadline : b.phaseDeadline;
        if (block.timestamp <= deadline) revert PhaseNotTimedOut(battleId);

        if (b.phase == BattlePhase.Deposit) {
            _cancelBattle(battleId, CancelReason.DepositTimeout);
        } else if (b.phase == BattlePhase.TeamCommit) {
            _handleCommitTimeout(battleId);
        } else if (b.phase == BattlePhase.TeamReveal) {
            _handleRevealTimeout(battleId);
        } else if (b.phase == BattlePhase.Active) {
            _handleActiveTimeout(battleId);
        } else if (b.phase == BattlePhase.AwaitingFinalize) {
            if (b.disputed) revert DisputedBattleRequiresAdmin(battleId);
            _executePayout(battleId, b.proposedWinner, b.proposedWinnerDamage, b.proposedLoserDamage);
        }
    }

    // ──────────── Emergency ────────────

    /// @notice Emergency neutral exit for stalled Active battles.
    /// @dev Callable by either participant when the resolver has not advanced the battle
    ///      for EMERGENCY_WITHDRAW_DELAY (24 hours). Returns stakes + anti-grief to both
    ///      players. No winner, no damage, no slashing. This is an operational fallback,
    ///      not part of standard battle resolution.
    function emergencyWithdraw(uint256 battleId) external nonReentrant {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.Active);
        _requireParticipant(battleId, msg.sender);

        uint256 availableAt = b.lastProgressAt + EMERGENCY_WITHDRAW_DELAY;
        if (block.timestamp < availableAt) {
            revert EmergencyWithdrawTooEarly(battleId, availableAt);
        }

        _cancelBattle(battleId, CancelReason.StaleBattle);
    }

    // ──────────── View ────────────

    /// @notice Get full battle data.
    function getBattle(uint256 battleId) external view returns (Battle memory) {
        if (_battles[battleId].phase == BattlePhase.None) revert BattleDoesNotExist(battleId);
        return _battles[battleId];
    }

    // ──────────── Internal ────────────

    function _requirePhase(uint256 battleId, BattlePhase expected) internal view {
        BattlePhase actual = _battles[battleId].phase;
        if (actual == BattlePhase.None) revert BattleDoesNotExist(battleId);
        if (actual != expected) revert InvalidBattlePhase(battleId, expected, actual);
    }

    function _requireParticipant(uint256 battleId, address caller) internal view {
        Battle storage b = _battles[battleId];
        if (caller != b.playerA && caller != b.playerB) revert NotBattleParticipant(battleId);
    }

    function _isValidStake(uint256 amount) internal view returns (bool) {
        for (uint256 i = 0; i < NUM_STAKE_BRACKETS; i++) {
            if (amount == STAKE_BRACKETS[i]) return true;
        }
        return false;
    }

    function _validateTeamForBattle(uint256 teamId, address player) internal view {
        // Check team exists and is owned by player
        if (!teamManager.teamExists(teamId)) revert TeamNotOwned(teamId);
        TeamManager.Team memory team = teamManager.getTeam(teamId);
        if (team.owner != player) revert TeamNotOwned(teamId);

        // Check team not already in a battle
        if (teamInBattle[teamId]) revert TeamAlreadyInBattle(teamId);

        // Check team not active (in mining etc)
        if (team.active) revert TeamAlreadyInBattle(teamId);

        // Validate all 3 lobsters: evolution tier >= 1 and damage <= 79
        for (uint256 i = 0; i < 3; i++) {
            uint256 lobId = team.lobsterIds[i];
            uint8 tier = lobsterNFT.getEvolutionTier(lobId);
            if (tier < MIN_EVOLUTION_TIER) {
                revert LobsterTierTooLow(lobId, MIN_EVOLUTION_TIER, tier);
            }
            uint8 damage = lobsterNFT.getDamage(lobId);
            if (damage > MAX_DAMAGE_FOR_BATTLE) {
                revert LobsterDamageTooHigh(lobId, damage);
            }
        }
    }

    /// @dev Shared payout path used by `finalizeBattle` (undisputed) and `adminResolveDispute`
    ///      (disputed). Was inlined in `settle()` before the H-01 split.
    function _executePayout(
        uint256 battleId,
        address winner,
        uint8[3] memory winnerDamage,
        uint8[3] memory loserDamage
    ) internal {
        Battle storage b = _battles[battleId];

        // State updates first (CEI)
        b.phase = BattlePhase.Settled;
        b.winner = winner;

        address loser = winner == b.playerA ? b.playerB : b.playerA;
        uint256 winnerTeam = winner == b.playerA ? b.teamIdA : b.teamIdB;
        uint256 loserTeam = winner == b.playerA ? b.teamIdB : b.teamIdA;

        // I-02 (gas): teamInBattle cleared inside _releaseTeam below; no need
        // for redundant pre-clear here. Reentrancy is already blocked via the
        // `nonReentrant` modifier on every public entrypoint that reaches
        // _executePayout. Mirrors the _cancelBattle pattern.

        // Calculate payouts
        uint256 combinedPot = b.stakeAmount * 2;
        uint256 protocolFee = combinedPot * PROTOCOL_FEE_BPS / BPS_DENOMINATOR;
        uint256 winnerPayout = combinedPot - protocolFee;
        uint256 antiGrief = b.stakeAmount * ANTI_GRIEF_BPS / BPS_DENOMINATOR;

        // Route protocol fee through Treasury (I-03/I-04: forceApprove +
        // safeTransfer; ClawToken is well-behaved but the migration future-
        // proofs against tokens that revert on non-zero-to-non-zero approve).
        clawToken.forceApprove(address(treasury), protocolFee);
        treasury.processFee(protocolFee);

        // Transfer payouts: winner gets pot - fee + their anti-grief, loser gets anti-grief back
        clawToken.safeTransfer(winner, winnerPayout + antiGrief);
        clawToken.safeTransfer(loser, antiGrief);

        // Apply damage to lobsters
        _applyDamage(battleId, winnerTeam, winnerDamage);
        _applyDamage(battleId, loserTeam, loserDamage);

        // Release teams
        _releaseTeam(b.teamIdA);
        _releaseTeam(b.teamIdB);

        emit BattleSettled(battleId, winner, winnerPayout, protocolFee);
    }

    function _applyDamage(uint256 battleId, uint256 teamId, uint8[3] memory damages) internal {
        // TM-01 (M-01 parity): tolerate a deleted team. Under compromised
        // ACTIVITY_ROLE, a battle team can be force-marked inactive and then
        // disbanded by the owner, vaporising `_teams[teamId]`. Without this
        // guard, `teamManager.getTeam(...)` reverts `TeamDoesNotExist` here
        // and permanently bricks the settlement/timeout path, trapping
        // escrowed stakes. Skip damage application instead — lobsters
        // (if they still exist) keep their pre-battle damage.
        if (!teamManager.teamExists(teamId)) return;

        TeamManager.Team memory team = teamManager.getTeam(teamId);
        for (uint256 i = 0; i < 3; i++) {
            uint256 lobId = team.lobsterIds[i];
            uint8 currentDamage = lobsterNFT.getDamage(lobId);
            uint256 sum = uint256(currentDamage) + uint256(damages[i]);
            uint8 newDamage = sum > 100 ? 100 : uint8(sum);
            lobsterNFT.setDamage(lobId, newDamage);
            emit DamageApplied(battleId, lobId, damages[i]);
        }
    }

    function _releaseTeam(uint256 teamId) internal {
        teamInBattle[teamId] = false;
        // TM-01 (M-01 parity): same deleted-team tolerance as _applyDamage.
        // If the team record is gone, skip the cross-contract setTeamActive
        // call so the settlement/timeout path still terminates and releases
        // the escrowed CLAW.
        if (teamManager.teamExists(teamId)) {
            teamManager.setTeamActive(teamId, false);
        }
    }

    function _cancelBattle(uint256 battleId, CancelReason reason) internal {
        Battle storage b = _battles[battleId];
        b.phase = BattlePhase.Cancelled;

        uint256 antiGrief = b.stakeAmount * ANTI_GRIEF_BPS / BPS_DENOMINATOR;
        uint256 depositTotal = b.stakeAmount + antiGrief;

        // Refund any deposits (I-04: safeTransfer)
        if (b.depositA) {
            clawToken.safeTransfer(b.playerA, depositTotal);
        }
        if (b.depositB) {
            clawToken.safeTransfer(b.playerB, depositTotal);
        }

        // Release any committed teams
        if (b.teamRevealedA) _releaseTeam(b.teamIdA);
        if (b.teamRevealedB) _releaseTeam(b.teamIdB);

        emit BattleCancelled(battleId, reason);
    }

    function _forfeit(uint256 battleId, address forfeiter) internal {
        Battle storage b = _battles[battleId];
        b.phase = BattlePhase.Cancelled;

        address other = forfeiter == b.playerA ? b.playerB : b.playerA;
        uint256 antiGrief = b.stakeAmount * ANTI_GRIEF_BPS / BPS_DENOMINATOR;

        // Forfeiter loses anti-grief → Treasury (burned). I-03/I-04: forceApprove
        // + safeTransfer migration.
        clawToken.forceApprove(address(treasury), antiGrief);
        treasury.processFee(antiGrief);
        emit AntiGriefSlashed(battleId, forfeiter, antiGrief);

        // Forfeiter gets stake back (no anti-grief)
        clawToken.safeTransfer(forfeiter, b.stakeAmount);
        // Other player gets stake + their anti-grief back
        clawToken.safeTransfer(other, b.stakeAmount + antiGrief);

        // Release any committed teams
        if (b.teamRevealedA) _releaseTeam(b.teamIdA);
        if (b.teamRevealedB) _releaseTeam(b.teamIdB);

        CancelReason reason = forfeiter == b.playerA ? CancelReason.ForfeitA : CancelReason.ForfeitB;
        emit BattleCancelled(battleId, reason);
    }

    function _handleCommitTimeout(uint256 battleId) internal {
        Battle storage b = _battles[battleId];
        bool aCommitted = b.teamCommitA != bytes32(0);
        bool bCommitted = b.teamCommitB != bytes32(0);

        if (!aCommitted && !bCommitted) {
            // Neither committed → mutual cancel
            _cancelBattle(battleId, CancelReason.MutualTimeout);
        } else if (!aCommitted) {
            _forfeit(battleId, b.playerA);
        } else {
            _forfeit(battleId, b.playerB);
        }
    }

    function _handleRevealTimeout(uint256 battleId) internal {
        Battle storage b = _battles[battleId];

        if (!b.teamRevealedA && !b.teamRevealedB) {
            _cancelBattle(battleId, CancelReason.MutualTimeout);
        } else if (!b.teamRevealedA) {
            _forfeit(battleId, b.playerA);
        } else {
            _forfeit(battleId, b.playerB);
        }
    }

    function _handleActiveTimeout(uint256 battleId) internal {
        Battle storage b = _battles[battleId];
        bool aCommitted = b.roundCommitA != bytes32(0);
        bool bCommitted = b.roundCommitB != bytes32(0);

        // Check reveals if both committed
        if (aCommitted && bCommitted) {
            bool aRevealed = b.roundRevealedA;
            bool bRevealed = b.roundRevealedB;

            if (!aRevealed && !bRevealed) {
                _cancelBattle(battleId, CancelReason.MutualTimeout);
                return;
            } else if (!aRevealed) {
                // Immediate forfeit: withholding a reveal after committing leaks
                // the other player's revealed move data, so we don't allow retries.
                _forfeit(battleId, b.playerA);
                return;
            } else if (!bRevealed) {
                _forfeit(battleId, b.playerB);
                return;
            }
        } else {
            // Commit phase timeout
            if (!aCommitted && !bCommitted) {
                _cancelBattle(battleId, CancelReason.MutualTimeout);
                return;
            } else if (!aCommitted) {
                b.consecutiveTimeoutsA++;
                if (b.consecutiveTimeoutsA >= AUTO_FORFEIT_THRESHOLD) {
                    _forfeit(battleId, b.playerA);
                    return;
                }
            } else {
                b.consecutiveTimeoutsB++;
                if (b.consecutiveTimeoutsB >= AUTO_FORFEIT_THRESHOLD) {
                    _forfeit(battleId, b.playerB);
                    return;
                }
            }
        }

        // Not yet at forfeit threshold — resolver handles default moves.
        // Reset round state and advance round counter, set new deadline for the resolver.
        //
        // N-01: `advanceRound()` got the MAX_ROUNDS cap via F-03, but this neighbor
        // path didn't. At the final round we can't just `currentRound++`, so:
        //   - if one side missed its commit, they forfeit (a stronger version of
        //     AUTO_FORFEIT_THRESHOLD — the final round gives no second chance);
        //   - if both reveals landed, the battle is settlement-ready and the
        //     resolver should call settle() instead of timing the phase out.
        if (b.currentRound >= MAX_ROUNDS) {
            if (!aCommitted) {
                _forfeit(battleId, b.playerA);
                return;
            }
            if (!bCommitted) {
                _forfeit(battleId, b.playerB);
                return;
            }
            revert MaxRoundsReached(battleId);
        }

        b.currentRound++;
        // N-02: keep the emergencyWithdraw clock honest. advanceRound() refreshes
        // lastProgressAt; this timeout-driven twin must too, otherwise a griefer
        // can force cheap cancel-by-emergencyWithdraw after 24h of time-outs by
        // never letting lastProgressAt move past revealTeam.
        b.lastProgressAt = block.timestamp;
        b.roundCommitA = bytes32(0);
        b.roundCommitB = bytes32(0);
        b.roundRevealedA = false;
        b.roundRevealedB = false;
        b.phaseDeadline = block.timestamp + COMMIT_WINDOW;
    }
}
