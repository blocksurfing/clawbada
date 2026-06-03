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
///         move commit-reveal, settlement, timeouts, forfeit, bonded disputes with rate
///         limit. Zero-sum PvP with protocol fee.
/// @dev Uses MATCHMAKER_ROLE (off-chain matchmaker) and RESOLVER_ROLE (off-chain combat engine).
///
/// TRUST MODEL (V3 S1): Resolver proposes, bonded player veto with rate limit, admin final tiebreak.
/// Settlement is a two-step flow to bound resolver authority:
///
/// 1. `settle()` (RESOLVER_ROLE) records the proposed winner + damage arrays and
///    transitions the battle to `AwaitingFinalize` with a per-bracket dispute window
///    deadline (5 min Low / 30 min Mid / 1 hour High by default; admin-tunable per
///    bracket via the timelocked `proposeDisputeWindow` + `enactDisputeWindow` pair,
///    24h delay enforced on-chain via `MIN_TUNING_DELAY`; tiered max caps Low=1d /
///    Mid=3d / High=7d). NO transfers happen yet; no damage is applied; teams stay
///    locked.
/// 2a. If neither player calls `disputeBattle()` within the window, anyone can call
///    `finalizeBattle()` after the deadline to execute the proposed payout.
/// 2b. To dispute, a participant must (a) post a bond — 10% of bracket stake by
///    default (250 / 1,000 / 5,000 $CLAW for Low/Mid/High), admin-tunable via the
///    timelocked `proposeDisputeBond` + `enactDisputeBond` pair (24h delay; max cap
///    20% of bracket stake to keep legitimate disputes economically viable); and
///    (b) pass the per-address rate limit (5 disputes per rolling 24h). Bonded
///    disputes set `disputed=true` and freeze payout pending `adminResolveDispute()`
///    (DEFAULT_ADMIN_ROLE). If the admin's final winner differs from the proposed
///    winner, the disputer's bond is refunded; otherwise it is slashed to Treasury
///    via the standard 85/15 burn-dev split.
///
/// Settlement is additionally gated to require at least one fully verified round
/// (both commits + both reveals posted on-chain), so the resolver cannot settle
/// a battle whose Active phase never saw any on-chain move data.
///
/// OPEN RISK: if admin is AWOL while a battle is disputed, its stakes stay escrowed
/// indefinitely. A future "long-dispute auto-cancel" could mitigate; for now admin
/// liveness is assumed within a reasonable SLA (24h per docs/runbooks/admin-roles.md).
///
/// V3 S2 ROADMAP: outcome verification moves on-chain via `BattleResolver.replay()` —
/// deterministic re-execution from {initial state + VRF beacon + ordered turn
/// submissions}. This will deprecate `adminResolveDispute()` once the off-chain
/// engine has stabilized and the on-chain port has parity-tested. See the V3
/// design memo for the full S1/S2 rollout.
///
/// See: docs/audits/2026-03-06-manual-contract-audit.md (H-01 origin),
///      docs/audits/2026-04-15-adversarial-campaign.md (H-01 challenge window),
///      project_battle_v2_redesign.md (V3 design + S1/S2 rollout).
/// @custom:security-contact security@clawbada.com
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
    // F-04: power score = sum of evolution tier values across the 3 lobsters
    // on a team. Evolved=1, Elite=2, Apex=3. Bounds match the off-chain
    // Power Matchmaking helpers in @clawbada/game-logic.
    uint8 public constant MIN_TEAM_POWER = 3;
    uint8 public constant MAX_TEAM_POWER = 9;
    uint8 public constant MAX_ROUNDS = 7;
    uint256 public constant NUM_STAKE_BRACKETS = 3;
    uint256 public constant EMERGENCY_WITHDRAW_DELAY = 24 hours;
    // V3 dispute rate limit — per-address sliding window
    uint256 public constant DISPUTE_RATE_WINDOW = 24 hours;
    uint8 public constant DISPUTE_RATE_LIMIT = 5; // max disputes per address per DISPUTE_RATE_WINDOW
    // V3 S1 hardening (T-02): on-chain timelock for admin tuning of dispute params
    uint256 public constant MIN_TUNING_DELAY = 24 hours;

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
        // F-04: power-binding snapshot recorded at createBattle time. revealTeam
        // recomputes the team's CURRENT power and reverts if it drifted from
        // these values — closes the match-found→reveal smurfing window.
        uint8 powerA;
        uint8 powerB;
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
        // V3 S1: bonded disputes — set by disputeBattle(), consumed by adminResolveDispute()
        address disputer;            // who filed the dispute (for refund/slash routing)
        uint256 disputeBondPaid;     // bond escrowed at dispute time (snapshot of disputeBonds[bracket])
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

    // V3 S1: per-bracket dispute tunables (bracket index aligned with STAKE_BRACKETS)
    uint256[3] public disputeWindows; // [Low, Mid, High] dispute window seconds
    uint256[3] public disputeBonds;   // [Low, Mid, High] bond required to dispute (in $CLAW wei)

    // V3 S1: per-address dispute rate limit — sliding 24h window of recent dispute timestamps
    // slither-disable-next-line uninitialized-state — mapping to a dynamic array, populated via push() in _addDisputeTimestamp; mappings need no initialization (false positive).
    mapping(address => uint64[]) private _disputeTimestamps;

    // V3 S1 hardening (T-02): pending admin tuning, applied by enact* after MIN_TUNING_DELAY.
    // proposedAt == 0 indicates no pending change for that bracket.
    uint256[3] public pendingDisputeWindow;
    uint64[3]  public pendingDisputeWindowAt;
    uint256[3] public pendingDisputeBond;
    uint64[3]  public pendingDisputeBondAt;

    // ──────────── Events ────────────
    event BattleCreated(uint256 indexed battleId, address indexed playerA, address indexed playerB, uint256 stakeAmount, uint8 powerA, uint8 powerB);
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
    // V3 S1: bonded dispute + admin tuning lifecycle
    event DisputeBondPosted(uint256 indexed battleId, address indexed disputer, uint256 amount);
    event DisputeBondRefunded(uint256 indexed battleId, address indexed disputer, uint256 amount);
    event DisputeBondSlashed(uint256 indexed battleId, address indexed disputer, uint256 amount);
    event DisputeWindowSet(uint256 indexed bracketIndex, uint256 oldWindow, uint256 newWindow);
    event DisputeBondSet(uint256 indexed bracketIndex, uint256 oldBond, uint256 newBond);
    // V3 S1 hardening (T-02): timelocked admin tuning — propose then enact after MIN_TUNING_DELAY
    event DisputeWindowProposed(uint256 indexed bracketIndex, uint256 newWindow, uint256 enactableAt);
    event DisputeBondProposed(uint256 indexed bracketIndex, uint256 newBond, uint256 enactableAt);

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
    /// @dev F-04: createBattle param outside [MIN_TEAM_POWER, MAX_TEAM_POWER].
    error InvalidPowerScore(uint8 powerScore);
    /// @dev F-04: revealTeam saw a different team-power than the matchmaker
    ///      recorded at createBattle. Indicates a mid-flow lobster swap that
    ///      would have moved the player into a different bracket.
    error TeamPowerChanged(uint256 teamId, uint8 expected, uint8 actual);
    error PhaseNotTimedOut(uint256 battleId);
    error PhaseTimedOut(uint256 battleId); // BA-M1: action attempted after its phase deadline
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
    // V3 S1: bonded disputes + rate limit
    error DisputeRateLimitExceeded(address disputer, uint256 retryAvailableAt);
    error InvalidStakeBracket(uint256 bracketIndex);
    error InvalidDisputeWindow(uint256 newWindow);
    error InvalidDisputeBond(uint256 newBond);
    // V3 S1 hardening (T-02): timelocked admin tuning
    error NoPendingChange(uint256 bracketIndex);
    error TuningDelayNotElapsed(uint256 bracketIndex, uint256 enactableAt);

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

        // V3 S1: per-bracket dispute window defaults — chess-site-style scaling
        disputeWindows[0] = 5 minutes;   // Low: fast finalize, low downside
        disputeWindows[1] = 30 minutes;  // Mid
        disputeWindows[2] = 1 hours;     // High: matches typical chess-site challenge windows

        // V3 S1: per-bracket dispute bond defaults — 10% of bracket stake
        disputeBonds[0] = 250e18;    // 10% of 2,500
        disputeBonds[1] = 1_000e18;  // 10% of 10,000
        disputeBonds[2] = 5_000e18;  // 10% of 50,000
    }

    // ──────────── Matchmaker ────────────

    /// @notice Create a new battle between two players. Called by off-chain matchmaker.
    /// @param playerA First player address
    /// @param playerB Second player address
    /// @param stakeAmount Must be one of STAKE_BRACKETS
    /// @return battleId The ID of the created battle
    function createBattle(
        address playerA,
        address playerB,
        uint256 stakeAmount,
        uint8 powerA,
        uint8 powerB
    )
        external
        onlyRole(MATCHMAKER_ROLE)
        returns (uint256 battleId)
    {
        if (playerA == playerB) revert PlayerCannotBeSelf();
        if (playerA == address(0) || playerB == address(0)) revert ZeroAddress();
        if (!_isValidStake(stakeAmount)) revert InvalidStakeAmount(stakeAmount);
        // F-04: power-binding params come from the matchmaker's M-02 re-read.
        // Validated bounds (3..9) here so a misbehaving matchmaker can't write
        // garbage that would later fail validation via underflow/overflow.
        if (powerA < MIN_TEAM_POWER || powerA > MAX_TEAM_POWER) revert InvalidPowerScore(powerA);
        if (powerB < MIN_TEAM_POWER || powerB > MAX_TEAM_POWER) revert InvalidPowerScore(powerB);

        battleId = nextBattleId++;

        Battle storage b = _battles[battleId];
        b.playerA = playerA;
        b.playerB = playerB;
        b.stakeAmount = stakeAmount;
        b.powerA = powerA;
        b.powerB = powerB;
        b.phase = BattlePhase.Deposit;
        b.phaseDeadline = block.timestamp + DEPOSIT_WINDOW;

        emit BattleCreated(battleId, playerA, playerB, stakeAmount, powerA, powerB);
    }

    // ──────────── Player Actions ────────────

    /// @notice Deposit stake + anti-grief for a battle.
    function deposit(uint256 battleId) external nonReentrant {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.Deposit);
        _requireParticipant(battleId, msg.sender);
        // BA-M1: phase deadlines are enforced at the action, not only via handleTimeout.
        // After expiry the only valid transition is handleTimeout().
        if (block.timestamp > b.phaseDeadline) revert PhaseTimedOut(battleId);

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
        if (block.timestamp > b.phaseDeadline) revert PhaseTimedOut(battleId); // BA-M1

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
    // slither-disable-next-line reentrancy-no-eth — setTeamActive() calls the trusted TeamManager (no callback); the post-call phase write is benign bookkeeping and all shared-state entrypoints are phase-gated.
    function revealTeam(uint256 battleId, uint256 teamId, bytes32 salt) external {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.TeamReveal);
        _requireParticipant(battleId, msg.sender);
        if (block.timestamp > b.phaseDeadline) revert PhaseTimedOut(battleId); // BA-M1

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

        // Validate team — also returns the current team power for F-04 binding.
        uint8 currentPower = _validateTeamForBattle(teamId, msg.sender);

        // F-04: revealed team's power must match the matchmaker's snapshot.
        // Without this, a player can queue with a low-power team, get matched
        // against a similar-power opponent, then swap to a high-power team
        // before reveal — defeating Power Matchmaking.
        uint8 expectedPower = isA ? b.powerA : b.powerB;
        if (currentPower != expectedPower) {
            revert TeamPowerChanged(teamId, expectedPower, currentPower);
        }

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
        if (block.timestamp > b.phaseDeadline) revert PhaseTimedOut(battleId); // BA-M1

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
        // BA-M1: no late reveals. After REVEAL_WINDOW the only path is handleTimeout(),
        // which (BA-H1) settles the non-revealer as the loser.
        if (block.timestamp > b.phaseDeadline) revert PhaseTimedOut(battleId);

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
        // V3 S1: per-bracket dispute window. _stakeBracket reverts on unknown stake,
        // but settle() only runs on battles whose stake was validated at createBattle().
        b.payoutDeadline = block.timestamp + disputeWindows[_stakeBracket(b.stakeAmount)];

        emit BattleProposed(battleId, winner, b.payoutDeadline);
    }

    /// @notice Step 2a of H-01 + V3 S1 bonded dispute: either participant can dispute the
    ///         proposed outcome within the per-bracket dispute window by posting a bond and
    ///         passing the per-address rate limit. Sets `disputed=true` and freezes payout
    ///         pending `adminResolveDispute()`. Evidence is passed through in the event for
    ///         off-chain admin review; it is not verified on-chain.
    /// @dev V3 S1 additions vs original H-01:
    ///       - Caller must `approve` the dispute bond (`disputeBonds[bracket]`) on the
    ///         $CLAW token to this contract before calling. Bond is escrowed on the Battle
    ///         struct and routed by `adminResolveDispute()`.
    ///       - Per-address rate limit: at most `DISPUTE_RATE_LIMIT` disputes per
    ///         `DISPUTE_RATE_WINDOW` (rolling). Old timestamps are pruned in-place.
    /// @param battleId The battle to dispute
    /// @param evidence Optional off-chain evidence blob (arbitrary bytes; emitted for admin review)
    function disputeBattle(uint256 battleId, bytes calldata evidence) external nonReentrant {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.AwaitingFinalize);
        _requireParticipant(battleId, msg.sender);
        if (block.timestamp > b.payoutDeadline) revert DisputeWindowClosed(battleId, b.payoutDeadline);
        if (b.disputed) revert AlreadyDisputed(battleId);

        // V3 S1: rate limit check + record (reverts DisputeRateLimitExceeded if hit).
        // Done before bond pull so frivolous spammers don't spend gas on transferFrom.
        _addDisputeTimestamp(msg.sender);

        // V3 S1: pull bond. Snapshot the bond amount on the Battle struct so admin
        // tuning of disputeBonds[bracket] mid-window doesn't affect already-disputed
        // battles. Bond stays escrowed until adminResolveDispute() routes it.
        uint256 bond = disputeBonds[_stakeBracket(b.stakeAmount)];
        b.disputed = true;
        b.disputer = msg.sender;
        b.disputeBondPaid = bond;
        if (bond > 0) {
            clawToken.safeTransferFrom(msg.sender, address(this), bond);
            emit DisputeBondPosted(battleId, msg.sender, bond);
        }

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
    // slither-disable-next-line reentrancy-no-eth — nonReentrant; external calls are to the trusted Treasury/LobsterNFT/TeamManager (no callback); CEI holds (phase set in _executePayout before transfers), post-call writes are benign.
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

        // V3 S1: route the dispute bond. If admin's final winner differs from the
        // resolver's proposed winner, the disputer was right (server proposed wrong)
        // → refund the bond. Otherwise the disputer was wrong (server's outcome stands)
        // → slash the bond to Treasury (85% burn / 15% dev split).
        // Snapshot the disputer + bond locally and clear them on the struct first (CEI).
        address disputer = b.disputer;
        uint256 bond = b.disputeBondPaid;
        b.disputer = address(0);
        b.disputeBondPaid = 0;

        if (bond > 0) {
            // BA-M2: the disputer prevails if the admin changed the outcome in ANY
            // respect — the winner OR either damage array — not just the winner.
            // Previously `disputerWon = (winner != b.proposedWinner)` meant a valid
            // damage-only dispute (correct winner, wrong damage) always lost its bond,
            // leaving corrupt damage economically unchallengeable.
            bool disputerWon = (winner != b.proposedWinner)
                || !_damageEq(winnerDamage, b.proposedWinnerDamage)
                || !_damageEq(loserDamage, b.proposedLoserDamage);
            if (disputerWon) {
                clawToken.safeTransfer(disputer, bond);
                emit DisputeBondRefunded(battleId, disputer, bond);
            } else {
                clawToken.forceApprove(address(treasury), bond);
                treasury.processFee(bond);
                emit DisputeBondSlashed(battleId, disputer, bond);
            }
        }

        emit BattleAdminResolved(battleId, winner);
        _executePayout(battleId, winner, winnerDamage, loserDamage);
    }

    // ──────────── Admin Tuning (V3 S1) ────────────
    // Two-step propose+enact pattern with MIN_TUNING_DELAY (T-02). Defaults are set
    // directly in the constructor; only later changes from defaults require the timelock.

    /// @notice Propose a new dispute window (seconds) for a stake bracket. Becomes
    ///         enactable after MIN_TUNING_DELAY via `enactDisputeWindow`.
    /// @dev DEFAULT_ADMIN_ROLE-gated; expected to be a Gnosis Safe multisig per
    ///      docs/runbooks/admin-roles.md. Re-proposing before enact overwrites the
    ///      pending value AND resets the delay timer.
    /// @param bracketIndex 0=Low, 1=Mid, 2=High
    /// @param newWindow New window in seconds. Bounds (T-03 tiered):
    ///                  Low ∈ [60s, 1 day], Mid ∈ [60s, 3 days], High ∈ [60s, 7 days].
    ///                  Tiered caps prevent compromised admin from indefinitely stalling
    ///                  low-value payouts that should clear quickly.
    function proposeDisputeWindow(uint256 bracketIndex, uint256 newWindow)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (bracketIndex >= NUM_STAKE_BRACKETS) revert InvalidStakeBracket(bracketIndex);
        // T-03: tiered max windows by bracket so admin can't stall Low payouts for a week.
        uint256 maxWindow = bracketIndex == 0 ? 1 days : (bracketIndex == 1 ? 3 days : 7 days);
        if (newWindow < 60 seconds || newWindow > maxWindow) revert InvalidDisputeWindow(newWindow);
        pendingDisputeWindow[bracketIndex] = newWindow;
        pendingDisputeWindowAt[bracketIndex] = uint64(block.timestamp);
        emit DisputeWindowProposed(bracketIndex, newWindow, block.timestamp + MIN_TUNING_DELAY);
    }

    /// @notice Enact a previously-proposed dispute window after MIN_TUNING_DELAY has elapsed.
    /// @dev Already-disputed battles snapshot the window via `payoutDeadline` at settle()
    ///      and are unaffected by later enactment.
    function enactDisputeWindow(uint256 bracketIndex) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bracketIndex >= NUM_STAKE_BRACKETS) revert InvalidStakeBracket(bracketIndex);
        uint256 proposedAt = uint256(pendingDisputeWindowAt[bracketIndex]);
        if (proposedAt == 0) revert NoPendingChange(bracketIndex);
        uint256 enactableAt = proposedAt + MIN_TUNING_DELAY;
        if (block.timestamp < enactableAt) revert TuningDelayNotElapsed(bracketIndex, enactableAt);

        uint256 newWindow = pendingDisputeWindow[bracketIndex];
        uint256 old = disputeWindows[bracketIndex];
        disputeWindows[bracketIndex] = newWindow;

        pendingDisputeWindow[bracketIndex] = 0;
        pendingDisputeWindowAt[bracketIndex] = 0;

        emit DisputeWindowSet(bracketIndex, old, newWindow);
    }

    /// @notice Propose a new dispute bond ($CLAW wei) for a stake bracket. Becomes
    ///         enactable after MIN_TUNING_DELAY via `enactDisputeBond`.
    /// @dev DEFAULT_ADMIN_ROLE-gated. Re-proposing before enact overwrites + resets timer.
    ///      Already-disputed battles snapshot the bond on the Battle struct
    ///      (`disputeBondPaid`) and are unaffected by later enactment.
    /// @param bracketIndex 0=Low, 1=Mid, 2=High
    /// @param newBond New bond in $CLAW wei. Zero disables the bond requirement for that
    ///                bracket. Max 20% of bracket stake (T-01) — tighter than 50% so a
    ///                compromised admin can't make legitimate disputes prohibitively
    ///                expensive (which would let resolver cheats stand unchallenged).
    function proposeDisputeBond(uint256 bracketIndex, uint256 newBond)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (bracketIndex >= NUM_STAKE_BRACKETS) revert InvalidStakeBracket(bracketIndex);
        // T-01: cap at 20% of bracket stake (was 50%) to keep legitimate disputes affordable.
        uint256 maxBond = STAKE_BRACKETS[bracketIndex] / 5;
        // BA-M3: a nonzero bond below the Treasury fee floor (BPS_DENOMINATOR wei)
        // is accepted here but makes adminResolveDispute's slash branch revert forever
        // inside treasury.processFee, permanently locking the disputed battle's escrow
        // (finalize/handleTimeout/emergencyWithdraw are all blocked once disputed).
        // Require either 0 (bonding disabled) or >= the floor.
        if (newBond != 0 && newBond < BPS_DENOMINATOR) revert InvalidDisputeBond(newBond);
        if (newBond > maxBond) revert InvalidDisputeBond(newBond);
        pendingDisputeBond[bracketIndex] = newBond;
        pendingDisputeBondAt[bracketIndex] = uint64(block.timestamp);
        emit DisputeBondProposed(bracketIndex, newBond, block.timestamp + MIN_TUNING_DELAY);
    }

    /// @notice Enact a previously-proposed dispute bond after MIN_TUNING_DELAY has elapsed.
    function enactDisputeBond(uint256 bracketIndex) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bracketIndex >= NUM_STAKE_BRACKETS) revert InvalidStakeBracket(bracketIndex);
        uint256 proposedAt = uint256(pendingDisputeBondAt[bracketIndex]);
        if (proposedAt == 0) revert NoPendingChange(bracketIndex);
        uint256 enactableAt = proposedAt + MIN_TUNING_DELAY;
        if (block.timestamp < enactableAt) revert TuningDelayNotElapsed(bracketIndex, enactableAt);

        uint256 newBond = pendingDisputeBond[bracketIndex];
        uint256 old = disputeBonds[bracketIndex];
        disputeBonds[bracketIndex] = newBond;

        pendingDisputeBond[bracketIndex] = 0;
        pendingDisputeBondAt[bracketIndex] = 0;

        emit DisputeBondSet(bracketIndex, old, newBond);
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
        // slither-disable-next-line incorrect-equality — enum equality against the zero/None sentinel is exact and safe.
        if (_battles[battleId].phase == BattlePhase.None) revert BattleDoesNotExist(battleId);
        return _battles[battleId];
    }

    /// @notice Number of disputes posted by `disputer` within the rolling
    ///         `DISPUTE_RATE_WINDOW`. Pure view; does not mutate.
    /// @dev Read-only counterpart of `_addDisputeTimestamp` for off-chain UX
    ///      (e.g., showing an agent how many dispute slots they have left).
    function activeDisputesFor(address disputer) external view returns (uint256 count) {
        uint64[] storage timestamps = _disputeTimestamps[disputer];
        uint256 cutoff = block.timestamp >= DISPUTE_RATE_WINDOW
            ? block.timestamp - DISPUTE_RATE_WINDOW
            : 0;
        for (uint256 i = 0; i < timestamps.length; i++) {
            if (uint256(timestamps[i]) > cutoff) {
                count++;
            }
        }
    }

    // ──────────── Internal ────────────

    function _requirePhase(uint256 battleId, BattlePhase expected) internal view {
        BattlePhase actual = _battles[battleId].phase;
        // slither-disable-next-line incorrect-equality — enum equality against the zero/None sentinel is exact and safe.
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

    /// @dev Resolve a stake amount to its bracket index (0=Low, 1=Mid, 2=High).
    ///      Reverts `InvalidStakeAmount` for unknown stakes; callers within the
    ///      contract only invoke this on already-validated stakes.
    function _stakeBracket(uint256 amount) internal view returns (uint256) {
        for (uint256 i = 0; i < NUM_STAKE_BRACKETS; i++) {
            if (amount == STAKE_BRACKETS[i]) return i;
        }
        revert InvalidStakeAmount(amount);
    }

    /// @dev Sliding-window per-address rate limit for `disputeBattle`. Prunes
    ///      timestamps older than `DISPUTE_RATE_WINDOW`, then reverts
    ///      `DisputeRateLimitExceeded` if the post-prune count is at the cap, else
    ///      pushes `block.timestamp`. Pruning is O(length) but length is bounded by
    ///      `DISPUTE_RATE_LIMIT` in steady state — older entries can only accumulate
    ///      transiently between disputes that hit the cap.
    function _addDisputeTimestamp(address disputer) internal {
        uint64[] storage timestamps = _disputeTimestamps[disputer];
        uint256 cutoff = block.timestamp >= DISPUTE_RATE_WINDOW
            ? block.timestamp - DISPUTE_RATE_WINDOW
            : 0;

        // Find first index that's still within the window.
        uint256 firstValid = 0;
        while (firstValid < timestamps.length && uint256(timestamps[firstValid]) <= cutoff) {
            firstValid++;
        }

        uint256 validCount = timestamps.length - firstValid;

        if (validCount >= DISPUTE_RATE_LIMIT) {
            // Earliest still-valid timestamp expires (validCount drops below cap)
            // exactly DISPUTE_RATE_WINDOW after itself.
            uint256 retryAt = uint256(timestamps[firstValid]) + DISPUTE_RATE_WINDOW;
            revert DisputeRateLimitExceeded(disputer, retryAt);
        }

        // Compact valid entries to the start of the array, then trim.
        if (firstValid > 0) {
            for (uint256 i = 0; i < validCount; i++) {
                timestamps[i] = timestamps[firstValid + i];
            }
            for (uint256 i = 0; i < firstValid; i++) {
                timestamps.pop();
            }
        }

        timestamps.push(uint64(block.timestamp));
    }

    /// @dev F-04: returns the team's current power score (sum of evolution
    ///      tier values across its 3 lobsters) so callers can compare against
    ///      a snapshotted value without iterating the lobster set twice.
    function _validateTeamForBattle(uint256 teamId, address player) internal view returns (uint8 power) {
        // Check team exists and is owned by player
        if (!teamManager.teamExists(teamId)) revert TeamNotOwned(teamId);
        TeamManager.Team memory team = teamManager.getTeam(teamId);
        if (team.owner != player) revert TeamNotOwned(teamId);

        // Check team not already in a battle
        if (teamInBattle[teamId]) revert TeamAlreadyInBattle(teamId);

        // Check team not active (in mining etc)
        if (team.active) revert TeamAlreadyInBattle(teamId);

        // Validate all 3 lobsters: evolution tier >= 1 and damage <= 79.
        // Sum tier values to get the team power score (Evolved=1, Elite=2, Apex=3).
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
            power += tier;
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

    /// @dev BA-M2 helper: exact equality of two 3-element damage arrays.
    function _damageEq(uint8[3] memory x, uint8[3] memory y) internal pure returns (bool) {
        return x[0] == y[0] && x[1] == y[1] && x[2] == y[2];
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

    /// @dev BA-H1 fix: an Active-phase forfeit is a LOSS, not a cheap neutral exit.
    ///      The non-forfeiting player is awarded the battle (combined pot minus the
    ///      protocol fee, plus their own anti-grief back); the forfeiter loses their
    ///      full stake AND has their anti-grief slashed to Treasury — making
    ///      abandonment strictly worse than playing to a settled loss. Closes the
    ///      round-1 reveal-withhold exploit where the old soft refund (-5%) beat a
    ///      settled loss (-100%) and denied the honest player the pot it earned.
    ///      Pre-Active forfeits (`_handleCommitTimeout`/`_handleRevealTimeout`) keep the
    ///      neutral `_forfeit` refund since no battle has been played there.
    function _forfeitAsLoss(uint256 battleId, address loser) internal {
        Battle storage b = _battles[battleId];
        b.phase = BattlePhase.Settled;

        address winner = loser == b.playerA ? b.playerB : b.playerA;
        b.winner = winner;

        uint256 combinedPot = b.stakeAmount * 2;
        uint256 protocolFee = combinedPot * PROTOCOL_FEE_BPS / BPS_DENOMINATOR;
        uint256 winnerPayout = combinedPot - protocolFee;
        uint256 antiGrief = b.stakeAmount * ANTI_GRIEF_BPS / BPS_DENOMINATOR;

        // Protocol fee + the forfeiter's slashed anti-grief both route to Treasury
        // (85% burn / 15% dev). A single processFee call keeps the amount above the
        // 10k-wei floor. CEI: phase already set to Settled above.
        uint256 toTreasury = protocolFee + antiGrief;
        clawToken.forceApprove(address(treasury), toTreasury);
        treasury.processFee(toTreasury);
        emit AntiGriefSlashed(battleId, loser, antiGrief);

        // Winner: pot - fee + their own anti-grief back. Forfeiter: nothing returned.
        clawToken.safeTransfer(winner, winnerPayout + antiGrief);

        // No resolver damage on a forfeit (the battle was not resolved) — the economic
        // penalty is the forfeited stake. Release both teams.
        _releaseTeam(b.teamIdA);
        _releaseTeam(b.teamIdB);

        emit BattleSettled(battleId, winner, winnerPayout, protocolFee);
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
                // BA-H1: withholding a reveal after committing is a LOSS, not a cheap
                // exit. Award the battle to the player who did reveal; slash the
                // withholder's stake + anti-grief. No retries (a reveal leaks move data).
                _forfeitAsLoss(battleId, b.playerA);
                return;
            } else if (!bRevealed) {
                _forfeitAsLoss(battleId, b.playerB);
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
                    _forfeitAsLoss(battleId, b.playerA); // BA-H1: Active forfeit = loss
                    return;
                }
            } else {
                b.consecutiveTimeoutsB++;
                if (b.consecutiveTimeoutsB >= AUTO_FORFEIT_THRESHOLD) {
                    _forfeitAsLoss(battleId, b.playerB); // BA-H1
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
                _forfeitAsLoss(battleId, b.playerA); // BA-H1: Active forfeit = loss
                return;
            }
            if (!bCommitted) {
                _forfeitAsLoss(battleId, b.playerB); // BA-H1
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
