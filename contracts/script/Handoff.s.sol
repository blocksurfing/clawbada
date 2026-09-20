// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";
import {DeploymentChecks, CheckedDeployHelpers} from "./DeploymentChecks.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {MiningPool} from "../MiningPool.sol";
import {Faucet} from "../Faucet.sol";

/// @title GovernanceHandoff
/// @notice Migrates ALL deployer-held governance authority to a Safe, in TWO phases with a
///         proof of control between them.
///
///         Role-handoff cluster (ROLE-M1/M2/M3): the handoff covers every authority the
///         deploy key holds — DEFAULT_ADMIN_ROLE on the 7 AccessControl contracts,
///         Treasury's Ownable2Step ownership, MiningPool.SEASON_ADMIN_ROLE (emission
///         control) and Faucet.ELIGIBILITY_ROLE (free lobster + $CLAW minting).
///
///         Audit 2026-09 D-11: the previous version granted the Safe its roles AND revoked
///         the deployer in one run. The contracts are not upgradeable, DEFAULT_ADMIN is the
///         admin of every role and nothing can re-grant it, so a mistyped GOVERNANCE_SAFE —
///         or a Safe address copied from another chain, where it has no code — would have
///         destroyed admin on all seven contracts for good: disputed battles could never be
///         resolved (stakes locked forever), no season after the first could start, no hot
///         key could ever be rotated. Only Treasury was protected, by Ownable2Step.
///
///         Now:
///           1. propose()  — the deployer GRANTS the Safe its roles and proposes the
///                           Treasury transfer. The deployer keeps its own roles, so every
///                           mistake is still recoverable.
///           2. the Safe calls Treasury.acceptOwnership(). Only the Safe can, so this is
///              the on-chain proof that its signers can execute on this chain.
///           3. finalize() — refuses to run without that proof, then the deployer
///                           renounces everything.
/// @dev Shared by Handoff.s.sol (broadcast as deployer) and the tests (pranked as deployer)
///      so both exercise the EXACT same migration logic.
library GovernanceHandoff {
    bytes32 internal constant DEFAULT_ADMIN_ROLE = 0x00;

    /// @notice Phase 1. Additive for governance: nothing is taken from the deployer except
    ///         Faucet.ELIGIBILITY_ROLE, a hot operational role that either admin can re-grant.
    function propose(
        address[] memory adminContracts,
        address miningPool,
        address faucet,
        address treasury,
        address deployer,
        address safe,
        address eligibilityOperator
    ) internal {
        IAccessControl(miningPool).grantRole(MiningPool(miningPool).SEASON_ADMIN_ROLE(), safe);

        bytes32 eligibility = Faucet(faucet).ELIGIBILITY_ROLE();
        IAccessControl(faucet).grantRole(eligibility, eligibilityOperator);
        IAccessControl(faucet).revokeRole(eligibility, deployer);

        for (uint256 i = 0; i < adminContracts.length; i++) {
            IAccessControl(adminContracts[i]).grantRole(DEFAULT_ADMIN_ROLE, safe);
        }

        // Treasury (Ownable2Step): propose. The Safe's acceptOwnership() both completes
        // this transfer and unlocks finalize().
        Ownable2Step(treasury).transferOwnership(safe);
    }

    /// @notice Undo a propose() that named the wrong address. Possible only before
    ///         finalize(), while the deployer is still admin — which is the point of the
    ///         two phases. Re-run propose() with the corrected GOVERNANCE_SAFE afterwards.
    function retract(address[] memory adminContracts, address miningPool, address treasury, address wrongSafe)
        internal
    {
        IAccessControl(miningPool).revokeRole(MiningPool(miningPool).SEASON_ADMIN_ROLE(), wrongSafe);
        for (uint256 i = 0; i < adminContracts.length; i++) {
            IAccessControl(adminContracts[i]).revokeRole(DEFAULT_ADMIN_ROLE, wrongSafe);
        }
        // Ownable2Step: proposing the zero address cancels a pending transfer.
        if (Ownable2Step(treasury).pendingOwner() == wrongSafe) {
            Ownable2Step(treasury).transferOwnership(address(0));
        }
    }

    /// @notice Phase 2. Reverts unless the Safe has proved control and already holds every
    ///         governance role; only then does the deployer renounce its own.
    function finalize(
        address[] memory adminContracts,
        address miningPool,
        address treasury,
        address deployer,
        address safe
    ) internal {
        DeploymentChecks.requireSafeProvedControl(treasury, safe);
        DeploymentChecks.requireSafeHoldsGovernance(adminContracts, miningPool, safe);

        IAccessControl(miningPool).renounceRole(MiningPool(miningPool).SEASON_ADMIN_ROLE(), deployer);
        for (uint256 i = 0; i < adminContracts.length; i++) {
            IAccessControl(adminContracts[i]).renounceRole(DEFAULT_ADMIN_ROLE, deployer);
        }
    }
}

