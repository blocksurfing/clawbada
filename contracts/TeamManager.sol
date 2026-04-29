// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {LobsterNFT} from "./LobsterNFT.sol";

/// @title TeamManager — Team registry for Clawbada
/// @notice Manages teams of 3 lobsters. Handles assignment, locking, and activity status.
/// @dev External game contracts (MiningPool, BattleArena) set team activity via ACTIVITY_ROLE.
/// @custom:security-contact security@clawbada.com
contract TeamManager is AccessControl {
    // ──────────── Roles ────────────
    bytes32 public constant ACTIVITY_ROLE = keccak256("ACTIVITY_ROLE");

    // ──────────── Types ────────────
    struct Team {
        address owner;
        uint256[3] lobsterIds;
        bool active;
    }

    // ──────────── State ────────────
    LobsterNFT public lobsterNFT;
    uint256 public nextTeamId = 1;
    mapping(uint256 => Team) private _teams;
    mapping(address => uint256[]) private _ownerTeams;
    mapping(uint256 => uint256) private _lobsterToTeam; // lobsterId → teamId (0 = none)
    mapping(uint256 => uint256) private _teamIndex; // teamId → index in _ownerTeams[owner]

    // ──────────── Events ────────────
    event TeamCreated(uint256 indexed teamId, address indexed owner, uint256[3] lobsterIds);
    event TeamDisbanded(uint256 indexed teamId, address indexed owner);
    event TeamActivityUpdated(uint256 indexed teamId, bool active);

    // ──────────── Errors ────────────
    error ZeroAddress();
    error TeamDoesNotExist(uint256 teamId);
    error NotTeamOwner(uint256 teamId);
    error LobsterNotOwned(uint256 lobsterId);
    error LobsterAlreadyAssigned(uint256 lobsterId);
    error TeamIsActive(uint256 teamId);
    error LobsterDoesNotExist(uint256 lobsterId);
    error DuplicateLobster(uint256 lobsterId);

    // ──────────── Constructor ────────────

    /// @param admin The DEFAULT_ADMIN_ROLE holder
    /// @param lobsterNFT_ The LobsterNFT contract
    constructor(address admin, address lobsterNFT_) {
        if (admin == address(0) || lobsterNFT_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        lobsterNFT = LobsterNFT(lobsterNFT_);
    }

    // ──────────── Team Management ────────────

    /// @notice Create a team of 3 lobsters. Locks all 3 lobsters.
    /// @param lobsterIds Array of exactly 3 lobster token IDs
    /// @return teamId The ID of the created team
    function createTeam(uint256[3] calldata lobsterIds) external returns (uint256 teamId) {
        // Check for duplicates
        if (lobsterIds[0] == lobsterIds[1] || lobsterIds[0] == lobsterIds[2] || lobsterIds[1] == lobsterIds[2]) {
            // Find the first duplicate to report
            if (lobsterIds[0] == lobsterIds[1] || lobsterIds[0] == lobsterIds[2]) {
                revert DuplicateLobster(lobsterIds[0]);
            }
            revert DuplicateLobster(lobsterIds[1]);
        }

        for (uint256 i = 0; i < 3; i++) {
            uint256 lobId = lobsterIds[i];

            // Check exists
            if (!lobsterNFT.exists(lobId)) revert LobsterDoesNotExist(lobId);

            // Check ownership
            if (lobsterNFT.ownerOf(lobId) != msg.sender) revert LobsterNotOwned(lobId);

            // Check not already assigned
            if (_lobsterToTeam[lobId] != 0) revert LobsterAlreadyAssigned(lobId);
        }

        teamId = nextTeamId++;

        _teams[teamId] = Team({owner: msg.sender, lobsterIds: lobsterIds, active: false});

        // Track owner's teams
        _teamIndex[teamId] = _ownerTeams[msg.sender].length;
        _ownerTeams[msg.sender].push(teamId);

        // Map lobsters to team and lock them
        for (uint256 i = 0; i < 3; i++) {
            _lobsterToTeam[lobsterIds[i]] = teamId;
            lobsterNFT.setLocked(lobsterIds[i], true);
        }

        emit TeamCreated(teamId, msg.sender, lobsterIds);
    }

    /// @notice Disband a team. Unlocks all 3 lobsters.
    /// @param teamId The ID of the team to disband
    function disbandTeam(uint256 teamId) external {
        Team storage team = _teams[teamId];
        if (team.owner == address(0)) revert TeamDoesNotExist(teamId);
        if (team.owner != msg.sender) revert NotTeamOwner(teamId);
        if (team.active) revert TeamIsActive(teamId);

        // Unlock lobsters and clear mappings
        for (uint256 i = 0; i < 3; i++) {
            uint256 lobId = team.lobsterIds[i];
            _lobsterToTeam[lobId] = 0;
            lobsterNFT.setLocked(lobId, false);
        }

        // Swap-and-pop from _ownerTeams
        uint256 index = _teamIndex[teamId];
        uint256[] storage ownerTeams = _ownerTeams[msg.sender];
        uint256 lastIndex = ownerTeams.length - 1;

        if (index != lastIndex) {
            uint256 lastTeamId = ownerTeams[lastIndex];
            ownerTeams[index] = lastTeamId;
            _teamIndex[lastTeamId] = index;
        }
        ownerTeams.pop();
        delete _teamIndex[teamId];
        delete _teams[teamId];

        emit TeamDisbanded(teamId, msg.sender);
    }

    // ──────────── Activity Management ────────────

    /// @notice Set team active/inactive. Called by MiningPool/BattleArena via ACTIVITY_ROLE.
    function setTeamActive(uint256 teamId, bool active) external onlyRole(ACTIVITY_ROLE) {
        if (_teams[teamId].owner == address(0)) revert TeamDoesNotExist(teamId);
        _teams[teamId].active = active;
        emit TeamActivityUpdated(teamId, active);
    }

    // ──────────── View Functions ────────────

    /// @notice Get the full Team struct.
    function getTeam(uint256 teamId) external view returns (Team memory) {
        if (_teams[teamId].owner == address(0)) revert TeamDoesNotExist(teamId);
        return _teams[teamId];
    }

    /// @notice Get all team IDs owned by an address.
    function getTeamsByOwner(address owner) external view returns (uint256[] memory) {
        return _ownerTeams[owner];
    }

    /// @notice Get the team ID a lobster is assigned to (0 = none).
    function getLobsterTeam(uint256 lobsterId) external view returns (uint256) {
        return _lobsterToTeam[lobsterId];
    }

    /// @notice Check if a team is currently active (mining/battling).
    function isTeamActive(uint256 teamId) external view returns (bool) {
        return _teams[teamId].active;
    }

    /// @notice Check if a team exists.
    function teamExists(uint256 teamId) external view returns (bool) {
        return _teams[teamId].owner != address(0);
    }

    // ──────────── Overrides ────────────

    function supportsInterface(bytes4 interfaceId) public view override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
