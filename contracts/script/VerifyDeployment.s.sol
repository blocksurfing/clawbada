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
///
///      Why a separate script: `forge script --broadcast` is not atomic, and the asserts at
///      the end of a broadcasting script run against forge's local SIMULATION of that
///      broadcast, not against what actually landed. A dropped final transaction — in
///      Configure that is the revoke of ClawToken MINTER_ROLE from the deploy key, which
///      would leave a raw env-var key able to mint the whole unminted supply — is invisible
///      to them. This script sends nothing, so everything it reads is the real chain state.
///
///      Needs the same address env vars as the deploy (DEV_WALLET, MATCHMAKER_ADDRESS,
///      RESOLVER_ADDRESS, VRF_OPERATOR_ADDRESS, BOOST_ADMIN_ADDRESS, ... and for the handoff
///      stages GOVERNANCE_SAFE + ELIGIBILITY_OPERATOR). All are public addresses, so anyone
///      can re-run it after launch. DEPLOYER_ADDRESS overrides the deployer recorded in
///      deployments/<network>.json.
contract VerifyDeployment is CheckedDeployHelpers {
    /// @notice Default: the end state, the one that matters once the game is live.
    function run() external {
        finalized();
    }

    /// @notice After Configure.s.sol.
    function configured() public {
        Deployment memory d = _load();
        DeploymentChecks.requireConfigured(d, deployer, _hotKeys());
        console2.log("OK: configured - roles, Treasury wiring, season 1 and the faucet pre-mint are in place,");
        console2.log("    and the deployer holds no ClawToken MINTER_ROLE.");
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
        DeploymentChecks.requireFinalized(d, _adminContracts(d), deployer, governanceSafe, eligibilityOperator);
        console2.log("OK: handoff complete - the safe governs all 7 contracts and owns Treasury;");
        console2.log("    the deployer holds no governance, eligibility or mint role. Safe:", governanceSafe);
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
