// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";
import {DeployHelpers} from "./DeployHelpers.s.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {MiningPool} from "../MiningPool.sol";
import {Faucet} from "../Faucet.sol";

/// @title GovernanceHandoff
/// @notice Migrates ALL deployer-held governance authority to a Safe in one sequence.
///         Closes the role-handoff cluster (ROLE-M1/M2/M3): the prior runbook described
///         only the DEFAULT_ADMIN_ROLE migration and left three powerful authorities on
///         the deploy key — Treasury's Ownable2Step ownership (unrecoverable by the Safe
///         once announced "handed off"), MiningPool.SEASON_ADMIN_ROLE (emission control),
///         and Faucet.ELIGIBILITY_ROLE (free lobster + $CLAW minting during the window).
/// @dev Shared by Handoff.s.sol (broadcast as deployer) and the handoff test (pranked as
///      deployer) so both exercise the EXACT same migration logic. Treasury uses a
///      two-step transfer: this proposes it; the Safe must call acceptOwnership() to
///      complete it (so a wrong Safe address can never strand fee routing).
library GovernanceHandoff {
    bytes32 internal constant DEFAULT_ADMIN_ROLE = 0x00;

    function execute(
        address[] memory adminContracts,
        address miningPool,
        address faucet,
        address treasury,
        address deployer,
        address safe,
        address eligibilityOperator
    ) internal {
        bytes32 seasonAdmin = MiningPool(miningPool).SEASON_ADMIN_ROLE();
        bytes32 eligibility = Faucet(faucet).ELIGIBILITY_ROLE();

        // 1. Auxiliary (non-DEFAULT_ADMIN) roles FIRST — granting/revoking them needs the
        //    deployer to still hold DEFAULT_ADMIN (their role admin), which step 2 drops.
        IAccessControl(miningPool).grantRole(seasonAdmin, safe);
        IAccessControl(miningPool).revokeRole(seasonAdmin, deployer);

        IAccessControl(faucet).grantRole(eligibility, eligibilityOperator);
        IAccessControl(faucet).revokeRole(eligibility, deployer);

        // 2. DEFAULT_ADMIN on every AccessControl contract → safe, then drop the deployer.
        //    Grant before revoke so admin control is never lost mid-sequence.
        for (uint256 i = 0; i < adminContracts.length; i++) {
            IAccessControl(adminContracts[i]).grantRole(DEFAULT_ADMIN_ROLE, safe);
            IAccessControl(adminContracts[i]).revokeRole(DEFAULT_ADMIN_ROLE, deployer);
        }

        // 3. Treasury (Ownable2Step): propose the ownership transfer. The Safe finishes it
        //    by calling acceptOwnership(); until then the deployer keeps ownership, so a
        //    mistyped Safe address can never brick setDevWallet/setAuthorized.
        Ownable2Step(treasury).transferOwnership(safe);
    }

    /// @notice True iff `deployer` holds none of the migrated governance roles. Treasury
    ///         ownership is two-step, so check `Treasury.pendingOwner()` separately.
    function deployerFullyDeprivileged(
        address[] memory adminContracts,
        address miningPool,
        address faucet,
        address deployer
    ) internal view returns (bool) {
        for (uint256 i = 0; i < adminContracts.length; i++) {
            if (IAccessControl(adminContracts[i]).hasRole(DEFAULT_ADMIN_ROLE, deployer)) return false;
        }
        if (IAccessControl(miningPool).hasRole(MiningPool(miningPool).SEASON_ADMIN_ROLE(), deployer)) return false;
        if (IAccessControl(faucet).hasRole(Faucet(faucet).ELIGIBILITY_ROLE(), deployer)) return false;
        return true;
    }
}

/// @title Handoff
/// @notice Step 3 of deployment (after Deploy + Configure): migrate all governance
///         authority from the deploy key to the governance Safe and the eligibility
///         operator, then assert the deployer is fully de-privileged.
/// @dev Usage: forge script contracts/script/Handoff.s.sol --rpc-url base --broadcast
///      Requires GOVERNANCE_SAFE and ELIGIBILITY_OPERATOR env vars.
///      AFTER this runs, the Safe MUST call Treasury.acceptOwnership() (Ownable2Step).
contract Handoff is DeployHelpers {
    function run() external {
        _loadEnv();

        require(governanceSafe != address(0), "GOVERNANCE_SAFE required");
        require(governanceSafe != deployer, "GOVERNANCE_SAFE must differ from deployer");
        require(eligibilityOperator != address(0), "ELIGIBILITY_OPERATOR required");
        require(eligibilityOperator != deployer, "ELIGIBILITY_OPERATOR must differ from deployer");

        string memory network = _networkName();
        console2.log("Governance handoff on:", network);
        Deployment memory d = _readDeployment(network);
        address[] memory adminContracts = _adminContracts(d);

        vm.startBroadcast(deployerKey);
        GovernanceHandoff.execute(
            adminContracts, d.miningPool, d.faucet, d.treasury, deployer, governanceSafe, eligibilityOperator
        );
        vm.stopBroadcast();

        // ROLE-I1: assert the deployer was actually de-privileged — no silent gaps.
        require(
            GovernanceHandoff.deployerFullyDeprivileged(adminContracts, d.miningPool, d.faucet, deployer),
            "handoff: deployer still holds a governance role"
        );
        require(
            Ownable2Step(d.treasury).pendingOwner() == governanceSafe,
            "handoff: Treasury ownership transfer not proposed to safe"
        );

        console2.log("=== Governance handoff complete ===");
        console2.log("DEFAULT_ADMIN (all) + SEASON_ADMIN -> safe:", governanceSafe);
        console2.log("ELIGIBILITY_ROLE -> operator:", eligibilityOperator);
        console2.log("ACTION REQUIRED: Safe must call Treasury.acceptOwnership() to finish the Ownable2Step transfer.");
    }

    /// @dev The 7 AccessControl contracts where the deployer holds DEFAULT_ADMIN_ROLE.
    ///      (BreedingLab/EvolutionLab/RepairShop/Marketplace have no admin; Treasury is
    ///      Ownable2Step, handled separately.)
    function _adminContracts(Deployment memory d) internal pure returns (address[] memory a) {
        a = new address[](7);
        a[0] = d.clawToken;
        a[1] = d.lobsterNFT;
        a[2] = d.teamManager;
        a[3] = d.miningPool;
        a[4] = d.battleArena;
        a[5] = d.battleVRF;
        a[6] = d.faucet;
    }
}
