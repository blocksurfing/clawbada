// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ClawToken} from "./ClawToken.sol";
import {LobsterNFT} from "./LobsterNFT.sol";
import {TeamManager} from "./TeamManager.sol";

/// @title MiningPool — Fixed per-expedition rewards with seasonal budget cap for Clawbada
/// @notice Manages expeditions across Base/Evolved/Elite/Apex mines. Each expedition earns
///         a fixed reward = baseReward × tierWeight, locked at start. Season has a total
///         emission cap; mining stops when the budget is exhausted.
/// @dev Admin calls startSeason(totalEmission, baseReward) each season. Rewards are minted into
///      MiningPool escrow at expedition start and transferred to the user at claim time. This
///      ensures startExpedition() fails immediately if ClawToken.MAX_SUPPLY headroom is insufficient,
///      preventing teams from becoming permanently locked by a later mint failure.
/// @custom:security-contact security@clawbada.com
contract MiningPool is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────── Roles ────────────
    bytes32 public constant SEASON_ADMIN_ROLE = keccak256("SEASON_ADMIN_ROLE");

    // ──────────── Types ────────────
    struct Expedition {
        uint256 teamId;
        address owner;
        uint256 season;
        uint8 mineTier; // 0=Base, 1=Evolved, 2=Elite, 3=Apex
        uint256 startTime;
        uint256 reward; // locked at start: baseReward × tierWeight
        bool claimed;
    }

    struct SeasonConfig {
        uint256 totalEmission; // season budget cap
        uint256 baseReward; // $CLAW per Base expedition (×tierWeight for higher tiers)
        uint256 startTime;
        uint256 totalMinted; // tracks budget allocated and minted into escrow this season
    }

    // ──────────── Constants ────────────
    uint256 public constant EXPEDITION_DURATION = 4 hours;
    uint256 public constant SEASON_DURATION = 60 days;
    uint256 public constant NUM_TIERS = 4;
    uint256 public constant ADMIN_RELEASE_GRACE = 7 days;

    // ──────────── Immutable Config ────────────
    uint256[4] public TIER_WEIGHTS = [uint256(1), 3, 10, 25];

    // ──────────── State ────────────
    ClawToken public clawToken;
    LobsterNFT public lobsterNFT;
    TeamManager public teamManager;

    uint256 public currentSeason;
    mapping(uint256 => SeasonConfig) private _seasons;

    uint256 public nextExpeditionId = 1;
    mapping(uint256 => Expedition) private _expeditions;
    mapping(uint256 => uint256) private _teamToExpedition; // active expedition (0 = none)

    // ──────────── Events ────────────
    event SeasonStarted(uint256 indexed season, uint256 totalEmission, uint256 baseReward, uint256 startTime);
    event ExpeditionStarted(
        uint256 indexed expeditionId, uint256 indexed teamId, address indexed owner, uint8 mineTier, uint256 reward
    );
    event ExpeditionClaimed(uint256 indexed expeditionId, uint256 indexed teamId, address indexed owner, uint256 reward);
    event BaseRewardUpdated(uint256 indexed season, uint256 oldBaseReward, uint256 newBaseReward);

    // ──────────── Errors ────────────
    error ZeroAddress();
    error SeasonNotActive();
    error SeasonStillActive();
    error ZeroEmission();
    error ZeroBaseReward();
    error SeasonBudgetExhausted();
    error TeamDoesNotExist(uint256 teamId);
    error NotTeamOwner(uint256 teamId);
    error TeamAlreadyMining(uint256 teamId);
    error TeamIsActive(uint256 teamId);
    error TierRequirementNotMet(uint256 lobsterId, uint8 requiredTier, uint8 actualTier);
    error InvalidMineTier(uint8 tier);
    error ExpeditionDoesNotExist(uint256 expeditionId);
    error ExpeditionNotComplete(uint256 expeditionId);
    error ExpeditionAlreadyClaimed(uint256 expeditionId);
    error NotExpeditionOwner(uint256 expeditionId);
    error AdminReleaseTooEarly(uint256 expeditionId, uint256 availableAt);

    // ──────────── Events (admin) ────────────
    event ExpeditionAdminReleased(uint256 indexed expeditionId, uint256 indexed teamId, uint256 rewardReturned);

    // ──────────── Constructor ────────────

    /// @param admin The DEFAULT_ADMIN_ROLE holder
    /// @param clawToken_ The ClawToken contract
    /// @param lobsterNFT_ The LobsterNFT contract
    /// @param teamManager_ The TeamManager contract
    constructor(address admin, address clawToken_, address lobsterNFT_, address teamManager_) {
        if (admin == address(0) || clawToken_ == address(0) || lobsterNFT_ == address(0) || teamManager_ == address(0))
        {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        clawToken = ClawToken(clawToken_);
        lobsterNFT = LobsterNFT(lobsterNFT_);
        teamManager = TeamManager(teamManager_);
    }

    // ──────────── Season Management ────────────

    /// @notice Start the next season with a given total emission budget and base reward.
    /// @param totalEmission Total $CLAW budget for this season
    /// @param baseReward $CLAW per Base expedition (multiplied by tier weight for higher tiers)
    function startSeason(uint256 totalEmission, uint256 baseReward) external onlyRole(SEASON_ADMIN_ROLE) {
        if (totalEmission == 0) revert ZeroEmission();
        if (baseReward == 0) revert ZeroBaseReward();

        // If a season is active, it must have ended
        if (currentSeason > 0) {
            SeasonConfig storage current = _seasons[currentSeason];
            if (block.timestamp < current.startTime + SEASON_DURATION) revert SeasonStillActive();
        }

        currentSeason++;
        _seasons[currentSeason] = SeasonConfig({
            totalEmission: totalEmission,
            baseReward: baseReward,
            startTime: block.timestamp,
            totalMinted: 0
        });

        emit SeasonStarted(currentSeason, totalEmission, baseReward, block.timestamp);
    }

    /// @notice Update the base reward for the current season. Only affects future expeditions.
    /// @param newBaseReward New $CLAW per Base expedition
    function setBaseReward(uint256 newBaseReward) external onlyRole(SEASON_ADMIN_ROLE) {
        if (newBaseReward == 0) revert ZeroBaseReward();
        _requireActiveSeason();

        SeasonConfig storage season = _seasons[currentSeason];
        uint256 oldBaseReward = season.baseReward;
        season.baseReward = newBaseReward;

        emit BaseRewardUpdated(currentSeason, oldBaseReward, newBaseReward);
    }

    // ──────────── Expedition Management ────────────

    /// @notice Start a mining expedition with a team at a given mine tier.
    /// @param teamId The team to send mining
    /// @param mineTier The mine tier (0=Base, 1=Evolved, 2=Elite, 3=Apex)
    /// @return expeditionId The ID of the started expedition
    function startExpedition(uint256 teamId, uint8 mineTier) external nonReentrant returns (uint256 expeditionId) {
        if (mineTier >= NUM_TIERS) revert InvalidMineTier(mineTier);
        _requireActiveSeason();

        // Validate team
        if (!teamManager.teamExists(teamId)) revert TeamDoesNotExist(teamId);
        TeamManager.Team memory team = teamManager.getTeam(teamId);
        if (team.owner != msg.sender) revert NotTeamOwner(teamId);
        if (team.active) revert TeamIsActive(teamId);
        if (_teamToExpedition[teamId] != 0) revert TeamAlreadyMining(teamId);

        // Validate tier gate: all 3 lobsters must meet minimum tier
        for (uint256 i = 0; i < 3; i++) {
            uint8 lobTier = lobsterNFT.getEvolutionTier(team.lobsterIds[i]);
            if (lobTier < mineTier) {
                revert TierRequirementNotMet(team.lobsterIds[i], mineTier, lobTier);
            }
        }

        // Calculate fixed reward and reserve budget
        SeasonConfig storage season = _seasons[currentSeason];
        uint256 reward = season.baseReward * TIER_WEIGHTS[mineTier];

        if (season.totalMinted + reward > season.totalEmission) revert SeasonBudgetExhausted();
        season.totalMinted += reward;

        // Mint reward into escrow now — reverts with ExceedsMaxSupply if global cap insufficient
        clawToken.mint(address(this), reward);

        expeditionId = nextExpeditionId++;
        _expeditions[expeditionId] = Expedition({
            teamId: teamId,
            owner: msg.sender,
            season: currentSeason,
            mineTier: mineTier,
            startTime: block.timestamp,
            reward: reward,
            claimed: false
        });

        _teamToExpedition[teamId] = expeditionId;

        // Mark team as active
        teamManager.setTeamActive(teamId, true);

        emit ExpeditionStarted(expeditionId, teamId, msg.sender, mineTier, reward);
    }

    /// @notice Claim rewards from a completed expedition.
    /// @param expeditionId The expedition to claim
    function claimExpedition(uint256 expeditionId) external nonReentrant {
        Expedition storage expedition = _expeditions[expeditionId];
        if (expedition.owner == address(0)) revert ExpeditionDoesNotExist(expeditionId);
        if (expedition.owner != msg.sender) revert NotExpeditionOwner(expeditionId);
        if (expedition.claimed) revert ExpeditionAlreadyClaimed(expeditionId);
        if (block.timestamp < expedition.startTime + EXPEDITION_DURATION) {
            revert ExpeditionNotComplete(expeditionId);
        }

        expedition.claimed = true;

        // Clear active expedition tracking
        _teamToExpedition[expedition.teamId] = 0;

        // Mark team as inactive — but tolerate a deleted team record.
        // M-01 (2026-04-20): under compromised ACTIVITY_ROLE, an attacker could
        // force-unlock the team mid-expedition and the owner could disband it,
        // leaving the expedition permanently stuck because setTeamActive on a
        // non-existent team reverts. Guarding with teamExists keeps the payout
        // path terminal even if the team record is gone.
        if (teamManager.teamExists(expedition.teamId)) {
            teamManager.setTeamActive(expedition.teamId, false);
        }

        // Transfer escrowed reward to claimer (I-04 SafeERC20; clawToken is
        // typed as ClawToken for the .mint() call, so cast at the boundary).
        IERC20(address(clawToken)).safeTransfer(msg.sender, expedition.reward);

        emit ExpeditionClaimed(expeditionId, expedition.teamId, msg.sender, expedition.reward);
    }

    // ──────────── Admin Emergency ────────────

    /// @notice Emergency release a stuck expedition (e.g., owner lost keys).
    /// @dev Only callable by DEFAULT_ADMIN_ROLE after expedition completes + ADMIN_RELEASE_GRACE (7 days).
    ///      Releases the team and burns the escrowed reward (returns to protocol, not claimable).
    ///      This prevents permanent team/lobster lock from key loss.
    /// @param expeditionId The stuck expedition to release
    function adminReleaseExpedition(uint256 expeditionId) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        Expedition storage expedition = _expeditions[expeditionId];
        if (expedition.owner == address(0)) revert ExpeditionDoesNotExist(expeditionId);
        if (expedition.claimed) revert ExpeditionAlreadyClaimed(expeditionId);

        // Must be well past completion: expedition duration + grace period
        uint256 availableAt = expedition.startTime + EXPEDITION_DURATION + ADMIN_RELEASE_GRACE;
        if (block.timestamp < availableAt) {
            revert AdminReleaseTooEarly(expeditionId, availableAt);
        }

        expedition.claimed = true;
        _teamToExpedition[expedition.teamId] = 0;
        // M-01: same deleted-team tolerance as claimExpedition. Admin release
        // must always terminate even if the team record has been disbanded
        // under a compromised-role path, otherwise the escrowed reward is
        // permanently stuck.
        if (teamManager.teamExists(expedition.teamId)) {
            teamManager.setTeamActive(expedition.teamId, false);
        }

        // Burn the escrowed reward rather than sending to admin
        clawToken.burn(expedition.reward);

        emit ExpeditionAdminReleased(expeditionId, expedition.teamId, expedition.reward);
    }

    // ──────────── View Functions ────────────

    /// @notice Get an expedition by ID.
    function getExpedition(uint256 expeditionId) external view returns (Expedition memory) {
        if (_expeditions[expeditionId].owner == address(0)) revert ExpeditionDoesNotExist(expeditionId);
        return _expeditions[expeditionId];
    }

    /// @notice Get the active expedition for a team (0 = none).
    function getActiveExpedition(uint256 teamId) external view returns (uint256) {
        return _teamToExpedition[teamId];
    }

    /// @notice Get the full config for a season.
    function getSeasonConfig(uint256 season) external view returns (SeasonConfig memory) {
        return _seasons[season];
    }

    /// @notice Get total $CLAW reserved/minted for a season.
    function getSeasonMinted(uint256 season) external view returns (uint256) {
        return _seasons[season].totalMinted;
    }

    /// @notice Get remaining unspent budget for a season.
    function getSeasonUnspent(uint256 season) external view returns (uint256) {
        SeasonConfig storage s = _seasons[season];
        if (s.totalMinted >= s.totalEmission) return 0;
        return s.totalEmission - s.totalMinted;
    }

    // ──────────── Internal ────────────

    function _requireActiveSeason() internal view {
        if (currentSeason == 0) revert SeasonNotActive();
        SeasonConfig storage season = _seasons[currentSeason];
        if (block.timestamp >= season.startTime + SEASON_DURATION) revert SeasonNotActive();
    }

    // ──────────── Overrides ────────────

    function supportsInterface(bytes4 interfaceId) public view override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