/// @title Handoff
/// @notice Step 3 of deployment (after Deploy + Configure): migrate all governance
///         authority from the deploy key to the governance Safe and the eligibility operator.
/// @dev Requires GOVERNANCE_SAFE and ELIGIBILITY_OPERATOR. The full sequence:
///
///        forge script contracts/script/Handoff.s.sol --rpc-url base --broadcast
///        forge script contracts/script/VerifyDeployment.s.sol --rpc-url base --sig "proposed()"
///        (Safe transaction)  Treasury.acceptOwnership()
///        forge script contracts/script/Handoff.s.sol --rpc-url base --broadcast --sig "finalize()"
///        forge script contracts/script/VerifyDeployment.s.sol --rpc-url base --sig "finalized()"
///
///      The handoff is NOT complete until the last command passes. The checks inside this
///      script run against forge's local simulation of the broadcast; VerifyDeployment
///      (no --broadcast) reads the chain itself, which is what catches a dropped transaction.
contract Handoff is CheckedDeployHelpers {
    /// @notice Phase 1 — grant the Safe its roles and propose the Treasury transfer.
    function run() external {
        _loadEnv();
        _requireHandoffEnv();

        string memory network = _networkName();
        console2.log("Governance handoff, phase 1 (propose) on:", network);
        Deployment memory d = _readDeployment(network);

        vm.startBroadcast(deployerKey);
        _propose(d);
        vm.stopBroadcast();

        console2.log("=== Phase 1 sent. The handoff is NOT complete: the deployer still governs. ===");
        console2.log("DEFAULT_ADMIN (all 7) + SEASON_ADMIN granted to safe:", governanceSafe);
        console2.log("ELIGIBILITY_ROLE -> operator:", eligibilityOperator);
        console2.log("NEXT 1: VerifyDeployment.s.sol --sig 'proposed()'   (reads the chain; no --broadcast)");
        console2.log("NEXT 2: from the Safe, call Treasury.acceptOwnership()");
        console2.log("NEXT 3: Handoff.s.sol --broadcast --sig 'finalize()'");
    }

    /// @notice Phase 2 — only after the Safe accepted Treasury ownership: the deployer renounces.
    function finalize() external {
        _loadEnv();
        _requireHandoffEnv();

        string memory network = _networkName();
        console2.log("Governance handoff, phase 2 (finalize) on:", network);
        Deployment memory d = _readDeployment(network);

        vm.startBroadcast(deployerKey);
        _finalize(d);
        vm.stopBroadcast();

        console2.log("=== Phase 2 sent. ===");
        console2.log("NEXT 1: VerifyDeployment.s.sol --sig 'finalized()'  - the handoff is complete ONLY when this passes");
        console2.log("NEXT 2: retire DEPLOYER_PRIVATE_KEY; publish the Safe address:", governanceSafe);
    }

    /// @notice Recovery, before finalize only: strip a wrongly proposed address of the roles
    ///         phase 1 gave it. Usage: --sig "retract(address)" <wrong address>, then fix
    ///         GOVERNANCE_SAFE and run phase 1 again.
    function retract(address wrongSafe) external {
        _loadEnv();
        string memory network = _networkName();
        console2.log("Governance handoff, RETRACT on:", network);
        Deployment memory d = _readDeployment(network);

        vm.startBroadcast(deployerKey);
        _retract(d, wrongSafe);
        vm.stopBroadcast();

        console2.log("Retracted DEFAULT_ADMIN (all 7) + SEASON_ADMIN + pending Treasury transfer from:", wrongSafe);
    }

    function _retract(Deployment memory d, address wrongSafe) internal {
        require(wrongSafe != address(0) && wrongSafe != deployer, "retract: not the deployer or zero");
        require(
            Ownable2Step(d.treasury).owner() != wrongSafe,
            "retract: that address accepted Treasury ownership - it is controlled; rotate from it instead"
        );
        GovernanceHandoff.retract(_adminContracts(d), d.miningPool, d.treasury, wrongSafe);
    }

    /// @dev Phase 1 with its preconditions, free of file and env access so the deploy-script
    ///      test runs exactly what mainnet runs. D-23: refuses to start unless Configure
    ///      finished — otherwise the Safe would inherit ~25 configuration calls to replay by
    ///      hand, including a grant-mint-revoke of the 70M faucet pre-mint.
    function _propose(Deployment memory d) internal {
        address[] memory adminContracts = _adminContracts(d);
        DeploymentChecks.requireConfigured(d, deployer, _hotKeys());

        GovernanceHandoff.propose(
            adminContracts, d.miningPool, d.faucet, d.treasury, deployer, governanceSafe, eligibilityOperator
        );

        DeploymentChecks.requireProposed(d, adminContracts, deployer, governanceSafe, eligibilityOperator);
    }

    /// @dev Phase 2 with its preconditions and the end-state assertion.
    function _finalize(Deployment memory d) internal {
        address[] memory adminContracts = _adminContracts(d);
        DeploymentChecks.requireConfigured(d, deployer, _hotKeys());
        DeploymentChecks.requireProposed(d, adminContracts, deployer, governanceSafe, eligibilityOperator);

        GovernanceHandoff.finalize(adminContracts, d.miningPool, d.treasury, deployer, governanceSafe);

        DeploymentChecks.requireFinalized(d, adminContracts, deployer, governanceSafe, eligibilityOperator);
    }

    /// @dev Env validation shared by both phases.
    function _requireHandoffEnv() internal view {
        require(governanceSafe != address(0), "GOVERNANCE_SAFE required");
        require(governanceSafe != deployer, "GOVERNANCE_SAFE must differ from deployer");
        require(eligibilityOperator != address(0), "ELIGIBILITY_OPERATOR required");
        require(eligibilityOperator != deployer, "ELIGIBILITY_OPERATOR must differ from deployer");
        require(governanceSafe != eligibilityOperator, "GOVERNANCE_SAFE must not be the ELIGIBILITY_OPERATOR hot key");

        if (block.chainid == 8453) {
            // D-11: a real Safe, on THIS chain, at or above the policy threshold. (Key
            // separation against the other hot keys already ran in _loadEnv — D-26.)
            DeploymentChecks.requireLiveSafe(governanceSafe, minSafeThreshold);
        } else if (governanceSafe.code.length == 0) {
            console2.log("WARNING: GOVERNANCE_SAFE has no code here. Tolerated off mainnet only.");
        }
    }
}
