// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title BattleVRF — drand beacon store for Clawbada battle randomness
/// @notice Operator-submitted drand beacon values. S1: trusted operator. Future: on-chain BLS12-381 verification.
/// @dev Beacon values are stored by OPERATOR_ROLE and used to derive per-action randomness.
/// @custom:security-contact security@clawbada.com
contract BattleVRF is AccessControl {
    // ──────────── Roles ────────────
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ──────────── State ────────────
    mapping(uint256 => uint256) private _beacons; // drand round → value
    uint256 public latestRound;

    // ──────────── Events ────────────
    event BeaconSubmitted(uint256 indexed round, uint256 value);

    // ──────────── Errors ────────────
    error ZeroAddress();
    error BeaconAlreadySubmitted(uint256 round);
    error BeaconNotAvailable(uint256 round);
    error RoundCannotBeZero();
    error ValueCannotBeZero();

    // ──────────── Constructor ────────────

    /// @param admin The DEFAULT_ADMIN_ROLE holder
    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ──────────── Operator ────────────

    /// @notice Store a drand beacon value for a given round.
    /// @param round The drand round number (must be > 0)
    /// @param value The beacon value (must be > 0)
    function submitBeacon(uint256 round, uint256 value) external onlyRole(OPERATOR_ROLE) {
        if (round == 0) revert RoundCannotBeZero();
        if (value == 0) revert ValueCannotBeZero();
        if (_beacons[round] != 0) revert BeaconAlreadySubmitted(round);

        _beacons[round] = value;
        if (round > latestRound) {
            latestRound = round;
        }

        emit BeaconSubmitted(round, value);
    }

    // ──────────── View ────────────

    /// @notice Get the beacon value for a given round. Reverts if not available.
    function getBeacon(uint256 round) external view returns (uint256) {
        uint256 value = _beacons[round];
        if (value == 0) revert BeaconNotAvailable(round);
        return value;
    }

    /// @notice Check if a beacon has been submitted for a given round.
    function hasBeacon(uint256 round) external view returns (bool) {
        return _beacons[round] != 0;
    }

    /// @notice Derive a deterministic random value for a specific battle action from a
    ///         stored beacon.
    /// @dev F5-04: the draw coordinates are `abi.encode`d (each padded to 32 bytes), NOT
    ///      summed into a single salt. The previous convention — `bytes32(battleId + round +
    ///      action)` — collided: distinct coordinates with the same sum, e.g. (9,4,0),
    ///      (10,3,0) and (10,2,1) all sum to 13, reused the SAME random draw. Encoding the
    ///      tuple gives every distinct (battleId, turn, action) a distinct preimage.
    /// @param beaconRound The drand round whose stored beacon seeds this battle's stream
    /// @param battleId The battle identifier
    /// @param turn The turn index within the battle
    /// @param action The action discriminator (e.g. 0=damage, 1=crit, 2=enhanced-proc)
    function deriveRandomness(uint256 beaconRound, uint256 battleId, uint256 turn, uint256 action)
        external
        view
        returns (uint256)
    {
        uint256 beacon = _beacons[beaconRound];
        if (beacon == 0) revert BeaconNotAvailable(beaconRound);
        return uint256(keccak256(abi.encode(beacon, battleId, turn, action)));
    }
}
