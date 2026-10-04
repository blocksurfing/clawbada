// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LobsterNFT} from "./LobsterNFT.sol";
import {TeamManager} from "./TeamManager.sol";
import {Treasury, IClawBurnable} from "./Treasury.sol";
import {BattleVRF} from "./BattleVRF.sol";

/// @title BattleArena — Battle lifecycle state machine for Clawbada
/// @notice Manages the full battle lifecycle: stake escrow (with the team commit and the
///         player's consent bound into the deposit), the atomic team reveal, settlement of
///         the off-chain ATB battle, a short review hold before payout, timeouts and the
///         anti-grief deposit. Zero-sum PvP with protocol fee. Turns are played off-chain
///         over WebSocket (V3).
/// @dev Roles: MATCHMAKER_ROLE (off-chain matchmaker), RESOLVER_ROLE (off-chain combat engine),
///      GUARDIAN_ROLE (the watchdog: can only freeze a result for review), DEFAULT_ADMIN_ROLE
///      (the governance Safe).
///
/// TRUST MODEL (S1, owner decision 2026-10-01 — player disputes removed):
///
/// 1. `settle()` (RESOLVER_ROLE) records the result — winner (address(0) = draw), the
///    forfeiting player if the battle ended by resignation or three timeouts, repair damage
///    per slot, and two commitments to the off-chain battle (`finalStateHash`, `turnLogHash`).
///    Damage is applied and BOTH TEAMS ARE RELEASED HERE: a battle result never locks a
///    lobster. Only the money waits, for a per-bracket review window (`reviewWindows`).
/// 2. During the review window a watchdog replays the battle from its log. If it cannot
///    reproduce the result it calls `freeze()` (GUARDIAN_ROLE or the Safe). A guardian key can
///    only pause a payout; it cannot direct money anywhere. (A freeze the Safe never resolves
///    ends, after `FREEZE_LONG_STOP`, in refund-both at the protocol's cost — see 4.)
/// 3. Unfrozen: after the window anyone calls `finalizeBattle()` and the proposed result pays.
/// 4. Frozen: the Safe calls `resolveFrozen()` with the corrected result, or refunds both
///    players. If the Safe has not acted within `FREEZE_LONG_STOP` (72 h), anyone calls
///    `expireFrozen()`: the held stakes are BURNED and both players are paid their stakes back
///    from the refund reserve (anti-grief deposits are returned from escrow). If the reserve
///    cannot cover it, the held stakes are returned directly instead — nobody is left unpaid.
///
/// Losses a glitch causes outside the stakes (wrong repair damage) are made whole off-chain by
/// the treasury. The Active phase carries a hard `ACTIVE_WINDOW`; past it `handleTimeout()`
/// cancels with full refunds, so a server failure never costs a stake.
///
/// ANTI-GRIEF DEPOSIT (5% of stake, D-13/14/15): forfeited by a player who (a) resigns or times
/// out three times in a row (`settle`'s `forfeiter`), or (b) was reported by the resolver
/// (`accuseRevealFailure`) and did not open a PLAYABLE commit themselves within `REVEAL_GRACE` —
/// a commit that does not open, or opens onto a team its owner has since made unrevealable.
///
/// DRAWS (D-03): each side pays half the normal protocol fee (10% of its own stake), so a draw
/// is never cheaper than a decided battle; repair damage applies as usual.
///
/// V3 S2 ROADMAP: outcome verification moves on-chain via `BattleResolver.replay()`.
/// @custom:security-contact security@clawbada.com
contract BattleArena is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────── Roles ────────────
    bytes32 public constant MATCHMAKER_ROLE = keccak256("MATCHMAKER_ROLE");
    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");
    /// @notice The watchdog: may freeze a result under review, nothing else.
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    // ──────────── Constants ────────────
    uint256 public constant ANTI_GRIEF_BPS = 500; // 5%
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant PROTOCOL_FEE_BPS = 1000; // 10% of combined pot (a draw: 10% of each stake)
    uint256 public constant DEPOSIT_WINDOW = 2 minutes;
    uint256 public constant TEAM_REVEAL_WINDOW = 20 seconds;
    /// @dev D-14: once the resolver reports a commit it could not open, the accused player has this
    ///      long to open it themselves before they forfeit the anti-grief deposit.
    uint256 public constant REVEAL_GRACE = 2 minutes;
    /// @dev V3: turns are off-chain. Ceiling for the Active phase = 100 turns × 60 s shot
    ///      clock (≈100 min) plus settle latency slack. Past it, handleTimeout() cancels
    ///      with full refunds so a dead server can never trap stakes.
    uint256 public constant ACTIVE_WINDOW = 3 hours;
    /// @dev D-01: the battle's drand round is the FIRST round whose emission time is at or after
    ///      `revealedAt + SEED_ROUND_DELAY`. Read off-chain; never used for on-chain logic.
    uint256 public constant SEED_ROUND_DELAY = 6 seconds;
    /// @notice How long a frozen result may wait for the Safe before anyone can expire it.
    uint256 public constant FREEZE_LONG_STOP = 72 hours;
    uint8 public constant MIN_EVOLUTION_TIER = 1; // Evolved+
    uint8 public constant MAX_DAMAGE_FOR_BATTLE = 79; // <80 to enter
    /// @dev Review 2026-10-03 D-F: the most repair damage one battle can inflict on one lobster
    ///      (game-logic LOSER_DAMAGE_MAX). Bounds what a stolen resolver key can charge in repairs.
    uint8 public constant MAX_BATTLE_DAMAGE = 40;
    // F-04: power score = sum of evolution tier values across the 3 lobsters on a team.
    uint8 public constant MIN_TEAM_POWER = 3;
    uint8 public constant MAX_TEAM_POWER = 9;
    uint256 public constant NUM_STAKE_BRACKETS = 3;
    uint256 public constant EMERGENCY_WITHDRAW_DELAY = 24 hours;
    // T-02: on-chain timelock for admin tuning of the review windows
    uint256 public constant MIN_TUNING_DELAY = 24 hours;

    // ──────────── Types ────────────
    // Values are part of the off-chain contract (indexer, API, agents read the phase number);
    // keep their order. `TeamCommit` is no longer reachable (the commit moved into deposit()).
    enum BattlePhase {
        None,
        Deposit,
        TeamCommit, // unused since the commit moved into deposit(); kept so later values keep their numbers
        TeamReveal,
        Active,
        AwaitingFinalize, // in review: settle() recorded the result, payout waits for the review window
        Settled,
        Cancelled,
        Frozen // the watchdog (or the Safe) froze the result for review
    }
    // `ForfeitBoth` is appended (review 2026-10-03 I1) so the earlier values keep their numbers.
    enum CancelReason { DepositTimeout, ForfeitA, ForfeitB, MutualTimeout, StaleBattle, ForfeitBoth }

    struct Battle {
        address playerA;
        address playerB;
        uint256 teamIdA;
        uint256 teamIdB;
        uint256 stakeAmount;
        BattlePhase phase;
        // F-04: power-binding snapshot recorded at createBattle time.
        uint8 powerA;
        uint8 powerB;
        uint256 phaseDeadline;
        uint256 lastProgressAt; // last meaningful state advance (for emergency withdraw)
        address winner; // address(0) until settled; stays address(0) for a draw (phase disambiguates)
        // Deposit tracking (the team commit rides in the deposit)
        bool depositA;
        bool depositB;
        bytes32 teamCommitA;
        bytes32 teamCommitB;
        bool teamRevealedA;
        bool teamRevealedB;
        // D-14: reveal-failure attribution
        bool accusedA;
        bool accusedB;
        bool openedA;
        bool openedB;
        // Result under review
        address proposedWinner; // address(0) == draw
        address proposedForfeiter; // address(0) == nobody forfeited
        uint256 payoutDeadline; // end of the review window
        uint64 frozenAt; // 0 unless frozen
        uint8[3] proposedDamageA;
        uint8[3] proposedDamageB;
        bytes32 finalStateHash;
        bytes32 turnLogHash;
        // D-01: battle randomness — see revealTeams / settle.
        bytes32 seedCommit;
        bytes32 seedSecret;
        uint64 revealedAt;
    }

    // ──────────── State ────────────
    IERC20 public clawToken;
    LobsterNFT public lobsterNFT;
    TeamManager public teamManager;
    Treasury public treasury;
    BattleVRF public battleVRF;

    uint256 public nextBattleId = 1;
    mapping(uint256 => Battle) private _battles;
    mapping(uint256 => bool) public teamInBattle; // teamId → in a battle that is still being played

    uint256[3] public STAKE_BRACKETS;

    /// @notice Per-bracket review window (seconds) between settle() and payout.
    uint256[3] public reviewWindows;
    // T-02: pending tuning, applied by enactReviewWindow after MIN_TUNING_DELAY (0 = none pending).
    uint256[3] public pendingReviewWindow;
    uint64[3] public pendingReviewWindowAt;

    /// @notice CLAW held for paying players back when a frozen result expires. Never escrow.
    uint256 public refundReserve;

    // ──────────── Events ────────────
    event BattleCreated(uint256 indexed battleId, address indexed playerA, address indexed playerB, uint256 stakeAmount, uint8 powerA, uint8 powerB);
    event StakeDeposited(uint256 indexed battleId, address indexed player);
    event TeamCommitted(uint256 indexed battleId, address indexed player);
    event TeamRevealed(uint256 indexed battleId, address indexed player, uint256 teamId);
    event BattleSettled(uint256 indexed battleId, address indexed winner, uint256 winnerPayout, uint256 protocolFee);
    event BattleCancelled(uint256 indexed battleId, CancelReason reason);
    event DamageApplied(uint256 indexed battleId, uint256 indexed lobsterId, uint8 damage);
    event AntiGriefSlashed(uint256 indexed battleId, address indexed player, uint256 amount);
    event BattleProposed(
        uint256 indexed battleId,
        address indexed proposedWinner,
        uint256 payoutDeadline,
        bytes32 finalStateHash,
        bytes32 turnLogHash
    );
    event BattleSeedCommitted(uint256 indexed battleId, bytes32 seedCommit, uint64 revealedAt);
    event BattleSeedRevealed(uint256 indexed battleId, bytes32 seedSecret);
    event RevealFailureAccused(uint256 indexed battleId, address indexed player, uint256 graceUntil);
    event CommitOpened(uint256 indexed battleId, address indexed player, uint256 teamId, bytes32 salt);
    event BattleFrozen(uint256 indexed battleId, address indexed by);
    event FrozenResolved(uint256 indexed battleId, address indexed winner, bool refunded);
    event FrozenExpired(uint256 indexed battleId, uint256 burned, uint256 paidFromReserve);
    event ReserveFunded(address indexed from, uint256 amount);
    event ReserveWithdrawn(address indexed to, uint256 amount);
    event ReviewWindowProposed(uint256 indexed bracketIndex, uint256 newWindow, uint256 enactableAt);
    event ReviewWindowSet(uint256 indexed bracketIndex, uint256 oldWindow, uint256 newWindow);

    // ──────────── Errors ────────────
    error ZeroAddress();
    error InvalidStakeAmount(uint256 amount);
    error BattleDoesNotExist(uint256 battleId);
    error InvalidBattlePhase(uint256 battleId, BattlePhase expected, BattlePhase actual);
    error NotBattleParticipant(uint256 battleId);
    error AlreadyDeposited(uint256 battleId);
    error InvalidCommitHash(uint256 battleId);
    error TeamNotOwned(uint256 teamId);
    error TeamAlreadyInBattle(uint256 teamId);
    error LobsterTierTooLow(uint256 lobsterId, uint8 required, uint8 actual);
    error LobsterDamageTooHigh(uint256 lobsterId, uint8 damage);
    error InvalidPowerScore(uint8 powerScore);
    error TeamPowerChanged(uint256 teamId, uint8 expected, uint8 actual);
    /// @dev D-08: the battle is not the one the depositor agreed to.
    error ConsentMismatch(uint256 battleId, uint256 stake, uint8 opponentPower);
    error PhaseNotTimedOut(uint256 battleId);
    error PhaseTimedOut(uint256 battleId);
    error PlayerCannotBeSelf();
    error InvalidWinner(uint256 battleId);
    error InvalidForfeiter(uint256 battleId);
    error DamageTooHigh(uint256 battleId, uint8 slot, uint8 damage);
    error InvalidSettlementHash(uint256 battleId);
    error InvalidSeedCommit(uint256 battleId);
    error InvalidSeedReveal(uint256 battleId);
    error NotAccused(uint256 battleId);
    error AlreadyAccused(uint256 battleId);
    error EmergencyWithdrawTooEarly(uint256 battleId, uint256 availableAt);
    error ReviewWindowOpen(uint256 battleId, uint256 deadline);
    error ReviewWindowClosed(uint256 battleId, uint256 deadline);
    error LongStopNotReached(uint256 battleId, uint256 availableAt);
    error InsufficientReserve(uint256 requested, uint256 available);
    error InvalidStakeBracket(uint256 bracketIndex);
    error InvalidReviewWindow(uint256 newWindow);
    error NoPendingChange(uint256 bracketIndex);
    error TuningDelayNotElapsed(uint256 bracketIndex, uint256 enactableAt);

    // ──────────── Constructor ────────────

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

        // Review windows: long enough for the watchdog to replay the battle and freeze it.
        reviewWindows[0] = 5 minutes;
        reviewWindows[1] = 30 minutes;
        reviewWindows[2] = 1 hours;
    }

    // ──────────── Matchmaker ────────────

    /// @notice Create a new battle between two players. Called by the off-chain matchmaker.
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

    /// @notice Deposit stake + anti-grief and commit your team, in one step.
    /// @dev D-08: `expectedStake` and `maxOpponentPower` bind what the player agreed to — a
    ///      battle with another stake or a stronger opponent reverts `ConsentMismatch`, so a
    ///      misbehaving matchmaker cannot spring a different battle on a depositor.
    ///      D-13: the commit is part of the deposit, so there is no separate commit clock for the
    ///      opponent to start. `commitHash = keccak256(abi.encodePacked(battleId, player, teamId, salt))`.
    function deposit(uint256 battleId, uint256 expectedStake, uint8 maxOpponentPower, bytes32 commitHash)
        external
        nonReentrant
    {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.Deposit);
        _requireParticipant(battleId, msg.sender);
        if (block.timestamp > b.phaseDeadline) revert PhaseTimedOut(battleId); // BA-M1
        if (commitHash == bytes32(0)) revert InvalidCommitHash(battleId);

        bool isA = msg.sender == b.playerA;
        uint8 opponentPower = isA ? b.powerB : b.powerA;
        if (b.stakeAmount != expectedStake || opponentPower > maxOpponentPower) {
            revert ConsentMismatch(battleId, b.stakeAmount, opponentPower);
        }
        if (isA) {
            if (b.depositA) revert AlreadyDeposited(battleId);
            b.depositA = true;
            b.teamCommitA = commitHash;
        } else {
            if (b.depositB) revert AlreadyDeposited(battleId);
            b.depositB = true;
            b.teamCommitB = commitHash;
        }

        uint256 total = b.stakeAmount + _antiGrief(b);
        clawToken.safeTransferFrom(msg.sender, address(this), total);

        emit StakeDeposited(battleId, msg.sender);
        emit TeamCommitted(battleId, msg.sender);

        if (b.depositA && b.depositB) {
            b.phase = BattlePhase.TeamReveal;
            b.phaseDeadline = block.timestamp + TEAM_REVEAL_WINDOW;
        }
    }

    /// @notice Atomically reveal BOTH teams in a single resolver-submitted transaction.
    /// @dev F5-01: atomic, resolver-submitted reveal closes the matchup-dodge exploit (no team
    ///      identity reaches the chain until both are bound together). The resolver cannot forge a
    ///      team — each commit hash binds its (teamId, salt). The teams are locked only while the
    ///      battle is being played; settle() releases them.
    // slither-disable-next-line reentrancy-no-eth — setTeamActive() calls the trusted TeamManager (no callback); the post-call phase write is benign bookkeeping and all shared-state entrypoints are phase-gated.
    function revealTeams(
        uint256 battleId,
        uint256 teamIdA,
        bytes32 saltA,
        uint256 teamIdB,
        bytes32 saltB,
        bytes32 seedCommit
    ) external onlyRole(RESOLVER_ROLE) {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.TeamReveal);
        if (block.timestamp > b.phaseDeadline) revert PhaseTimedOut(battleId); // BA-M1
        if (seedCommit == bytes32(0)) revert InvalidSeedCommit(battleId); // D-01

        if (keccak256(abi.encodePacked(battleId, b.playerA, teamIdA, saltA)) != b.teamCommitA) {
            revert InvalidCommitHash(battleId);
        }
        if (keccak256(abi.encodePacked(battleId, b.playerB, teamIdB, saltB)) != b.teamCommitB) {
            revert InvalidCommitHash(battleId);
        }

        // F-04: each revealed team's power must match the matchmaker's snapshot.
        uint8 powerA = _validateTeamForBattle(teamIdA, b.playerA);
        if (powerA != b.powerA) revert TeamPowerChanged(teamIdA, b.powerA, powerA);
        uint8 powerB = _validateTeamForBattle(teamIdB, b.playerB);
        if (powerB != b.powerB) revert TeamPowerChanged(teamIdB, b.powerB, powerB);

        b.teamIdA = teamIdA;
        b.teamIdB = teamIdB;
        b.teamRevealedA = true;
        b.teamRevealedB = true;
        teamInBattle[teamIdA] = true;
        teamInBattle[teamIdB] = true;
        teamManager.setTeamActive(teamIdA, true);
        teamManager.setTeamActive(teamIdB, true);

        emit TeamRevealed(battleId, b.playerA, teamIdA);
        emit TeamRevealed(battleId, b.playerB, teamIdB);

        // D-01: commit to the seed secret in the transaction that starts the battle.
        b.seedCommit = seedCommit;
        b.revealedAt = uint64(block.timestamp);
        emit BattleSeedCommitted(battleId, seedCommit, uint64(block.timestamp));

        b.phase = BattlePhase.Active;
        b.lastProgressAt = block.timestamp;
        b.phaseDeadline = block.timestamp + ACTIVE_WINDOW;
    }

    /// @notice D-14: the resolver reports that `player`'s commit does not open with the salt they
    ///         handed over (or opens onto a team that cannot be revealed). The player then has
    ///         `REVEAL_GRACE` to open it themselves with `openOwnCommit`; if they do not, the
    ///         battle cancels and they forfeit their 5%.
    /// @dev A false report costs an honest player nothing PROVIDED they answer it: opening a
    ///      playable commit within the grace clears them. A player who is not watching the chain
    ///      (or whose client cannot send a transaction in time) does lose the 5% — to the
    ///      Treasury's burn/dev split, never to the resolver — so the engine must push
    ///      accusations to players and the agent kit must answer them automatically.
    function accuseRevealFailure(uint256 battleId, address player) external onlyRole(RESOLVER_ROLE) {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.TeamReveal);
        _requireParticipant(battleId, player);
        if (block.timestamp > b.phaseDeadline) revert PhaseTimedOut(battleId);
        if (player == b.playerA) {
            if (b.accusedA) revert AlreadyAccused(battleId);
            b.accusedA = true;
        } else {
            if (b.accusedB) revert AlreadyAccused(battleId);
            b.accusedB = true;
        }
        b.phaseDeadline = block.timestamp + REVEAL_GRACE;
        emit RevealFailureAccused(battleId, player, b.phaseDeadline);
    }

    /// @notice D-14: an accused player opens their own commit. The opened (teamId, salt) is emitted
    ///         so the resolver can reveal both teams atomically as usual before the grace ends.
    /// @dev Review 2026-10-03 D-A: opening proves the team is PLAYABLE, not just that the hash
    ///      matches. Before, a commit to a team its owner had since disbanded, sent mining, bound
    ///      to another battle or re-tiered opened fine, cleared the player, and the lapse was a
    ///      no-fault mutual cancel — a free way to walk out of a matched battle. Only the owner
    ///      can make their own team unplayable, so a failed validation here is their fault.
    function openOwnCommit(uint256 battleId, uint256 teamId, bytes32 salt) external {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.TeamReveal);
        _requireParticipant(battleId, msg.sender);
        if (block.timestamp > b.phaseDeadline) revert PhaseTimedOut(battleId);
        bool isA = msg.sender == b.playerA;
        if (isA ? !b.accusedA : !b.accusedB) revert NotAccused(battleId);
        bytes32 commit = isA ? b.teamCommitA : b.teamCommitB;
        if (keccak256(abi.encodePacked(battleId, msg.sender, teamId, salt)) != commit) revert InvalidCommitHash(battleId);
        uint8 expectedPower = isA ? b.powerA : b.powerB;
        uint8 power = _validateTeamForBattle(teamId, msg.sender);
        if (power != expectedPower) revert TeamPowerChanged(teamId, expectedPower, power);
        if (isA) b.openedA = true;
        else b.openedB = true;
        emit CommitOpened(battleId, msg.sender, teamId, salt);
    }

    // ──────────── Resolver (Server) ────────────

    /// @notice Record the battle's result and start its review window. Damage is applied and both
    ///         teams are released now; the stakes wait for the review window (see TRUST MODEL).
    /// @param forfeiter The player who resigned or timed out three turns in a row (address(0) if
    ///        the battle was played out). Must be the loser; they forfeit their 5% at payout.
    /// @dev D-01: `seedSecret` opens the commitment made in revealTeams.
    // slither-disable-next-line reentrancy-no-eth — calls only the trusted LobsterNFT/TeamManager (no callback); the battle is already out of Active before they run.
    function settle(
        uint256 battleId,
        address winner,
        bytes32 finalStateHash,
        bytes32 turnLogHash,
        uint8[3] calldata damageA,
        uint8[3] calldata damageB,
        bytes32 seedSecret,
        address forfeiter
    ) external onlyRole(RESOLVER_ROLE) {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.Active);
        if (block.timestamp > b.phaseDeadline) revert PhaseTimedOut(battleId);
        _requireValidResult(b, battleId, winner, forfeiter);
        // D-F: no battle inflicts more than MAX_BATTLE_DAMAGE on a lobster. A compromised resolver
        // can still submit a wrong result (the watchdog freezes it), but not bar every lobster in
        // every live battle and charge a season of repairs on the way.
        for (uint8 i = 0; i < 3; i++) {
            if (damageA[i] > MAX_BATTLE_DAMAGE) revert DamageTooHigh(battleId, i, damageA[i]);
            if (damageB[i] > MAX_BATTLE_DAMAGE) revert DamageTooHigh(battleId, i, damageB[i]);
        }
        if (finalStateHash == bytes32(0) || turnLogHash == bytes32(0)) revert InvalidSettlementHash(battleId);
        if (keccak256(abi.encodePacked(battleId, seedSecret)) != b.seedCommit) revert InvalidSeedReveal(battleId);
        b.seedSecret = seedSecret;
        emit BattleSeedRevealed(battleId, seedSecret);

        b.phase = BattlePhase.AwaitingFinalize;
        b.proposedWinner = winner;
        b.proposedForfeiter = forfeiter;
        b.proposedDamageA = damageA;
        b.proposedDamageB = damageB;
        b.finalStateHash = finalStateHash;
        b.turnLogHash = turnLogHash;
        b.payoutDeadline = block.timestamp + reviewWindows[_stakeBracket(b.stakeAmount)];
        emit BattleProposed(battleId, winner, b.payoutDeadline, finalStateHash, turnLogHash);

        // The battle is over: lobsters take their damage and go free immediately. Only money waits.
        _applyDamage(battleId, b.teamIdA, damageA);
        _applyDamage(battleId, b.teamIdB, damageB);
        _releaseTeam(b.teamIdA);
        _releaseTeam(b.teamIdB);
    }

    /// @notice Pay out an unfrozen result once its review window has passed. Permissionless.
    function finalizeBattle(uint256 battleId) external nonReentrant {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.AwaitingFinalize);
        if (block.timestamp <= b.payoutDeadline) revert ReviewWindowOpen(battleId, b.payoutDeadline);
        _executePayout(battleId, b.proposedWinner, b.proposedForfeiter);
    }

    // ──────────── Review (watchdog + Safe) ────────────

    /// @notice Freeze a result under review because it could not be reproduced. Moves no money.
    function freeze(uint256 battleId) external {
        if (!hasRole(GUARDIAN_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, GUARDIAN_ROLE);
        }
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.AwaitingFinalize);
        if (block.timestamp > b.payoutDeadline) revert ReviewWindowClosed(battleId, b.payoutDeadline);
        b.phase = BattlePhase.Frozen;
        b.frozenAt = uint64(block.timestamp);
        emit BattleFrozen(battleId, msg.sender);
    }

    /// @notice The Safe settles a frozen battle: pay the corrected result, or refund both players.
    function resolveFrozen(uint256 battleId, address winner, address forfeiter, bool refundBoth)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.Frozen);
        if (refundBoth) {
            b.phase = BattlePhase.Settled;
            b.winner = address(0);
            uint256 back = b.stakeAmount + _antiGrief(b);
            emit FrozenResolved(battleId, address(0), true);
            clawToken.safeTransfer(b.playerA, back);
            clawToken.safeTransfer(b.playerB, back);
            emit BattleSettled(battleId, address(0), 0, 0);
            return;
        }
        _requireValidResult(b, battleId, winner, forfeiter);
        emit FrozenResolved(battleId, winner, false);
        _executePayout(battleId, winner, forfeiter);
    }

    /// @notice After `FREEZE_LONG_STOP` without the Safe, anyone can close a frozen battle: the held
    ///         stakes are burned and both players are paid their stakes back from the refund reserve
    ///         (anti-grief deposits come back from escrow). If the reserve is short, the held stakes
    ///         are returned directly instead (no burn).
    function expireFrozen(uint256 battleId) external nonReentrant {
        _requirePhase(battleId, BattlePhase.Frozen);
        _expireFrozen(battleId);
    }

    /// @notice Add CLAW to the refund reserve (pulled from the caller; approve first).
    function fundReserve(uint256 amount) external nonReentrant {
        refundReserve += amount;
        emit ReserveFunded(msg.sender, amount);
        clawToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice The Safe takes CLAW out of the refund reserve. Escrow is never reachable this way.
    function withdrawReserve(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount > refundReserve) revert InsufficientReserve(amount, refundReserve);
        refundReserve -= amount;
        emit ReserveWithdrawn(to, amount);
        clawToken.safeTransfer(to, amount);
    }

    // ──────────── Admin Tuning ────────────

    /// @notice Propose a new review window (seconds) for a stake bracket; enactable after
    ///         MIN_TUNING_DELAY. Bounds: Low ∈ [60 s, 1 day], Mid ∈ [60 s, 3 days], High ∈ [60 s, 7 days].
    function proposeReviewWindow(uint256 bracketIndex, uint256 newWindow) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bracketIndex >= NUM_STAKE_BRACKETS) revert InvalidStakeBracket(bracketIndex);
        uint256 maxWindow = bracketIndex == 0 ? 1 days : (bracketIndex == 1 ? 3 days : 7 days);
        if (newWindow < 60 seconds || newWindow > maxWindow) revert InvalidReviewWindow(newWindow);
        pendingReviewWindow[bracketIndex] = newWindow;
        pendingReviewWindowAt[bracketIndex] = uint64(block.timestamp);
        emit ReviewWindowProposed(bracketIndex, newWindow, block.timestamp + MIN_TUNING_DELAY);
    }

    /// @notice Enact a proposed review window. Battles already in review keep their deadline.
    function enactReviewWindow(uint256 bracketIndex) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bracketIndex >= NUM_STAKE_BRACKETS) revert InvalidStakeBracket(bracketIndex);
        uint256 proposedAt = uint256(pendingReviewWindowAt[bracketIndex]);
        if (proposedAt == 0) revert NoPendingChange(bracketIndex);
        uint256 enactableAt = proposedAt + MIN_TUNING_DELAY;
        if (block.timestamp < enactableAt) revert TuningDelayNotElapsed(bracketIndex, enactableAt);
        uint256 newWindow = pendingReviewWindow[bracketIndex];
        uint256 old = reviewWindows[bracketIndex];
        reviewWindows[bracketIndex] = newWindow;
        pendingReviewWindow[bracketIndex] = 0;
        pendingReviewWindowAt[bracketIndex] = 0;
        emit ReviewWindowSet(bracketIndex, old, newWindow);
    }

    // ──────────── Timeout ────────────

    /// @notice Handle a phase timeout. Anyone can call this after the deadline passes.
    /// @dev In review it acts as finalizeBattle(); frozen past the long-stop it acts as expireFrozen().
    function handleTimeout(uint256 battleId) external nonReentrant {
        Battle storage b = _battles[battleId];
        BattlePhase p = b.phase;
        if (p == BattlePhase.None || p == BattlePhase.Settled || p == BattlePhase.Cancelled) {
            revert BattleDoesNotExist(battleId);
        }
        uint256 deadline = p == BattlePhase.AwaitingFinalize
            ? b.payoutDeadline
            : p == BattlePhase.Frozen ? uint256(b.frozenAt) + FREEZE_LONG_STOP : b.phaseDeadline;
        if (block.timestamp <= deadline) revert PhaseNotTimedOut(battleId);

        if (p == BattlePhase.Deposit) {
            _cancelBattle(battleId, CancelReason.DepositTimeout);
        } else if (p == BattlePhase.TeamReveal) {
            _handleRevealTimeout(battleId);
        } else if (p == BattlePhase.Active) {
            // The resolver failed to settle within ACTIVE_WINDOW: neither player can be blamed.
            _cancelBattle(battleId, CancelReason.StaleBattle);
        } else if (p == BattlePhase.AwaitingFinalize) {
            _executePayout(battleId, b.proposedWinner, b.proposedForfeiter);
        } else if (p == BattlePhase.Frozen) {
            _expireFrozen(battleId);
        }
    }

    // ──────────── Emergency ────────────

    /// @notice Emergency neutral exit for stalled Active battles (belt-and-braces next to the
    ///         permissionless ACTIVE_WINDOW cancel). Full refunds, no damage, no slashing.
    function emergencyWithdraw(uint256 battleId) external nonReentrant {
        Battle storage b = _battles[battleId];
        _requirePhase(battleId, BattlePhase.Active);
        _requireParticipant(battleId, msg.sender);
        uint256 availableAt = b.lastProgressAt + EMERGENCY_WITHDRAW_DELAY;
        if (block.timestamp < availableAt) revert EmergencyWithdrawTooEarly(battleId, availableAt);
        _cancelBattle(battleId, CancelReason.StaleBattle);
    }

    // ──────────── View ────────────

    /// @notice Get full battle data.
    function getBattle(uint256 battleId) external view returns (Battle memory) {
        // slither-disable-next-line incorrect-equality — enum equality against the zero/None sentinel is exact and safe.
        if (_battles[battleId].phase == BattlePhase.None) revert BattleDoesNotExist(battleId);
        return _battles[battleId];
    }

    // ──────────── Internal ────────────

    function _requirePhase(uint256 battleId, BattlePhase expected) internal view {
        BattlePhase actual = _battles[battleId].phase;
        // slither-disable-next-line incorrect-equality — enum equality against the zero/None sentinel is exact and safe.
        if (actual == BattlePhase.None) revert BattleDoesNotExist(battleId);
        if (actual != expected) revert InvalidBattlePhase(battleId, expected, actual);
    }

    function _requireParticipant(uint256 battleId, address who) internal view {
        Battle storage b = _battles[battleId];
        if (who != b.playerA && who != b.playerB) revert NotBattleParticipant(battleId);
    }

    /// @dev A result's winner is a participant or address(0) (draw); a forfeiter is address(0) or
    ///      the LOSER of a decided battle (a draw has no forfeiter).
    function _requireValidResult(Battle storage b, uint256 battleId, address winner, address forfeiter) internal view {
        if (winner != address(0) && winner != b.playerA && winner != b.playerB) revert InvalidWinner(battleId);
        if (forfeiter != address(0)) {
            if (winner == address(0) || forfeiter == winner) revert InvalidForfeiter(battleId);
            if (forfeiter != b.playerA && forfeiter != b.playerB) revert InvalidForfeiter(battleId);
        }
    }

    function _antiGrief(Battle storage b) internal view returns (uint256) {
        return b.stakeAmount * ANTI_GRIEF_BPS / BPS_DENOMINATOR;
    }

    function _isValidStake(uint256 amount) internal view returns (bool) {
        for (uint256 i = 0; i < NUM_STAKE_BRACKETS; i++) {
            if (amount == STAKE_BRACKETS[i]) return true;
        }
        return false;
    }

    function _stakeBracket(uint256 amount) internal view returns (uint256) {
        for (uint256 i = 0; i < NUM_STAKE_BRACKETS; i++) {
            if (amount == STAKE_BRACKETS[i]) return i;
        }
        revert InvalidStakeAmount(amount);
    }

    /// @dev F-04: returns the team's current power score (sum of evolution tier values).
    function _validateTeamForBattle(uint256 teamId, address player) internal view returns (uint8 power) {
        if (!teamManager.teamExists(teamId)) revert TeamNotOwned(teamId);
        TeamManager.Team memory team = teamManager.getTeam(teamId);
        if (team.owner != player) revert TeamNotOwned(teamId);
        if (teamInBattle[teamId]) revert TeamAlreadyInBattle(teamId);
        if (team.active) revert TeamAlreadyInBattle(teamId);
        for (uint256 i = 0; i < 3; i++) {
            uint256 lobId = team.lobsterIds[i];
            uint8 tier = lobsterNFT.getEvolutionTier(lobId);
            if (tier < MIN_EVOLUTION_TIER) revert LobsterTierTooLow(lobId, MIN_EVOLUTION_TIER, tier);
            uint8 damage = lobsterNFT.getDamage(lobId);
            if (damage > MAX_DAMAGE_FOR_BATTLE) revert LobsterDamageTooHigh(lobId, damage);
            power += tier;
        }
    }

    /// @dev Pays a result (finalizeBattle, handleTimeout in review, resolveFrozen). Damage was applied
    ///      and teams released at settle(). A decided battle: the winner takes the pot minus the fee.
    ///      A draw: each side pays half the normal fee (10% of its own stake). A forfeiter (the loser
    ///      of a resigned / timed-out battle) also loses their anti-grief deposit.
    function _executePayout(uint256 battleId, address winner, address forfeiter) internal {
        Battle storage b = _battles[battleId];
        b.phase = BattlePhase.Settled;
        b.winner = winner;

        uint256 antiGrief = _antiGrief(b);

        if (winner == address(0)) {
            // The normal fee on the combined pot, half from each side (an odd wei falls on B).
            uint256 drawFee = b.stakeAmount * 2 * PROTOCOL_FEE_BPS / BPS_DENOMINATOR;
            uint256 feeA = drawFee / 2;
            clawToken.forceApprove(address(treasury), drawFee);
            treasury.processFee(drawFee);
            clawToken.safeTransfer(b.playerA, b.stakeAmount - feeA + antiGrief);
            clawToken.safeTransfer(b.playerB, b.stakeAmount - (drawFee - feeA) + antiGrief);
            emit BattleSettled(battleId, address(0), 0, drawFee);
            return;
        }

        address loser = winner == b.playerA ? b.playerB : b.playerA;
        uint256 combinedPot = b.stakeAmount * 2;
        uint256 protocolFee = combinedPot * PROTOCOL_FEE_BPS / BPS_DENOMINATOR;
        uint256 winnerPayout = combinedPot - protocolFee;
        uint256 slashed = forfeiter == loser ? antiGrief : 0;

        clawToken.forceApprove(address(treasury), protocolFee + slashed);
        treasury.processFee(protocolFee + slashed);
        if (slashed > 0) emit AntiGriefSlashed(battleId, loser, slashed);

        clawToken.safeTransfer(winner, winnerPayout + antiGrief);
        if (slashed == 0) clawToken.safeTransfer(loser, antiGrief);

        emit BattleSettled(battleId, winner, winnerPayout, protocolFee);
    }

    function _expireFrozen(uint256 battleId) internal {
        Battle storage b = _battles[battleId];
        uint256 availableAt = uint256(b.frozenAt) + FREEZE_LONG_STOP;
        if (block.timestamp <= availableAt) revert LongStopNotReached(battleId, availableAt);
        b.phase = BattlePhase.Settled;
        b.winner = address(0);

        uint256 stakes = b.stakeAmount * 2;
        uint256 antiGrief = _antiGrief(b);
        if (refundReserve >= stakes) {
            refundReserve -= stakes;
            emit FrozenExpired(battleId, stakes, stakes);
            IClawBurnable(address(clawToken)).burn(stakes);
        } else {
            emit FrozenExpired(battleId, 0, 0);
        }
        // Either way each player gets their stake + anti-grief back: from the reserve (the held
        // stakes having been burned) or, with the reserve short, the held stakes themselves.
        clawToken.safeTransfer(b.playerA, b.stakeAmount + antiGrief);
        clawToken.safeTransfer(b.playerB, b.stakeAmount + antiGrief);
        emit BattleSettled(battleId, address(0), 0, 0);
    }

    function _applyDamage(uint256 battleId, uint256 teamId, uint8[3] memory damages) internal {
        // TM-01: tolerate a deleted team so settlement can never brick.
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
        // TM-01: same deleted-team tolerance as _applyDamage.
        if (teamManager.teamExists(teamId)) {
            teamManager.setTeamActive(teamId, false);
        }
    }

    function _cancelBattle(uint256 battleId, CancelReason reason) internal {
        _cancelWithSlash(battleId, false, false, reason);
    }

    /// @dev Cancel, refunding every deposit; a slashed side forfeits its anti-grief deposit to the
    ///      Treasury and gets only its stake back.
    function _cancelWithSlash(uint256 battleId, bool slashA, bool slashB, CancelReason reason) internal {
        Battle storage b = _battles[battleId];
        b.phase = BattlePhase.Cancelled;
        uint256 antiGrief = _antiGrief(b);
        uint256 slashed = (slashA ? antiGrief : 0) + (slashB ? antiGrief : 0);
        if (slashed > 0) {
            clawToken.forceApprove(address(treasury), slashed);
            treasury.processFee(slashed);
            if (slashA) emit AntiGriefSlashed(battleId, b.playerA, antiGrief);
            if (slashB) emit AntiGriefSlashed(battleId, b.playerB, antiGrief);
        }
        if (b.depositA) clawToken.safeTransfer(b.playerA, b.stakeAmount + (slashA ? 0 : antiGrief));
        if (b.depositB) clawToken.safeTransfer(b.playerB, b.stakeAmount + (slashB ? 0 : antiGrief));
        if (b.teamRevealedA) _releaseTeam(b.teamIdA);
        if (b.teamRevealedB) _releaseTeam(b.teamIdB);
        emit BattleCancelled(battleId, reason);
    }

    /// @dev The reveal window closed without revealTeams. Nothing about either team reached the
    ///      chain (F5-01), so by default it is a no-fault mutual cancel. D-14: a player the resolver
    ///      accused of an unopenable commit, who did not open it, forfeits their 5%.
    function _handleRevealTimeout(uint256 battleId) internal {
        Battle storage b = _battles[battleId];
        bool faultA = b.accusedA && !b.openedA;
        bool faultB = b.accusedB && !b.openedB;
        CancelReason reason = faultA && faultB
            ? CancelReason.ForfeitBoth
            : faultA ? CancelReason.ForfeitA : faultB ? CancelReason.ForfeitB : CancelReason.MutualTimeout;
        _cancelWithSlash(battleId, faultA, faultB, reason);
    }
}
