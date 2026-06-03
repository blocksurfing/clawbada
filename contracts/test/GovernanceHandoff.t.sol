// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./helpers/BaseSetup.t.sol";
import {GovernanceHandoff} from "../script/Handoff.s.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @dev Role-handoff cluster (ROLE-M1/M2/M3) regression: the GovernanceHandoff library
///      must migrate EVERY deployer-held governance authority to the Safe / operator and
///      leave the deployer fully de-privileged. In BaseSetup, `admin` is the
///      deployer-equivalent (DEFAULT_ADMIN on all contracts + SEASON_ADMIN + ELIGIBILITY
///      + Treasury owner). Exercises the same library Handoff.s.sol uses on mainnet.
contract GovernanceHandoffTest is BaseSetup {
    bytes32 internal constant DEFAULT_ADMIN_ROLE = 0x00;
    address internal safe = makeAddr("governanceSafe");
    address internal eligOperator = makeAddr("eligOperator");

    function _admins() internal view returns (address[] memory a) {
        a = new address[](7);
        a[0] = address(claw);
        a[1] = address(nft);
        a[2] = address(teamMgr);
        a[3] = address(miningPool);
        a[4] = address(battleArena);
        a[5] = address(battleVRF);
        a[6] = address(faucet);
    }

    function _runHandoff() internal {
        vm.startPrank(admin);
        GovernanceHandoff.execute(
            _admins(), address(miningPool), address(faucet), address(treasury), admin, safe, eligOperator
        );
        vm.stopPrank();
    }

    function test_handoff_deprivileges_deployer() public {
        // Precondition: admin (the deployer-equivalent) holds the governance roles.
        assertTrue(miningPool.hasRole(miningPool.SEASON_ADMIN_ROLE(), admin), "pre: admin has SEASON_ADMIN");
        assertTrue(faucet.hasRole(faucet.ELIGIBILITY_ROLE(), admin), "pre: admin has ELIGIBILITY");
        assertEq(treasury.owner(), admin, "pre: admin owns Treasury");

        _runHandoff();

        assertTrue(
            GovernanceHandoff.deployerFullyDeprivileged(_admins(), address(miningPool), address(faucet), admin),
            "deployer fully de-privileged"
        );
        assertFalse(nft.hasRole(DEFAULT_ADMIN_ROLE, admin), "admin lost LobsterNFT admin");
        assertFalse(battleArena.hasRole(DEFAULT_ADMIN_ROLE, admin), "admin lost BattleArena admin");
        assertFalse(miningPool.hasRole(miningPool.SEASON_ADMIN_ROLE(), admin), "admin lost SEASON_ADMIN");
        assertFalse(faucet.hasRole(faucet.ELIGIBILITY_ROLE(), admin), "admin lost ELIGIBILITY");
    }

    function test_handoff_grants_safe_and_operator() public {
        _runHandoff();
        address[] memory a = _admins();
        for (uint256 i = 0; i < a.length; i++) {
            assertTrue(IAccessControl(a[i]).hasRole(DEFAULT_ADMIN_ROLE, safe), "safe has DEFAULT_ADMIN on each contract");
        }
        assertTrue(miningPool.hasRole(miningPool.SEASON_ADMIN_ROLE(), safe), "safe has SEASON_ADMIN");
        // ELIGIBILITY goes to the operational service wallet, NOT the cold governance Safe.
        assertTrue(faucet.hasRole(faucet.ELIGIBILITY_ROLE(), eligOperator), "operator has ELIGIBILITY");
        assertFalse(faucet.hasRole(faucet.ELIGIBILITY_ROLE(), safe), "safe does not hold ELIGIBILITY");
    }

    function test_handoff_treasury_ownership_is_two_step() public {
        _runHandoff();
        // ROLE-M1: Ownable2Step — proposed but not yet effective; deployer keeps ownership
        // until the Safe accepts, so a wrong Safe address can never strand fee routing.
        assertEq(treasury.pendingOwner(), safe, "Treasury transfer proposed to safe");
        assertEq(treasury.owner(), admin, "deployer still owns until Safe accepts");

        vm.prank(safe);
        treasury.acceptOwnership();
        assertEq(treasury.owner(), safe, "Safe owns Treasury after acceptOwnership");
        assertEq(treasury.pendingOwner(), address(0), "pendingOwner cleared");
    }

    function test_handoff_deployer_cannot_administer_after() public {
        _runHandoff();
        address newMinter = makeAddr("newMinter");
        // Precompute the role getter so it isn't the call expectRevert/prank latches onto.
        bytes32 minterRole = nft.MINTER_ROLE();

        // Deployer lost DEFAULT_ADMIN on LobsterNFT → can no longer grant roles there.
        vm.prank(admin);
        vm.expectRevert();
        nft.grantRole(minterRole, newMinter);

        // The Safe now can.
        vm.prank(safe);
        nft.grantRole(minterRole, newMinter);
        assertTrue(nft.hasRole(minterRole, newMinter), "safe can administer roles");
    }
}
