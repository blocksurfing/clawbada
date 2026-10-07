// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {PauseSwitch, IPauseSwitch} from "../contracts/PauseSwitch.sol";

/// @dev The switch itself: who can flip it which way, and what it tells the gated contracts.
contract PauseSwitchTest is Test {
    PauseSwitch ps;
    address admin = makeAddr("admin");
    address pauser = makeAddr("pauser");
    address stranger = makeAddr("stranger");

    event Paused(address indexed by);
    event Unpaused(address indexed by);

    function setUp() public {
        ps = new PauseSwitch(admin);
        bytes32 role = ps.PAUSER_ROLE(); // read BEFORE the prank: an external view call would eat it
        vm.prank(admin);
        ps.grantRole(role, pauser);
    }

    function test_constructor_zeroAdmin_reverts() public {
        vm.expectRevert(PauseSwitch.ZeroAddress.selector);
        new PauseSwitch(address(0));
    }

    function test_startsOpen() public view {
        assertFalse(ps.paused());
        ps.requireNotPaused(); // no revert
        assertTrue(ps.hasRole(ps.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(ps.hasRole(ps.PAUSER_ROLE(), pauser));
    }

    function test_pauser_canPause_andEmits() public {
        vm.expectEmit(true, false, false, true);
        emit Paused(pauser);
        vm.prank(pauser);
        ps.pause();
        assertTrue(ps.paused());
        vm.expectRevert(IPauseSwitch.ProtocolPaused.selector);
        ps.requireNotPaused();
    }

    function test_admin_canPause() public {
        vm.prank(admin);
        ps.pause();
        assertTrue(ps.paused());
    }

    function test_stranger_cannotPause() public {
        bytes32 role = ps.PAUSER_ROLE();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, role));
        ps.pause();
    }

    function test_pause_twice_reverts() public {
        vm.prank(pauser);
        ps.pause();
        vm.prank(pauser);
        vm.expectRevert(PauseSwitch.AlreadyPaused.selector);
        ps.pause();
    }

    function test_admin_canUnpause_andEmits() public {
        vm.prank(pauser);
        ps.pause();
        vm.expectEmit(true, false, false, true);
        emit Unpaused(admin);
        vm.prank(admin);
        ps.unpause();
        assertFalse(ps.paused());
        ps.requireNotPaused(); // no revert
    }

    /// @dev The asymmetry that bounds a stolen guardian key: it can stop inflows, never reopen them.
    function test_pauser_cannotUnpause() public {
        vm.prank(pauser);
        ps.pause();
        vm.prank(pauser);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, pauser, bytes32(0))
        );
        ps.unpause();
        assertTrue(ps.paused());
    }

    function test_unpause_whenOpen_reverts() public {
        vm.prank(admin);
        vm.expectRevert(PauseSwitch.NotPaused.selector);
        ps.unpause();
    }

    /// @dev Governance can move: a new admin (the Safe after the handoff) unpauses, the old one cannot.
    function test_adminHandoff_movesTheUnpause() public {
        address safe = makeAddr("safe");
        vm.startPrank(admin);
        ps.grantRole(ps.DEFAULT_ADMIN_ROLE(), safe);
        ps.renounceRole(ps.DEFAULT_ADMIN_ROLE(), admin);
        vm.stopPrank();
        vm.prank(pauser);
        ps.pause();
        vm.prank(admin);
        vm.expectRevert();
        ps.unpause();
        vm.prank(safe);
        ps.unpause();
        assertFalse(ps.paused());
    }

    function testFuzz_onlyPauserOrAdminCanPause(address who) public {
        vm.assume(who != admin && who != pauser);
        vm.prank(who);
        vm.expectRevert();
        ps.pause();
        assertFalse(ps.paused());
    }
}
