// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";
import {DeploymentChecks, CheckedDeployHelpers} from "./DeploymentChecks.sol";

/// @title VerifyDeployment
/// @notice Read-only check of a deployment against the chain, one entry point per stage.
/// @dev Audit 2026-09 D-23 / D-24. Run WITHOUT --broadcast and without a private key:
///
///        forge script contracts/script/VerifyDeployment.s.sol --rpc-url base --sig "configured()"
///        forge script contracts/script/VerifyDeployment.s.sol --rpc-url base --sig "proposed()"
///        forge script contracts/script/VerifyDeployment.s.sol --rpc-url base --sig "finalized()"
///        forge script contracts/script/VerifyDeployment.s.sol --rpc-url base --sig "reserveFunded()"
///        forge script contracts/script/VerifyDeployment.s.sol --rpc-url base --sig "opened()"
///
///      Why a separate script: `forge script --broadcast` is not atomic, and the asserts at
///      the end of a broadcasting script run against forge's local SIMULATION of that
///      broadcast, not against what actually landed. A dropped final transaction — in
///      Configure that is the revoke of GoldToken MINTER_ROLE from the deploy key, which
///      would leave a raw env-var key able to mint the whole unminted supply — is invisible
///      to them. This script sends nothing, so everything it reads is the real chain state.
///
///      Needs the same address env vars as the deploy (DEV_WALLET, MATCHMAKER_ADDRESS,
///      RESOLVER_ADDRESS, VRF_OPERATOR_ADDRESS, BOOST_ADMIN_ADDRESS, GUARDIAN_ADDRESS, ... and for the handoff
///      stages GOVERNANCE_SAFE + ELIGIBILITY_OPERATOR). All are public addresses, so anyone
///      can re-run it after launch. DEPLOYER_ADDRESS overrides the deployer recorded in
///      deployments/<network>.json.
contract VerifyDeployment is CheckedDeployHelpers {
    /// @notice Default: the end state, the one that matters once the game is live — the
    ///         handoff is complete AND the Safe has funded the refund reserve.
    function run() external {
        finalized();
        reserveFunded();
    }

    /// @notice After Configure.s.sol.
    function configured() public {
        Deployment memory d = _load();
        DeploymentChecks.requireConfigured(d, deployer, _hotKeys());
        console2.log("OK: configured - roles, Treasury wiring and the faucet pre-mint are in place (no season yet: Open.s.sol),");
        console2.log("    and the deployer holds no GoldToken MINTER_ROLE.");
    }

    /// @notice After Handoff.s.sol phase 1.
    function proposed() public {
        Deployment memory d = _load();
        _requireHandoffAddresses();
        DeploymentChecks.requireConfigured(d, deployer, _hotKeys());
        DeploymentChecks.requireProposed(d, _adminContracts(d), deployer, governanceSafe, eligibilityOperator);
        console2.log("OK: handoff proposed - the safe holds its roles. The deployer STILL governs.");
        console2.log("    Next: the safe calls Treasury.acceptOwnership(), then Handoff --sig 'finalize()'.");
    }

    /// @notice After Handoff.s.sol phase 2. The handoff is complete only when this passes.
    function finalized() public {
        Deployment memory d = _load();
        _requireHandoffAddresses();
        if (block.chainid == 8453) DeploymentChecks.requireLiveSafe(governanceSafe, minSafeThreshold);
        DeploymentChecks.requireConfigured(d, deployer, _hotKeys());
        DeploymentChecks.requireFinalized(
            d, _adminContracts(d), deployer, governanceSafe, eligibilityOperator, guardianAddress
        );
        console2.log("OK: handoff complete - the safe governs all 8 contracts and owns Treasury;");
        console2.log("    the deployer holds no governance, eligibility, guardian or mint role. Safe:", governanceSafe);
    }

    /// @notice After the Safe's approve + BattleArena.fundReserve (right after the handoff on
    ///         mainnet; Configure does it from the deployer off mainnet).
    function reserveFunded() public {
        Deployment memory d = _load();
        DeploymentChecks.requireReserveFunded(d);
        console2.log("OK: BattleArena refund reserve holds at least 2,000,000 GOLD.");
    }

    /// @notice After Open.s.sol (or the Safe's two transactions): the game is live.
    function opened() public {
        Deployment memory d = _load();
        DeploymentChecks.requireOpened(d);
        console2.log("OK: open - season 1 is running and the faucet closes within 7 days.");
    }

    function _load() internal returns (Deployment memory d) {
        string memory network = _networkName();
        _loadEnvReadOnly(network);
        console2.log("Verifying deployment on:", network);
        d = _readDeployment(network);
    }

    function _requireHandoffAddresses() internal view {
        require(governanceSafe != address(0), "GOVERNANCE_SAFE required");
        require(eligibilityOperator != address(0), "ELIGIBILITY_OPERATOR required");
    }
}
