// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @dev What a gated contract needs from the switch. The error lives HERE so that every gated
///      contract reverts it itself (`revert IPauseSwitch.ProtocolPaused()`) and it is part of each
///      contract's own ABI — an error bubbled out of an external call would reach a client as a
///      bare 4-byte selector that no ABI of theirs can decode.
interface IPauseSwitch {
    error ProtocolPaused();

    function paused() external view returns (bool);
    /// @notice Reverts `ProtocolPaused()` while the protocol is paused; a no-op otherwise.
    function requireNotPaused() external view;
}

/// @title PauseSwitch
/// @notice One emergency stop for the protocol's money-IN entry points (PAUSE-I1, 2026-10-06).
///
/// WHAT IT PAUSES. Every contract that takes a player's $GOLD or lobsters asks this switch before
/// doing so: BattleArena `createBattle` / `deposit`, MiningPool `startExpedition`, BreedingLab
/// `requestBreed`, EvolutionLab `evolve`, Marketplace `listLobster` / `buyLobster`, RepairShop
/// `repair`, Faucet `claimLobsters` / `claimGold`.
///
/// WHAT IT NEVER PAUSES. Every exit: `revealTeams`, `settle`, `finalizeBattle`, `handleTimeout`,
/// `emergencyWithdraw`, `freeze` / `resolveFrozen` / `expireFrozen`, `claimExpedition`,
/// `finalizeBreed` / `cancelExpiredRequest`, `cancelListing`, `finalizeClaim` / `rearmClaim`, the
/// reserve and every admin action. A pause can therefore never trap a player's funds: whatever is
/// in flight finishes or refunds exactly as it would have, and only NEW money stops coming in.
///
/// WHO. `PAUSER_ROLE` (the guardian hot key — the same key that freezes a bad battle result) and
/// `DEFAULT_ADMIN_ROLE` (the governance Safe after the handoff) can pause; only the Safe can
/// unpause. A stolen guardian key can thus stop inflows (a visible, reversible nuisance) but
/// cannot keep the game open against the Safe's will, and cannot move a single token.
///
/// The switch is a separate contract so the gated contracts stay non-upgradeable and the pause
/// state has one address, one event stream and one role table to watch.
/// @custom:security-contact security@clawbada.com
contract PauseSwitch is AccessControl, IPauseSwitch {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bool public paused;

    event Paused(address indexed by);
    event Unpaused(address indexed by);

    error ZeroAddress();
    error AlreadyPaused();
    error NotPaused();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Stop every money-in entry point. PAUSER_ROLE or DEFAULT_ADMIN_ROLE.
    function pause() external {
        if (!hasRole(PAUSER_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, PAUSER_ROLE);
        }
        if (paused) revert AlreadyPaused();
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Reopen. DEFAULT_ADMIN_ROLE only — a pauser cannot undo the Safe.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!paused) revert NotPaused();
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @inheritdoc IPauseSwitch
    function requireNotPaused() external view {
        if (paused) revert ProtocolPaused();
    }
}
