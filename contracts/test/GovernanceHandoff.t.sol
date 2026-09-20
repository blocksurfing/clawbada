// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./helpers/BaseSetup.t.sol";
import {GovernanceHandoff} from "../script/Handoff.s.sol";
import {DeploymentChecks} from "../script/DeploymentChecks.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @dev Role-handoff cluster (ROLE-M1/M2/M3) + audit 2026-09 D-11/D-23/D-24 regression, at
///      the library level: GovernanceHandoff must migrate EVERY deployer-held governance
///      authority to the Safe / operator, in two phases, and must not take anything from
///      the deployer until the Safe has proved it can sign. In BaseSetup, `admin` is the
///      deployer-equivalent (DEFAULT_ADMIN on all contracts + SEASON_ADMIN + ELIGIBILITY +
///      Treasury owner). The real scripts are exercised in DeployScripts.t.sol.
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

    function _propose(address to) internal {
        vm.startPrank(admin);
        GovernanceHandoff.propose(
            _admins(), address(miningPool), address(faucet), address(treasury), admin, to, eligOperator
        );
        vm.stopPrank();
    }

    /// @dev External so a revert inside the library surfaces to vm.expectRevert.
    function extFinalize(address to) external {
        vm.startPrank(admin);
        GovernanceHandoff.finalize(_admins(), address(miningPool), address(treasury), admin, to);
        vm.stopPrank();
    }

    function _accept(address as_) internal {
        vm.prank(as_);
        treasury.acceptOwnership();
    }

    function _deprivileged() internal view returns (bool) {
        return DeploymentChecks.deployerHoldsNoGovernance(
            _admins(), address(miningPool), address(faucet), address(claw), admin
        );
    }

    // ───────────────────────── phase 1 ─────────────────────────

    function test_propose_grants_safe_and_operator() public {
        _propose(safe);
        address[] memory a = _admins();
        for (uint256 i = 0; i < a.length; i++) {
            assertTrue(IAccessControl(a[i]).hasRole(DEFAULT_ADMIN_ROLE, safe), "safe has DEFAULT_ADMIN on each contract");
        }
        assertTrue(miningPool.hasRole(miningPool.SEASON_ADMIN_ROLE(), safe), "safe has SEASON_ADMIN");
        // ELIGIBILITY goes to the operational service wallet, NOT the cold governance Safe.
        assertTrue(faucet.hasRole(faucet.ELIGIBILITY_ROLE(), eligOperator), "operator has ELIGIBILITY");
        assertFalse(faucet.hasRole(faucet.ELIGIBILITY_ROLE(), safe), "safe does not hold ELIGIBILITY");
        assertFalse(faucet.hasRole(faucet.ELIGIBILITY_ROLE(), admin), "deployer lost ELIGIBILITY");
        assertEq(treasury.pendingOwner(), safe, "Treasury transfer proposed to safe");
    }

    /// @dev D-11: phase 1 is additive — after it the deployer can still administer, so a
    ///      wrong Safe address is a recoverable mistake instead of a permanent one.
    function test_D11_propose_takes_no_governance_from_deployer() public {
        _propose(safe);
        address[] memory a = _admins();
        for (uint256 i = 0; i < a.length; i++) {
            assertTrue(IAccessControl(a[i]).hasRole(DEFAULT_ADMIN_ROLE, admin), "deployer keeps DEFAULT_ADMIN until finalize");
        }
        assertTrue(miningPool.hasRole(miningPool.SEASON_ADMIN_ROLE(), admin), "deployer keeps SEASON_ADMIN until finalize");
        assertEq(treasury.owner(), admin, "deployer owns Treasury until the safe accepts");
    }

    // ───────────────────────── phase 2 ─────────────────────────

    /// @dev D-11, the defect itself: with a Safe that never proves control, the old one-run
    ///      handoff revoked the deployer anyway and reported success. Now finalize refuses.
    function test_D11_finalize_reverts_until_safe_accepts_treasury() public {
        _propose(safe);

        vm.expectRevert(
            bytes("handoff: the safe has not called Treasury.acceptOwnership() - no proof it can sign on this chain")
        );
        this.extFinalize(safe);

        assertTrue(battleArena.hasRole(DEFAULT_ADMIN_ROLE, admin), "deployer still admin: nothing was lost");
    }

    /// @dev finalize against an address that accepted Treasury but was never granted the
    ///      roles (phase 1 skipped or partly landed) must not strand the contracts.
    function test_D11_finalize_reverts_if_safe_lacks_a_role() public {
        _propose(safe);
        _accept(safe);
        vm.startPrank(admin);
        battleArena.revokeRole(DEFAULT_ADMIN_ROLE, safe);
        vm.stopPrank();

        vm.expectRevert(bytes("verify: safe lacks DEFAULT_ADMIN_ROLE on an AccessControl contract"));
        this.extFinalize(safe);
    }

    function test_finalize_deprivileges_deployer() public {
        assertTrue(miningPool.hasRole(miningPool.SEASON_ADMIN_ROLE(), admin), "pre: admin has SEASON_ADMIN");
        assertEq(treasury.owner(), admin, "pre: admin owns Treasury");

        _propose(safe);
        _accept(safe);
        this.extFinalize(safe);

        assertTrue(_deprivileged(), "deployer fully de-privileged");
        assertFalse(nft.hasRole(DEFAULT_ADMIN_ROLE, admin), "admin lost LobsterNFT admin");
        assertFalse(battleArena.hasRole(DEFAULT_ADMIN_ROLE, admin), "admin lost BattleArena admin");
        assertFalse(miningPool.hasRole(miningPool.SEASON_ADMIN_ROLE(), admin), "admin lost SEASON_ADMIN");
        assertEq(treasury.owner(), safe, "Safe owns Treasury");
        assertEq(treasury.pendingOwner(), address(0), "pendingOwner cleared");
    }

    function test_deployer_cannot_administer_after_finalize() public {
        _propose(safe);
        _accept(safe);
        this.extFinalize(safe);

        address newMinter = makeAddr("newMinter");
        // Precompute the role getter so it isn't the call expectRevert/prank latches onto.
        bytes32 minterRole = nft.MINTER_ROLE();

        vm.prank(admin);
        vm.expectRevert();
        nft.grantRole(minterRole, newMinter);

        vm.prank(safe);
        nft.grantRole(minterRole, newMinter);
        assertTrue(nft.hasRole(minterRole, newMinter), "safe can administer roles");
    }

    // ───────────────────────── recovery ─────────────────────────

    /// @dev D-11 end to end: propose to a wrong address, notice (it can never accept),
    ///      retract, propose to the right one, finish. Under the old script this sequence
    ///      was impossible — the first run had already revoked the deployer.
    function test_D11_wrong_safe_is_recoverable() public {
        address wrong = makeAddr("safe address from another chain");
        _propose(wrong);

        vm.startPrank(admin);
        GovernanceHandoff.retract(_admins(), address(miningPool), address(treasury), wrong);
        vm.stopPrank();

        address[] memory a = _admins();
        for (uint256 i = 0; i < a.length; i++) {
            assertFalse(IAccessControl(a[i]).hasRole(DEFAULT_ADMIN_ROLE, wrong), "wrong address stripped of DEFAULT_ADMIN");
        }
        assertFalse(miningPool.hasRole(miningPool.SEASON_ADMIN_ROLE(), wrong), "wrong address stripped of SEASON_ADMIN");
        assertEq(treasury.pendingOwner(), address(0), "pending Treasury transfer cancelled");

        _propose(safe);
        _accept(safe);
        this.extFinalize(safe);
        assertTrue(_deprivileged(), "handoff completed to the right safe");
    }

    /// @dev D-24: between phase 1 and the Safe's acceptance the deployer still owns
    ///      Treasury and can overwrite the pending transfer. finalize must notice.
    function test_D24_finalize_reverts_if_pending_transfer_was_overwritten() public {
        address attacker = makeAddr("attacker");
        _propose(safe);

        vm.prank(admin); // a compromised deploy key
        treasury.transferOwnership(attacker);
        _accept(attacker);

        vm.expectRevert(
            bytes("handoff: the safe has not called Treasury.acceptOwnership() - no proof it can sign on this chain")
        );
        this.extFinalize(safe);
    }

    // ───────────────────────── the predicate ─────────────────────────

    /// @dev D-23: the old predicate looked at DEFAULT_ADMIN, SEASON_ADMIN and ELIGIBILITY
    ///      only. A deployer left holding ClawToken MINTER_ROLE (Configure's last
    ///      transaction dropped) passed it, while able to mint the whole unminted supply.
    function test_D23_predicate_sees_lingering_clawtoken_minter() public {
        bytes32 clawMinter = claw.MINTER_ROLE();
        vm.prank(admin);
        claw.grantRole(clawMinter, admin);

        _propose(safe);
        _accept(safe);
        this.extFinalize(safe);

        assertFalse(_deprivileged(), "a deployer that can still mint CLAW is not de-privileged");

        vm.prank(safe);
        claw.revokeRole(clawMinter, admin);
        assertTrue(_deprivileged(), "clean once the safe revokes it");
    }
}
